import type { Device, DriverId, HubScene, LightState } from '@/core/types';

export type SetStateOptions = {
  /** How long the lamp should fade to the new state. Drivers that can't fade ignore it. */
  transitionMs?: number;
};

export type DriverEvent =
  | { type: 'device-updated'; deviceId: string; state: Partial<LightState>; reachable?: boolean }
  | { type: 'devices-changed' }
  | { type: 'connection'; status: 'connected' | 'disconnected'; error?: string };

/**
 * One brand or protocol (Hue bridge, Govee LAN, HomeKit). The registry talks to
 * every driver through this interface, so the UI and the scene engine never
 * need to know which brand a light is.
 */
export interface Driver {
  readonly id: DriverId;
  /** Human-readable, e.g. "Philips Hue". */
  readonly label: string;
  /**
   * Max commands per second this driver should be sent. The scene engine uses this
   * to pace animations so the hub doesn't drop or queue commands.
   */
  readonly maxCommandsPerSecond: number;

  listDevices(): Promise<Device[]>;
  setState(nativeId: string, state: LightState, options?: SetStateOptions): Promise<void>;
  /** Scenes stored on the hub itself. Optional: not every brand has them. */
  listScenes?(): Promise<HubScene[]>;
  activateScene?(nativeId: string, options?: { dynamic?: boolean; speed?: number }): Promise<void>;
  /** Start pushing live updates. Returns an unsubscribe function. */
  subscribe(listener: (event: DriverEvent) => void): () => void;
}
