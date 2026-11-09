import { deviceId, type Device, type HubScene, type LightState } from '@/core/types';

import type { Driver, DriverEvent, SetStateOptions } from '../Driver';
import type { HttpClient } from './http';
import { HueClient, type HueBridgeConnection } from './HueClient';
import type {
  HueEventContainer,
  HueGroup,
  HueLight,
  HueScene,
  HueZigbeeConnectivity,
} from './hueTypes';
import { hueLightState, hueLightToDevice, hueSceneToHubScene, mergeHueLight, toHueLightPut } from './mapping';
import { SseParser } from './sse';

const RECONNECT_DELAYS_MS = [1000, 2000, 5000, 10_000, 30_000];

export class HueDriver implements Driver {
  readonly id = 'hue' as const;
  readonly label: string;
  /** Signify recommends staying at or under ~10 light commands per second per bridge. */
  readonly maxCommandsPerSecond = 10;

  private readonly client: HueClient;
  private lights = new Map<string, HueLight>();
  private groups: HueGroup[] = [];
  private listeners = new Set<(event: DriverEvent) => void>();
  private closeStream: (() => void) | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;

  constructor(
    http: HttpClient,
    readonly connection: HueBridgeConnection,
    private readonly timers: Pick<typeof globalThis, 'setTimeout' | 'clearTimeout'> = globalThis,
  ) {
    this.client = new HueClient(http, connection);
    this.label = `Philips Hue · ${connection.name}`;
  }

  async listDevices(): Promise<Device[]> {
    const [lights, rooms, zones, connectivity] = await Promise.all([
      this.client.list<HueLight>('light'),
      this.client.list<HueGroup>('room'),
      this.client.list<HueGroup>('zone'),
      this.client.list<HueZigbeeConnectivity>('zigbee_connectivity'),
    ]);
    this.lights = new Map(lights.map((l) => [l.id, l]));
    this.groups = [...rooms, ...zones];
    return lights.map((l) => hueLightToDevice(l, rooms, connectivity));
  }

  async setState(nativeId: string, state: LightState, options?: SetStateOptions): Promise<void> {
    const body = toHueLightPut(state, this.lights.get(nativeId), options?.transitionMs);
    if (Object.keys(body).length === 0) return;
    await this.client.put('light', nativeId, body);
  }

  async listScenes(): Promise<HubScene[]> {
    const [scenes, rooms, zones] = await Promise.all([
      this.client.list<HueScene>('scene'),
      this.client.list<HueGroup>('room'),
      this.client.list<HueGroup>('zone'),
    ]);
    this.groups = [...rooms, ...zones];
    return scenes
      .map((s) => hueSceneToHubScene(s, this.groups))
      .sort((a, b) => (a.room ?? '').localeCompare(b.room ?? '') || a.name.localeCompare(b.name));
  }

  /**
   * Recalls a scene stored on the bridge. With `dynamic`, the bridge itself animates the
   * scene's palette (Hue "dynamic scenes"), which keeps running when this app is closed.
   */
  async activateScene(nativeId: string, options: { dynamic?: boolean; speed?: number } = {}) {
    const body: Record<string, unknown> = {
      recall: { action: options.dynamic ? 'dynamic_palette' : 'active' },
    };
    if (options.speed !== undefined) body.speed = Math.min(1, Math.max(0, options.speed));
    await this.client.put('scene', nativeId, body);
  }

  subscribe(listener: (event: DriverEvent) => void): () => void {
    this.listeners.add(listener);
    if (this.listeners.size === 1) this.openStream();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.stopStream();
    };
  }

  private emit(event: DriverEvent) {
    this.listeners.forEach((l) => l(event));
  }

  private openStream() {
    const parser = new SseParser();
    let announced = false;
    this.closeStream = this.client.eventStream(
      (chunk) => {
        if (!announced) {
          announced = true;
          this.reconnectAttempt = 0;
          this.emit({ type: 'connection', status: 'connected' });
        }
        for (const message of parser.push(chunk)) this.handleMessage(message.data);
      },
      (error) => {
        this.closeStream = null;
        this.emit({ type: 'connection', status: 'disconnected', error: error ?? undefined });
        this.scheduleReconnect();
      },
    );
  }

  private stopStream() {
    if (this.reconnectTimer) this.timers.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.closeStream?.();
    this.closeStream = null;
  }

  private scheduleReconnect() {
    if (this.listeners.size === 0) return;
    const delay = RECONNECT_DELAYS_MS[Math.min(this.reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)];
    this.reconnectAttempt++;
    this.reconnectTimer = this.timers.setTimeout(() => {
      this.reconnectTimer = null;
      if (this.listeners.size > 0) this.openStream();
    }, delay);
  }

  /** Handles one SSE `data:` payload (a JSON array of event containers). */
  handleMessage(data: string) {
    let containers: HueEventContainer[];
    try {
      containers = JSON.parse(data) as HueEventContainer[];
    } catch {
      return;
    }
    for (const container of containers) {
      if (container.type === 'add' || container.type === 'delete') {
        if (container.data.some((d) => ['light', 'room', 'zone', 'scene'].includes(d.type))) {
          this.emit({ type: 'devices-changed' });
        }
        continue;
      }
      if (container.type !== 'update') continue;
      for (const item of container.data) {
        if (item.type === 'light') {
          const cached = this.lights.get(item.id);
          if (!cached) continue;
          const merged = mergeHueLight(cached, item);
          this.lights.set(item.id, merged);
          this.emit({ type: 'device-updated', deviceId: deviceId('hue', item.id), state: hueLightState(merged) });
        } else if (item.type === 'zigbee_connectivity') {
          const owner = (item.owner as { rid: string } | undefined)?.rid;
          const status = item.status as HueZigbeeConnectivity['status'] | undefined;
          if (!owner || !status) continue;
          for (const light of this.lights.values()) {
            if (light.owner.rid === owner) {
              this.emit({
                type: 'device-updated',
                deviceId: deviceId('hue', light.id),
                state: {},
                reachable: status === 'connected',
              });
            }
          }
        }
      }
    }
  }
}
