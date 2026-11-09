import type { Device } from '@/core/types';
import type { Driver, DriverEvent } from '@/drivers/Driver';

import { DeviceRegistry } from '../DeviceRegistry';

function makeDevice(id: string, room?: string): Device {
  return {
    id: `hue:${id}`,
    driver: 'hue',
    nativeId: id,
    name: id,
    room,
    capabilities: { onOff: true, brightness: true, color: true },
    state: { on: false, brightness: 50 },
    reachable: true,
  };
}

function makeDriver(devices: Device[]) {
  let emit: (e: DriverEvent) => void = () => {};
  const driver: Driver & { setState: jest.Mock } = {
    id: 'hue',
    label: 'Test hub',
    maxCommandsPerSecond: 10,
    listDevices: jest.fn(async () => devices),
    setState: jest.fn(async () => {}),
    subscribe: (listener) => {
      emit = listener;
      return () => {};
    },
  };
  return { driver, emit: (e: DriverEvent) => emit(e) };
}

describe('DeviceRegistry', () => {
  it('aggregates devices sorted by room then name', async () => {
    const registry = new DeviceRegistry();
    registry.addDriver(makeDriver([makeDevice('b', 'Lounge'), makeDevice('z'), makeDevice('a', 'Lounge')]).driver);
    await registry.refresh();
    expect(registry.snapshot().devices.map((d) => d.id)).toEqual(['hue:a', 'hue:b', 'hue:z']);
  });

  it('routes commands to the owning driver with optimistic state', async () => {
    const registry = new DeviceRegistry();
    const { driver } = makeDriver([makeDevice('a')]);
    registry.addDriver(driver);
    await registry.refresh();
    await registry.setState('hue:a', { brightness: 80 }, { transitionMs: 100 });
    expect(driver.setState).toHaveBeenCalledWith('a', { brightness: 80 }, { transitionMs: 100 });
    expect(registry.getDevice('hue:a')!.state).toEqual({ on: true, brightness: 80 });
  });

  it('reverts optimistic state when the command fails', async () => {
    const registry = new DeviceRegistry();
    const { driver } = makeDriver([makeDevice('a')]);
    driver.setState.mockRejectedValueOnce(new Error('boom'));
    registry.addDriver(driver);
    await registry.refresh();
    await expect(registry.setState('hue:a', { on: true })).rejects.toThrow('boom');
    expect(registry.getDevice('hue:a')!.state.on).toBe(false);
  });

  it('applies live updates and records driver errors', async () => {
    const registry = new DeviceRegistry();
    const { driver, emit } = makeDriver([makeDevice('a')]);
    registry.addDriver(driver);
    await registry.refresh();
    const seen: number[] = [];
    registry.onChange((s) => seen.push(s.devices.length));
    emit({ type: 'device-updated', deviceId: 'hue:a', state: { on: true }, reachable: false });
    expect(registry.getDevice('hue:a')).toMatchObject({ state: { on: true, brightness: 50 }, reachable: false });
    emit({ type: 'connection', status: 'disconnected', error: 'lost' });
    expect(registry.snapshot().errors).toEqual([{ driver: 'Test hub', message: 'lost' }]);
    expect(seen.length).toBe(2);
  });

  it('drops a removed driver\'s devices', async () => {
    const registry = new DeviceRegistry();
    const { driver } = makeDriver([makeDevice('a')]);
    registry.addDriver(driver);
    await registry.refresh();
    registry.removeDriver(driver);
    expect(registry.snapshot().devices).toEqual([]);
  });
});
