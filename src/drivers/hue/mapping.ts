import {
  clamp,
  clampToGamut,
  kelvinToMired,
  kelvinToRgb,
  miredToKelvin,
  rgbToXy,
  xyToRgb,
  type Gamut,
} from '@/core/color';
import { deviceId, type Device, type HubScene, type LightState, type Rgb } from '@/core/types';

import type { HueGroup, HueLight, HueLightPut, HueScene, HueZigbeeConnectivity } from './hueTypes';

/** Gamut C, used by most current Hue colour bulbs; the fallback when a light doesn't report one. */
export const GAMUT_C: Gamut = {
  red: { x: 0.6915, y: 0.3083 },
  green: { x: 0.17, y: 0.7 },
  blue: { x: 0.1532, y: 0.0475 },
};

export function hueLightState(light: HueLight): LightState {
  const state: LightState = { on: light.on.on };
  if (light.dimming) state.brightness = light.dimming.brightness;
  const ct = light.color_temperature;
  if (ct?.mirek_valid && ct.mirek) {
    state.color = { mode: 'temperature', kelvin: miredToKelvin(ct.mirek) };
  } else if (light.color) {
    state.color = { mode: 'rgb', rgb: xyToRgb(light.color.xy) };
  }
  return state;
}

/**
 * Builds a Device for a Hue light. `rooms` lets us show the room name from the Hue app;
 * room children are *devices*, and a light's `owner` is its device.
 */
export function hueLightToDevice(
  light: HueLight,
  rooms: HueGroup[],
  connectivity: HueZigbeeConnectivity[],
): Device {
  const ownerId = light.owner.rid;
  const room = rooms.find((r) => r.children.some((c) => c.rid === ownerId));
  const link = connectivity.find((z) => z.owner.rid === ownerId);
  const schema = light.color_temperature?.mirek_schema;
  return {
    id: deviceId('hue', light.id),
    driver: 'hue',
    nativeId: light.id,
    name: light.metadata.name,
    room: room?.metadata.name,
    model: light.metadata.archetype,
    capabilities: {
      onOff: true,
      brightness: !!light.dimming,
      color: !!light.color,
      temperature: schema
        ? {
            minKelvin: miredToKelvin(schema.mirek_maximum),
            maxKelvin: miredToKelvin(schema.mirek_minimum),
          }
        : undefined,
    },
    state: hueLightState(light),
    reachable: link ? link.status === 'connected' : true,
  };
}

/** Converts our LightState into a CLIP v2 `PUT /resource/light/{id}` body. */
export function toHueLightPut(
  state: LightState,
  light: Pick<HueLight, 'color' | 'color_temperature' | 'dimming'> | undefined,
  transitionMs?: number,
): HueLightPut {
  const body: HueLightPut = {};
  if (state.brightness !== undefined) {
    if (state.brightness <= 0) {
      body.on = { on: false };
    } else {
      const min = light?.dimming?.min_dim_level ?? 0.1;
      body.dimming = { brightness: clamp(state.brightness, min, 100) };
      if (state.on === undefined) body.on = { on: true };
    }
  }
  if (state.on !== undefined && !body.on) body.on = { on: state.on };

  const color = state.color;
  if (color?.mode === 'temperature') {
    const schema = light?.color_temperature?.mirek_schema;
    if (schema || !light?.color) {
      const mirek = kelvinToMired(color.kelvin);
      body.color_temperature = {
        mirek: schema ? clamp(mirek, schema.mirek_minimum, schema.mirek_maximum) : clamp(mirek, 153, 500),
      };
    } else {
      // Colour-only lamp: approximate the white point with xy.
      body.color = { xy: roundXy(clampToGamut(rgbToXy(kelvinToRgb(color.kelvin)), gamutOf(light))) };
    }
  } else if (color?.mode === 'rgb' && (light?.color || !light)) {
    body.color = { xy: roundXy(clampToGamut(rgbToXy(color.rgb), gamutOf(light))) };
  }

  if (transitionMs !== undefined) body.dynamics = { duration: Math.max(0, Math.round(transitionMs)) };
  return body;
}

const gamutOf = (light?: Pick<HueLight, 'color'>) => light?.color?.gamut ?? GAMUT_C;
const roundXy = ({ x, y }: { x: number; y: number }) => ({
  x: Math.round(x * 10000) / 10000,
  y: Math.round(y * 10000) / 10000,
});

/**
 * A scene is dynamic-capable when it has a colour palette. Hue's own gallery scenes
 * (including the Halloween ones) all ship with one.
 */
export function hueSceneToHubScene(scene: HueScene, groups: HueGroup[]): HubScene {
  const group = groups.find((g) => g.id === scene.group.rid);
  const fromPalette: Rgb[] = (scene.palette?.color ?? []).map((c) => xyToRgb(c.color.xy));
  const fromWhites: Rgb[] = (scene.palette?.color_temperature ?? []).map((c) =>
    kelvinToRgb(miredToKelvin(c.color_temperature.mirek)),
  );
  const fromActions: Rgb[] = scene.actions.flatMap((a) => {
    if (a.action.color) return [xyToRgb(a.action.color.xy)];
    if (a.action.color_temperature?.mirek) return [kelvinToRgb(miredToKelvin(a.action.color_temperature.mirek))];
    return [];
  });
  const palette = [...fromPalette, ...fromWhites];
  return {
    id: deviceId('hue', scene.id),
    driver: 'hue',
    nativeId: scene.id,
    name: scene.metadata.name,
    room: group?.metadata.name,
    dynamic: (scene.palette?.color.length ?? 0) > 0,
    palette: dedupe(palette.length ? palette : fromActions).slice(0, 5),
  };
}

function dedupe(colors: Rgb[]): Rgb[] {
  const seen = new Set<string>();
  return colors.filter((c) => {
    const key = `${c.r},${c.g},${c.b}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Applies a partial light resource from the event stream to the cached light
 * and returns the merged light.
 */
export function mergeHueLight(light: HueLight, patch: Record<string, unknown>): HueLight {
  const merged = { ...light } as Record<string, unknown>;
  for (const key of ['on', 'dimming', 'color', 'color_temperature', 'metadata'] as const) {
    if (patch[key] && typeof patch[key] === 'object') {
      merged[key] = { ...(light[key] as object | undefined), ...(patch[key] as object) };
    }
  }
  const result = merged as HueLight;
  // When the lamp switches to xy colour, the bridge reports mirek_valid: false.
  if (patch.color && result.color_temperature && !(patch.color_temperature as object | undefined)) {
    result.color_temperature = { ...result.color_temperature, mirek_valid: false };
  }
  return result;
}
