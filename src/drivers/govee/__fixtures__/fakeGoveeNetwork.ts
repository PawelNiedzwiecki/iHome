import type { Rgb } from '@/core/types';

import { CONTROL_PORT, LISTEN_PORT, SCAN_GROUP, SCAN_PORT, type GoveeStatusData } from '../protocol';
import type { UdpTransport } from '../udp';

export type FakeLamp = {
  ip: string;
  device: string;
  sku: string;
  status: GoveeStatusData;
  /** Some firmware ignores a scan sent straight to its IP. */
  answersUnicastScan?: boolean;
  /** Simulates a lamp that is unplugged. */
  offline?: boolean;
};

export function makeLamp(ip: string, device: string, sku = 'H6008', patch: Partial<FakeLamp> = {}): FakeLamp {
  return {
    ip,
    device,
    sku,
    status: { onOff: 0, brightness: 100, color: { r: 255, g: 255, b: 255 }, colorTemInKelvin: 0 },
    answersUnicastScan: true,
    ...patch,
  };
}

/** A pretend home network of Govee lamps that speaks the LAN protocol. */
export class FakeGoveeNetwork implements UdpTransport {
  multicastAllowed = true;
  listeningPort: number | null = null;
  sent: { host: string; port: number; message: unknown }[] = [];
  private listeners = new Set<(from: { host: string; port: number }, data: string) => void>();

  constructor(public lamps: FakeLamp[]) {}

  async listen(port: number) {
    this.listeningPort = port;
  }

  onMessage(listener: (from: { host: string; port: number }, data: string) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async sendMulticast(group: string, port: number, message: string) {
    if (!this.multicastAllowed) throw new Error('ERR_GOVEE_MULTICAST: permission denied');
    this.sent.push({ host: group, port, message: JSON.parse(message) });
    if (group !== SCAN_GROUP || port !== SCAN_PORT || cmdOf(message) !== 'scan') return;
    for (const lamp of this.lamps) if (!lamp.offline) this.reply(lamp, 'scan', scanData(lamp));
  }

  async send(host: string, port: number, message: string) {
    this.sent.push({ host, port, message: JSON.parse(message) });
    const lamp = this.lamps.find((l) => l.ip === host);
    if (!lamp || lamp.offline) return;
    const { cmd, data } = (JSON.parse(message) as { msg: { cmd: string; data: Record<string, unknown> } }).msg;
    if (port === SCAN_PORT && cmd === 'scan' && lamp.answersUnicastScan) {
      this.reply(lamp, 'scan', scanData(lamp));
      return;
    }
    if (port !== CONTROL_PORT) return;
    switch (cmd) {
      case 'devStatus':
        this.reply(lamp, 'devStatus', lamp.status);
        break;
      case 'turn':
        lamp.status = { ...lamp.status, onOff: data.value ? 1 : 0 };
        break;
      case 'brightness':
        lamp.status = { ...lamp.status, brightness: data.value as number };
        break;
      case 'colorwc':
        lamp.status = {
          ...lamp.status,
          color: data.color as Rgb,
          colorTemInKelvin: data.colorTemInKelvin as number,
        };
        break;
    }
  }

  /** Commands (cmd names) sent to `host` on the control port. */
  commandsTo(host: string) {
    return this.sent
      .filter((s) => s.host === host && s.port === CONTROL_PORT)
      .map((s) => (s.message as { msg: { cmd: string; data: unknown } }).msg);
  }

  private reply(lamp: FakeLamp, cmd: string, data: unknown) {
    if (this.listeningPort !== LISTEN_PORT) return;
    const text = JSON.stringify({ msg: { cmd, data } });
    // Replies arrive asynchronously, like real datagrams.
    void Promise.resolve().then(() => this.listeners.forEach((l) => l({ host: lamp.ip, port: SCAN_PORT }, text)));
  }
}

const cmdOf = (message: string) => (JSON.parse(message) as { msg: { cmd: string } }).msg.cmd;

const scanData = (lamp: FakeLamp) => ({
  ip: lamp.ip,
  device: lamp.device,
  sku: lamp.sku,
  bleVersionHard: '3.01.01',
  bleVersionSoft: '1.03.01',
  wifiVersionHard: '1.00.10',
  wifiVersionSoft: '1.02.03',
});
