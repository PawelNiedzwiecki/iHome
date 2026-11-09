import { GoveeDriver, type GoveeDeviceRecord } from '../GoveeDriver';
import { FakeGoveeNetwork, makeLamp } from '../__fixtures__/fakeGoveeNetwork';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

async function run<T>(promise: Promise<T>, ms = 3000): Promise<T> {
  await jest.advanceTimersByTimeAsync(ms);
  return promise;
}

describe('GoveeDriver', () => {
  it('discovers lamps by multicast scan and saves them', async () => {
    const net = new FakeGoveeNetwork([
      makeLamp('192.168.1.30', 'AA:BB:CC:DD:EE:FF:00:11', 'H6008'),
      makeLamp('192.168.1.31', 'AA:BB:CC:DD:EE:FF:00:22', 'H6199'),
    ]);
    const saved: GoveeDeviceRecord[][] = [];
    const driver = new GoveeDriver(net, { onRecordsChanged: (r) => saved.push(r) });

    const devices = await run(driver.listDevices());
    expect(driver.multicastAvailable).toBe(true);
    expect(devices.map((d) => [d.id, d.name, d.model, d.reachable])).toEqual([
      ['govee:AA:BB:CC:DD:EE:FF:00:11', 'Govee H6008 0011', 'H6008', true],
      ['govee:AA:BB:CC:DD:EE:FF:00:22', 'Govee H6199 0022', 'H6199', true],
    ]);
    expect(saved.at(-1)).toHaveLength(2);
  });

  it('finds known lamps without multicast, and follows an IP change', async () => {
    const lamp = makeLamp('192.168.1.30', 'AA:BB:CC:DD:EE:FF:00:11');
    const net = new FakeGoveeNetwork([lamp]);
    net.multicastAllowed = false;
    const driver = new GoveeDriver(net, {
      records: [{ id: lamp.device, host: '192.168.1.30', sku: 'H6008', name: 'Desk strip' }],
    });

    let devices = await run(driver.listDevices());
    expect(driver.multicastAvailable).toBe(false);
    expect(devices[0]).toMatchObject({ name: 'Desk strip', reachable: true, state: { on: false } });

    // The scan reply carries the IP, so a DHCP change is picked up when we hear from the lamp.
    net.multicastAllowed = true;
    lamp.ip = '192.168.1.99';
    devices = await run(driver.listDevices());
    expect(driver.getRecords()[0]).toEqual({ id: lamp.device, host: '192.168.1.99', sku: 'H6008', name: 'Desk strip' });
  });

  it('adds a lamp by IP, falling back to devStatus when it ignores unicast scans', async () => {
    const quiet = makeLamp('192.168.1.40', 'AA:00:00:00:00:00:00:01', 'H6008', { answersUnicastScan: false });
    const net = new FakeGoveeNetwork([makeLamp('192.168.1.30', 'AA:00:00:00:00:00:00:02'), quiet]);
    const driver = new GoveeDriver(net);

    await expect(run(driver.addByHost('192.168.1.30'))).resolves.toMatchObject({ id: 'AA:00:00:00:00:00:00:02' });
    await expect(run(driver.addByHost('192.168.1.40'))).resolves.toEqual({
      id: 'ip:192.168.1.40',
      host: '192.168.1.40',
      sku: 'Govee',
    });
    const failed = driver.addByHost('192.168.1.77');
    const assertion = expect(failed).rejects.toThrow(/LAN Control/);
    await jest.advanceTimersByTimeAsync(3000);
    await assertion;

    // Once multicast works, the IP-only record is replaced by the real device ID.
    await run(driver.listDevices());
    expect(driver.getRecords().map((r) => r.id).sort()).toEqual([
      'AA:00:00:00:00:00:00:01',
      'AA:00:00:00:00:00:00:02',
    ]);
  });

  it('sends commands and skips a redundant turn-on', async () => {
    const lamp = makeLamp('192.168.1.30', 'AA:00:00:00:00:00:00:02');
    const net = new FakeGoveeNetwork([lamp]);
    const driver = new GoveeDriver(net);
    await run(driver.listDevices());

    await driver.setState(lamp.device, { color: { mode: 'rgb', rgb: { r: 255, g: 80, b: 0 } }, brightness: 60 });
    await driver.setState(lamp.device, { brightness: 30 });
    expect(net.commandsTo(lamp.ip).filter((c) => c.cmd !== 'devStatus').map((c) => c.cmd)).toEqual([
      'turn',
      'colorwc',
      'brightness',
      'brightness',
    ]);
    expect(lamp.status).toEqual({ onOff: 1, brightness: 30, color: { r: 255, g: 80, b: 0 }, colorTemInKelvin: 0 });
  });

  it('polls state while subscribed and reports lamps that stop answering', async () => {
    const lamp = makeLamp('192.168.1.30', 'AA:00:00:00:00:00:00:02');
    const net = new FakeGoveeNetwork([lamp]);
    const driver = new GoveeDriver(net, { pollIntervalMs: 1000 });
    await run(driver.listDevices());
    const events: unknown[] = [];
    const unsubscribe = driver.subscribe((e) => events.push(e));

    lamp.status = { ...lamp.status, onOff: 1 };
    await jest.advanceTimersByTimeAsync(1000);
    expect(events).toContainEqual({
      type: 'device-updated',
      deviceId: 'govee:AA:00:00:00:00:00:00:02',
      state: { on: true, brightness: 100, color: { mode: 'rgb', rgb: { r: 255, g: 255, b: 255 } } },
      reachable: true,
    });

    lamp.offline = true;
    await jest.advanceTimersByTimeAsync(4000);
    expect(events.at(-1)).toEqual({
      type: 'device-updated',
      deviceId: 'govee:AA:00:00:00:00:00:00:02',
      state: {},
      reachable: false,
    });
    unsubscribe();
  });
});
