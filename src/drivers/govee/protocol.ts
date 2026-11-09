// Govee LAN API ("WLAN guide"). JSON over UDP:
//   scan     → multicast 239.255.255.250:4001, replies arrive on our port 4002
//   commands → device IP, port 4003; devStatus replies arrive on port 4002
// LAN Control has to be switched on per device in the Govee Home app.

import { clamp } from '@/core/color';
import type { LightState, Rgb } from '@/core/types';

export const SCAN_GROUP = '239.255.255.250';
export const SCAN_PORT = 4001;
export const LISTEN_PORT = 4002;
export const CONTROL_PORT = 4003;

/** The colour-temperature range the LAN API accepts. */
export const GOVEE_MIN_KELVIN = 2000;
export const GOVEE_MAX_KELVIN = 9000;

export type GoveeScanData = {
  ip: string;
  /** MAC-like device ID, e.g. "1F:80:C5:32:32:36:72:4E". */
  device: string;
  sku: string;
  bleVersionHard?: string;
  bleVersionSoft?: string;
  wifiVersionHard?: string;
  wifiVersionSoft?: string;
};

export type GoveeStatusData = {
  onOff: 0 | 1;
  brightness: number;
  color: Rgb;
  /** 0 when the lamp is showing an RGB colour. */
  colorTemInKelvin: number;
};

export type GoveeMessage =
  | { cmd: 'scan'; data: GoveeScanData }
  | { cmd: 'devStatus'; data: GoveeStatusData };

const message = (cmd: string, data: unknown) => JSON.stringify({ msg: { cmd, data } });

export const scanMessage = () => message('scan', { account_topic: 'reserve' });
export const statusMessage = () => message('devStatus', {});
export const turnMessage = (on: boolean) => message('turn', { value: on ? 1 : 0 });
export const brightnessMessage = (percent: number) =>
  message('brightness', { value: Math.round(clamp(percent, 1, 100)) });
export const colorMessage = ({ r, g, b }: Rgb) =>
  message('colorwc', { color: { r: Math.round(r), g: Math.round(g), b: Math.round(b) }, colorTemInKelvin: 0 });
export const temperatureMessage = (kelvin: number) =>
  message('colorwc', {
    color: { r: 0, g: 0, b: 0 },
    colorTemInKelvin: Math.round(clamp(kelvin, GOVEE_MIN_KELVIN, GOVEE_MAX_KELVIN)),
  });

/** Parses a datagram from a device. Returns null for anything we don't understand. */
export function parseMessage(text: string): GoveeMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const msg = (parsed as { msg?: { cmd?: unknown; data?: unknown } })?.msg;
  if (!msg || typeof msg.data !== 'object' || msg.data === null) return null;
  const data = msg.data as Record<string, unknown>;
  if (msg.cmd === 'scan' && typeof data.ip === 'string' && typeof data.device === 'string') {
    return { cmd: 'scan', data: { ...(data as GoveeScanData), sku: String(data.sku ?? 'Govee') } };
  }
  if (msg.cmd === 'devStatus' && typeof data.onOff === 'number') {
    const color = (data.color ?? {}) as Partial<Rgb>;
    return {
      cmd: 'devStatus',
      data: {
        onOff: data.onOff ? 1 : 0,
        brightness: Number(data.brightness ?? 0),
        color: { r: Number(color.r ?? 0), g: Number(color.g ?? 0), b: Number(color.b ?? 0) },
        colorTemInKelvin: Number(data.colorTemInKelvin ?? 0),
      },
    };
  }
  return null;
}

export function statusToLightState(status: GoveeStatusData): LightState {
  return {
    on: status.onOff === 1,
    brightness: status.brightness,
    color:
      status.colorTemInKelvin > 0
        ? { mode: 'temperature', kelvin: status.colorTemInKelvin }
        : { mode: 'rgb', rgb: status.color },
  };
}

/**
 * Turns a desired state into the datagrams to send, in order. Govee lamps have no
 * fade, so there is no transition. `currentlyOn` avoids a redundant "turn on".
 */
export function commandsFor(state: LightState, currentlyOn: boolean | undefined): string[] {
  if (state.on === false || (state.brightness !== undefined && state.brightness <= 0)) {
    return [turnMessage(false)];
  }
  const commands: string[] = [];
  const changesLight = state.brightness !== undefined || state.color !== undefined;
  if (state.on === true || (changesLight && currentlyOn !== true)) commands.push(turnMessage(true));
  if (state.color?.mode === 'rgb') commands.push(colorMessage(state.color.rgb));
  if (state.color?.mode === 'temperature') commands.push(temperatureMessage(state.color.kelvin));
  if (state.brightness !== undefined) commands.push(brightnessMessage(state.brightness));
  return commands;
}
