import { hueLightToDevice, hueSceneToHubScene, mergeHueLight, toHueLightPut } from '../mapping';
import { colorLight, connectivity, readingScene, rooms, spookyScene, whiteLight } from '../__fixtures__/fakeBridge';

describe('Hue mapping', () => {
  it('maps a colour light with its room, capabilities and reachability', () => {
    const device = hueLightToDevice(colorLight, rooms, connectivity);
    expect(device).toMatchObject({
      id: 'hue:light-color',
      name: 'Lounge lamp',
      room: 'Lounge',
      reachable: true,
      capabilities: { onOff: true, brightness: true, color: true, temperature: { minKelvin: 2000, maxKelvin: 6536 } },
      state: { on: true, brightness: 80, color: { mode: 'rgb' } },
    });
  });

  it('maps a white-ambiance light to temperature state and flags connectivity issues', () => {
    const device = hueLightToDevice(whiteLight, rooms, connectivity);
    expect(device.room).toBeUndefined();
    expect(device.reachable).toBe(false);
    expect(device.capabilities.color).toBe(false);
    expect(device.state.color).toEqual({ mode: 'temperature', kelvin: 2703 });
  });

  it('builds PUT bodies: colour inside gamut, clamped brightness, transition', () => {
    const body = toHueLightPut(
      { brightness: 0.05, color: { mode: 'rgb', rgb: { r: 255, g: 0, b: 0 } } },
      colorLight,
      400,
    );
    expect(body.on).toEqual({ on: true });
    expect(body.dimming).toEqual({ brightness: 0.2 });
    expect(body.dynamics).toEqual({ duration: 400 });
    expect(body.color!.xy.x).toBeLessThanOrEqual(0.6915);
  });

  it('turns the light off for brightness 0 and clamps mireds to the lamp range', () => {
    expect(toHueLightPut({ brightness: 0 }, colorLight)).toEqual({ on: { on: false } });
    expect(toHueLightPut({ color: { mode: 'temperature', kelvin: 1800 } }, whiteLight)).toEqual({
      color_temperature: { mirek: 454 },
    });
  });

  it('ignores RGB for white-only lights', () => {
    expect(toHueLightPut({ color: { mode: 'rgb', rgb: { r: 255, g: 0, b: 0 } } }, whiteLight)).toEqual({});
  });

  it('marks palette scenes as dynamic and builds swatches', () => {
    const spooky = hueSceneToHubScene(spookyScene, rooms);
    expect(spooky).toMatchObject({ id: 'hue:scene-spooky', room: 'Lounge', dynamic: true });
    expect(spooky.palette).toHaveLength(2);
    const reading = hueSceneToHubScene(readingScene, rooms);
    expect(reading.dynamic).toBe(false);
    expect(reading.palette).toHaveLength(1);
  });

  it('merges event-stream patches', () => {
    const merged = mergeHueLight(whiteLight, { id: whiteLight.id, type: 'light', on: { on: true } });
    expect(merged.on.on).toBe(true);
    expect(merged.dimming?.brightness).toBe(40);
  });
});
