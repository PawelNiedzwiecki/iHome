import { deviceId, type Device, type LightState } from '@/core/types';

import type { Driver, DriverEvent } from '../Driver';
import {
  CONTROL_PORT,
  GOVEE_MAX_KELVIN,
  GOVEE_MIN_KELVIN,
  LISTEN_PORT,
  SCAN_GROUP,
  SCAN_PORT,
  commandsFor,
  parseMessage,
  scanMessage,
  statusMessage,
  statusToLightState,
  type GoveeMessage,
  type GoveeStatusData,
} from './protocol';
import type { UdpTransport } from './udp';

/** What we remember about a Govee device between launches. */
export type GoveeDeviceRecord = {
  /** Device ID from the scan reply, or `ip:<host>` for a device that only answered devStatus. */
  id: string;
  host: string;
  sku: string;
  /** Name chosen in iHome (the LAN API doesn't expose the Govee app's name). */
  name?: string;
};

type Timers = Pick<typeof globalThis, 'setTimeout' | 'clearTimeout' | 'setInterval' | 'clearInterval'>;

export type GoveeDriverOptions = {
  records?: GoveeDeviceRecord[];
  /** Called whenever the set of known devices (or their IPs) changes, so it can be saved. */
  onRecordsChanged?: (records: GoveeDeviceRecord[]) => void;
  timers?: Timers;
  now?: () => number;
  /** How often to ask every device for its state while subscribed. */
  pollIntervalMs?: number;
  /** How long to collect scan replies. */
  scanWindowMs?: number;
};

export class GoveeError extends Error {
  name = 'GoveeError';
}

export class GoveeDriver implements Driver {
  readonly id = 'govee' as const;
  readonly label = 'Govee (local network)';
  /** Each lamp is addressed directly, so the limit is generous; per-lamp pacing is the engine's job. */
  readonly maxCommandsPerSecond = 20;

  /** Undefined until the first scan; false when iOS refused multicast (entitlement missing). */
  multicastAvailable: boolean | undefined;

  private records = new Map<string, GoveeDeviceRecord>();
  private status = new Map<string, GoveeStatusData>();
  private lastSeen = new Map<string, number>();
  private reportedReachable = new Map<string, boolean>();
  private listeners = new Set<(event: DriverEvent) => void>();
  private messageWaiters = new Set<(host: string, msg: GoveeMessage) => void>();
  private listening: Promise<void> | null = null;
  private offMessage: (() => void) | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  private readonly timers: Timers;
  private readonly now: () => number;
  private readonly pollIntervalMs: number;
  private readonly scanWindowMs: number;

  constructor(
    private readonly udp: UdpTransport,
    private readonly options: GoveeDriverOptions = {},
  ) {
    for (const r of options.records ?? []) this.records.set(r.id, r);
    this.timers = options.timers ?? globalThis;
    this.now = options.now ?? Date.now;
    this.pollIntervalMs = options.pollIntervalMs ?? 10_000;
    this.scanWindowMs = options.scanWindowMs ?? 1500;
  }

  getRecords(): GoveeDeviceRecord[] {
    return [...this.records.values()];
  }

  // ---------- Driver ----------

  /** Scans the network (multicast if allowed, plus every known IP) and returns all known lamps. */
  async listDevices(): Promise<Device[]> {
    await this.scan();
    return this.getRecords().map((r) => this.toDevice(r));
  }

  async setState(nativeId: string, state: LightState): Promise<void> {
    const record = this.records.get(nativeId);
    if (!record) throw new GoveeError(`Unknown Govee device ${nativeId}`);
    const current = this.status.get(nativeId);
    for (const command of commandsFor(state, current ? current.onOff === 1 : undefined)) {
      await this.udp.send(record.host, CONTROL_PORT, command);
    }
    if (current) this.status.set(nativeId, applyToStatus(current, state));
  }

  subscribe(listener: (event: DriverEvent) => void): () => void {
    this.listeners.add(listener);
    if (this.listeners.size === 1) {
      this.ensureListening().catch((error: Error) =>
        this.emit({ type: 'connection', status: 'disconnected', error: error.message }),
      );
      this.pollTimer = this.timers.setInterval(() => this.poll(), this.pollIntervalMs);
    }
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0 && this.pollTimer) {
        this.timers.clearInterval(this.pollTimer);
        this.pollTimer = null;
      }
    };
  }

  // ---------- Govee-specific ----------

  /** Sends a scan and collects replies for `scanWindowMs`. */
  async scan(): Promise<{ multicast: boolean }> {
    await this.ensureListening();
    let multicast = true;
    try {
      await this.udp.sendMulticast(SCAN_GROUP, SCAN_PORT, scanMessage());
    } catch {
      multicast = false;
    }
    this.multicastAvailable = multicast;
    // Unicast to known lamps too: works without the multicast entitlement, and asks for state.
    await Promise.all(
      this.getRecords().flatMap((r) => [
        this.udp.send(r.host, SCAN_PORT, scanMessage()).catch(() => {}),
        this.udp.send(r.host, CONTROL_PORT, statusMessage()).catch(() => {}),
      ]),
    );
    await this.sleep(this.scanWindowMs);
    return { multicast };
  }

  /**
   * Adds a lamp by IP address (for when multicast discovery isn't available).
   * Resolves once the lamp answers; rejects if it doesn't within `timeoutMs`.
   */
  async addByHost(host: string, timeoutMs = 2500): Promise<GoveeDeviceRecord> {
    await this.ensureListening();
    let status: GoveeStatusData | undefined;
    const scanned = new Promise<GoveeDeviceRecord | null>((resolve) => {
      const timer = this.timers.setTimeout(() => done(null), timeoutMs);
      const waiter = (from: string, msg: GoveeMessage) => {
        if (msg.cmd === 'scan' && (msg.data.ip === host || from === host)) {
          done(this.records.get(msg.data.device) ?? null);
        } else if (msg.cmd === 'devStatus' && from === host) {
          status = msg.data;
        }
      };
      const done = (record: GoveeDeviceRecord | null) => {
        this.timers.clearTimeout(timer);
        this.messageWaiters.delete(waiter);
        resolve(record);
      };
      this.messageWaiters.add(waiter);
    });

    await Promise.all([
      this.udp.send(host, SCAN_PORT, scanMessage()).catch(() => {}),
      this.udp.send(host, CONTROL_PORT, statusMessage()).catch(() => {}),
    ]);
    const fromScan = await scanned;
    if (fromScan) return fromScan;
    if (status) {
      // It answers commands but not unicast scans: identify it by IP.
      const record: GoveeDeviceRecord = { id: `ip:${host}`, host, sku: 'Govee' };
      this.upsert(record);
      this.status.set(record.id, status);
      this.lastSeen.set(record.id, this.now());
      return record;
    }
    throw new GoveeError(
      `No reply from ${host}. Check the IP, and turn on LAN Control for this light in the Govee Home app.`,
    );
  }

  rename(nativeId: string, name: string) {
    const record = this.records.get(nativeId);
    if (!record) return;
    this.records.set(nativeId, { ...record, name: name.trim() || undefined });
    this.saveRecords();
  }

  forget(nativeId: string) {
    if (!this.records.delete(nativeId)) return;
    this.status.delete(nativeId);
    this.lastSeen.delete(nativeId);
    this.saveRecords();
  }

  // ---------- internals ----------

  private ensureListening(): Promise<void> {
    if (!this.listening) {
      this.offMessage = this.udp.onMessage((from, data) => this.handle(from.host, data));
      this.listening = this.udp.listen(LISTEN_PORT).catch((error: Error) => {
        this.offMessage?.();
        this.offMessage = null;
        this.listening = null;
        throw new GoveeError(`Can't listen for Govee replies: ${error.message}`);
      });
    }
    return this.listening;
  }

  private handle(host: string, text: string) {
    const msg = parseMessage(text);
    if (!msg) return;
    if (msg.cmd === 'scan') {
      const id = msg.data.device;
      this.upsert({ id, host: msg.data.ip || host, sku: msg.data.sku });
      this.markSeen(id);
    } else {
      const record = this.getRecords().find((r) => r.host === host);
      if (record) {
        this.status.set(record.id, msg.data);
        this.lastSeen.set(record.id, this.now());
        this.reportedReachable.set(record.id, true);
        this.emit({
          type: 'device-updated',
          deviceId: deviceId('govee', record.id),
          state: statusToLightState(msg.data),
          reachable: true,
        });
      }
    }
    // After the records are updated, so waiters can look the device up.
    this.messageWaiters.forEach((w) => w(host, msg));
  }

  private markSeen(id: string) {
    this.lastSeen.set(id, this.now());
    if (this.reportedReachable.get(id) === false) {
      this.reportedReachable.set(id, true);
      this.emit({ type: 'device-updated', deviceId: deviceId('govee', id), state: {}, reachable: true });
    }
  }

  /** Adds or updates a record (keeping the user's name). Lamps can change IP via DHCP. */
  private upsert(found: GoveeDeviceRecord) {
    const existing = this.records.get(found.id);
    if (existing && existing.host === found.host && existing.sku === found.sku) return;
    // A device that was added by IP and now answers scans: replace the IP-based record.
    const byIp = this.records.get(`ip:${found.host}`);
    if (byIp && found.id !== byIp.id) {
      this.records.delete(byIp.id);
      found = { ...found, name: found.name ?? byIp.name };
    }
    this.records.set(found.id, { ...found, name: existing?.name ?? found.name });
    this.saveRecords();
  }

  private saveRecords() {
    this.options.onRecordsChanged?.(this.getRecords());
  }

  private poll() {
    const staleAfter = this.pollIntervalMs * 3;
    for (const record of this.getRecords()) {
      void this.udp.send(record.host, CONTROL_PORT, statusMessage()).catch(() => {});
      const seen = this.lastSeen.get(record.id);
      const reachable = seen !== undefined && this.now() - seen < staleAfter;
      if (!reachable && this.reportedReachable.get(record.id) !== false) {
        this.reportedReachable.set(record.id, false);
        this.emit({ type: 'device-updated', deviceId: deviceId('govee', record.id), state: {}, reachable: false });
      }
    }
  }

  private toDevice(record: GoveeDeviceRecord): Device {
    const status = this.status.get(record.id);
    const seen = this.lastSeen.get(record.id);
    const reachable = seen !== undefined && this.now() - seen < this.pollIntervalMs * 3;
    this.reportedReachable.set(record.id, reachable);
    return {
      id: deviceId('govee', record.id),
      driver: 'govee',
      nativeId: record.id,
      name: record.name ?? defaultName(record),
      model: record.sku,
      capabilities: {
        onOff: true,
        brightness: true,
        color: true,
        temperature: { minKelvin: GOVEE_MIN_KELVIN, maxKelvin: GOVEE_MAX_KELVIN },
      },
      state: status ? statusToLightState(status) : {},
      reachable,
    };
  }

  private emit(event: DriverEvent) {
    this.listeners.forEach((l) => l(event));
  }

  private sleep(ms: number) {
    return new Promise<void>((resolve) => this.timers.setTimeout(resolve, ms));
  }
}

function defaultName(record: GoveeDeviceRecord) {
  const suffix = record.id.startsWith('ip:') ? record.host : record.id.replace(/:/g, '').slice(-4);
  return `Govee ${record.sku === 'Govee' ? '' : `${record.sku} `}${suffix}`.replace(/\s+/g, ' ');
}

function applyToStatus(status: GoveeStatusData, state: LightState): GoveeStatusData {
  const next = { ...status };
  if (state.on !== undefined) next.onOff = state.on ? 1 : 0;
  if (state.brightness !== undefined) {
    if (state.brightness <= 0) next.onOff = 0;
    else {
      next.brightness = state.brightness;
      next.onOff = 1;
    }
  }
  if (state.color?.mode === 'rgb') next.color = state.color.rgb;
  if (state.color) next.colorTemInKelvin = state.color.mode === 'temperature' ? state.color.kelvin : 0;
  if (state.color) next.onOff = 1;
  return next;
}
