import { HueError, LINK_BUTTON_NOT_PRESSED, pairBridge, pairWhenButtonPressed, probeBridge } from '../HueClient';
import { HueDriver } from '../HueDriver';
import { BRIDGE_ID, FakeBridge, FINGERPRINT } from '../__fixtures__/fakeBridge';

const connection = {
  bridgeId: BRIDGE_ID,
  host: '192.168.1.20',
  name: 'Hue Bridge',
  appKey: 'app-key',
  fingerprint: FINGERPRINT,
};

describe('Hue pairing', () => {
  it('probes the bridge and captures its certificate', async () => {
    const bridge = new FakeBridge();
    const { config, fingerprint } = await probeBridge(bridge, '192.168.1.20');
    expect(config.bridgeid).toBe(BRIDGE_ID);
    expect(fingerprint).toBe(FINGERPRINT);
    expect(bridge.requests[0].pinnedFingerprint).toBeUndefined();
  });

  it('rejects a certificate issued for a different bridge', async () => {
    const bridge = new FakeBridge();
    const original = bridge.request.bind(bridge);
    bridge.request = async (req) => ({ ...(await original(req)), commonName: 'someoneelse' });
    await expect(probeBridge(bridge, '192.168.1.20')).rejects.toThrow(/Certificate is for/);
  });

  it('reports link-button-not-pressed, then succeeds once pressed, with pinning', async () => {
    const bridge = new FakeBridge();
    const attempt = pairBridge(bridge, '192.168.1.20', BRIDGE_ID, FINGERPRINT);
    await expect(attempt).rejects.toBeInstanceOf(HueError);
    await expect(attempt).rejects.toMatchObject({ code: LINK_BUTTON_NOT_PRESSED });

    bridge.linkButtonPressed = true;
    await expect(pairBridge(bridge, '192.168.1.20', BRIDGE_ID, FINGERPRINT)).resolves.toEqual({
      appKey: 'app-key',
      clientKey: 'client-key',
    });
    const last = bridge.requests.at(-1)!;
    expect(last.pinnedFingerprint).toBe(FINGERPRINT);
    expect(last.expectedCommonName).toBe(BRIDGE_ID.toLowerCase());
  });
});

describe('HueDriver', () => {
  it('lists devices and scenes', async () => {
    const driver = new HueDriver(new FakeBridge(), connection);
    const devices = await driver.listDevices();
    expect(devices.map((d) => d.name)).toEqual(['Lounge lamp', 'Hall ceiling']);
    const scenes = await driver.listScenes();
    expect(scenes.map((s) => [s.name, s.dynamic])).toEqual([
      ['Read', false],
      ['Spooky', true],
    ]);
  });

  it('sends light commands with the app key and pinned certificate', async () => {
    const bridge = new FakeBridge();
    const driver = new HueDriver(bridge, connection);
    await driver.listDevices();
    await driver.setState('light-color', { on: true, brightness: 50 }, { transitionMs: 250 });
    const put = bridge.requests.at(-1)!;
    expect(put.method).toBe('PUT');
    expect(put.url).toBe('https://192.168.1.20/clip/v2/resource/light/light-color');
    expect(put.headers?.['hue-application-key']).toBe('app-key');
    expect(put.pinnedFingerprint).toBe(FINGERPRINT);
    expect(JSON.parse(put.body!)).toEqual({ on: { on: true }, dimming: { brightness: 50 }, dynamics: { duration: 250 } });
  });

  it('recalls scenes statically or as a dynamic palette', async () => {
    const bridge = new FakeBridge();
    const driver = new HueDriver(bridge, connection);
    await driver.activateScene('scene-spooky', { dynamic: true, speed: 0.4 });
    expect(JSON.parse(bridge.requests.at(-1)!.body!)).toEqual({ recall: { action: 'dynamic_palette' }, speed: 0.4 });
    await driver.activateScene('scene-read');
    expect(JSON.parse(bridge.requests.at(-1)!.body!)).toEqual({ recall: { action: 'active' } });
  });

  it('turns event-stream updates into device events and reconnects when the stream drops', async () => {
    jest.useFakeTimers();
    const bridge = new FakeBridge();
    const driver = new HueDriver(bridge, connection);
    await driver.listDevices();
    const events: unknown[] = [];
    const unsubscribe = driver.subscribe((e) => events.push(e));

    bridge.emit([
      {
        id: 'c1',
        creationtime: '',
        type: 'update',
        data: [{ id: 'light-white', type: 'light', on: { on: true }, dimming: { brightness: 75 } }],
      },
      {
        id: 'c2',
        creationtime: '',
        type: 'update',
        data: [{ id: 'zb-1', type: 'zigbee_connectivity', owner: { rid: 'device-1' }, status: 'disconnected' }],
      },
    ]);
    expect(events).toEqual([
      { type: 'connection', status: 'connected' },
      {
        type: 'device-updated',
        deviceId: 'hue:light-white',
        state: { on: true, brightness: 75, color: { mode: 'temperature', kelvin: 2703 } },
      },
      { type: 'device-updated', deviceId: 'hue:light-color', state: {}, reachable: false },
    ]);

    bridge.streams[0].handlers.onEnd('The network connection was lost.');
    expect(events.at(-1)).toEqual({
      type: 'connection',
      status: 'disconnected',
      error: 'The network connection was lost.',
    });
    expect(bridge.streams).toHaveLength(1);
    jest.advanceTimersByTime(1000);
    expect(bridge.streams).toHaveLength(2);

    unsubscribe();
    expect(bridge.streams[1].closed).toBe(true);
    jest.useRealTimers();
  });
});

describe('pairWhenButtonPressed', () => {
  it('polls until the button is pressed', async () => {
    const bridge = new FakeBridge();
    let clock = 0;
    const sleep = jest.fn(async (ms: number) => {
      clock += ms;
      if (clock >= 4000) bridge.linkButtonPressed = true;
    });
    const keys = await pairWhenButtonPressed(bridge, 'h', BRIDGE_ID, FINGERPRINT, { now: () => clock, sleep });
    expect(keys).toEqual({ appKey: 'app-key', clientKey: 'client-key' });
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('times out, and returns null when cancelled', async () => {
    const bridge = new FakeBridge();
    let clock = 0;
    const sleep = async (ms: number) => {
      clock += ms;
    };
    await expect(
      pairWhenButtonPressed(bridge, 'h', BRIDGE_ID, FINGERPRINT, { now: () => clock, sleep, timeoutMs: 5000 }),
    ).rejects.toThrow(/Timed out/);
    await expect(
      pairWhenButtonPressed(bridge, 'h', BRIDGE_ID, FINGERPRINT, { isCancelled: () => true }),
    ).resolves.toBeNull();
  });
});
