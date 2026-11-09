import type { Device, HubScene, LightState } from '@/core/types';
import type { Driver, DriverEvent, SetStateOptions } from '@/drivers/Driver';

export type RegistrySnapshot = {
  devices: Device[];
  scenes: HubScene[];
  errors: { driver: string; message: string }[];
};

type Listener = (snapshot: RegistrySnapshot) => void;

/** Devices with a room first (alphabetical), then the ones without; by name within a room. */
function byRoomThenName(a: Device, b: Device) {
  if (a.room !== b.room) {
    if (a.room === undefined) return 1;
    if (b.room === undefined) return -1;
    return a.room.localeCompare(b.room);
  }
  return a.name.localeCompare(b.name);
}

/**
 * Aggregates every driver into one list of devices and hub scenes, routes commands
 * to the right driver, and keeps state live from driver events.
 */
export class DeviceRegistry {
  private drivers: Driver[] = [];
  private unsubscribers = new Map<Driver, () => void>();
  private devices = new Map<string, Device>();
  private deviceDriver = new Map<string, Driver>();
  private scenes = new Map<string, HubScene>();
  private sceneDriver = new Map<string, Driver>();
  private errors = new Map<Driver, string>();
  private listeners = new Set<Listener>();

  addDriver(driver: Driver) {
    if (this.drivers.includes(driver)) return;
    this.drivers.push(driver);
    this.unsubscribers.set(
      driver,
      driver.subscribe((event) => this.onDriverEvent(driver, event)),
    );
  }

  removeDriver(driver: Driver) {
    this.unsubscribers.get(driver)?.();
    this.unsubscribers.delete(driver);
    this.drivers = this.drivers.filter((d) => d !== driver);
    this.errors.delete(driver);
    for (const [id, d] of [...this.deviceDriver]) {
      if (d === driver) {
        this.deviceDriver.delete(id);
        this.devices.delete(id);
      }
    }
    for (const [id, d] of [...this.sceneDriver]) {
      if (d === driver) {
        this.sceneDriver.delete(id);
        this.scenes.delete(id);
      }
    }
    this.notify();
  }

  getDrivers(): readonly Driver[] {
    return this.drivers;
  }

  /** Reloads devices and hub scenes from all drivers (or just one). */
  async refresh(only?: Driver) {
    const targets = only ? [only] : this.drivers;
    await Promise.all(targets.map((d) => this.refreshDriver(d)));
    this.notify();
  }

  private async refreshDriver(driver: Driver) {
    try {
      const [devices, scenes] = await Promise.all([
        driver.listDevices(),
        driver.listScenes ? driver.listScenes() : Promise.resolve([]),
      ]);
      for (const [id, d] of [...this.deviceDriver]) if (d === driver) this.devices.delete(id);
      for (const [id, d] of [...this.sceneDriver]) if (d === driver) this.scenes.delete(id);
      for (const device of devices) {
        this.devices.set(device.id, device);
        this.deviceDriver.set(device.id, driver);
      }
      for (const scene of scenes) {
        this.scenes.set(scene.id, scene);
        this.sceneDriver.set(scene.id, driver);
      }
      this.errors.delete(driver);
    } catch (error) {
      this.errors.set(driver, error instanceof Error ? error.message : String(error));
    }
  }

  getDevice(id: string): Device | undefined {
    return this.devices.get(id);
  }

  driverFor(deviceId: string): Driver | undefined {
    return this.deviceDriver.get(deviceId);
  }

  /** Optimistically updates local state, then sends the command. Reverts on failure. */
  async setState(deviceId: string, state: LightState, options?: SetStateOptions) {
    const device = this.devices.get(deviceId);
    const driver = this.deviceDriver.get(deviceId);
    if (!device || !driver) throw new Error(`Unknown device ${deviceId}`);
    const previous = device.state;
    const next: LightState = { ...previous, ...state };
    if (state.brightness !== undefined && state.brightness > 0 && state.on === undefined) next.on = true;
    if (state.brightness !== undefined && state.brightness <= 0) next.on = false;
    this.devices.set(deviceId, { ...device, state: next });
    this.notify();
    try {
      await driver.setState(device.nativeId, state, options);
    } catch (error) {
      const current = this.devices.get(deviceId);
      if (current) this.devices.set(deviceId, { ...current, state: previous });
      this.notify();
      throw error;
    }
  }

  async activateScene(sceneId: string, options?: { dynamic?: boolean; speed?: number }) {
    const scene = this.scenes.get(sceneId);
    const driver = this.sceneDriver.get(sceneId);
    if (!scene || !driver?.activateScene) throw new Error(`Unknown scene ${sceneId}`);
    await driver.activateScene(scene.nativeId, options);
  }

  snapshot(): RegistrySnapshot {
    return {
      devices: [...this.devices.values()].sort(byRoomThenName),
      scenes: [...this.scenes.values()],
      errors: [...this.errors].map(([driver, message]) => ({ driver: driver.label, message })),
    };
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    const snap = this.snapshot();
    this.listeners.forEach((l) => l(snap));
  }

  private onDriverEvent(driver: Driver, event: DriverEvent) {
    switch (event.type) {
      case 'device-updated': {
        const device = this.devices.get(event.deviceId);
        if (!device) return;
        this.devices.set(event.deviceId, {
          ...device,
          state: { ...device.state, ...event.state },
          reachable: event.reachable ?? device.reachable,
        });
        this.notify();
        return;
      }
      case 'devices-changed':
        void this.refresh(driver);
        return;
      case 'connection':
        if (event.status === 'disconnected' && event.error) this.errors.set(driver, event.error);
        else if (event.status === 'connected') {
          this.errors.delete(driver);
          // Catch up on anything missed while the stream was down.
          void this.refresh(driver);
          return;
        }
        this.notify();
    }
  }
}
