/** Brands/protocols the app can talk to. Each one has a driver in `src/drivers`. */
export type DriverId = 'hue' | 'govee' | 'homekit';

/** RGB with each channel in 0..255. */
export type Rgb = { r: number; g: number; b: number };

/** Hue in degrees 0..360, saturation and value in 0..1. */
export type Hsv = { h: number; s: number; v: number };

/** CIE 1931 chromaticity. */
export type Xy = { x: number; y: number };

/**
 * Colour of a light. Drivers convert to whatever their protocol wants;
 * `rgb` is the common currency and `kelvin` is used for white light.
 */
export type LightColor = { mode: 'rgb'; rgb: Rgb } | { mode: 'temperature'; kelvin: number };

/** A desired (partial) or reported light state. */
export type LightState = {
  on?: boolean;
  /** 0..100 (percent). */
  brightness?: number;
  color?: LightColor;
};

export type Capabilities = {
  onOff: boolean;
  brightness: boolean;
  color: boolean;
  /** Supported white range in kelvin, if the light can do tunable white. */
  temperature?: { minKelvin: number; maxKelvin: number };
};

export type Device = {
  /** Globally unique: `${driver}:${nativeId}`. */
  id: string;
  driver: DriverId;
  /** The id the driver/protocol uses. */
  nativeId: string;
  name: string;
  /** Room/zone name as reported by the brand's own app, if any. */
  room?: string;
  model?: string;
  capabilities: Capabilities;
  state: LightState;
  reachable: boolean;
};

/** A scene stored on a device hub (e.g. a Hue bridge), as opposed to one run by our engine. */
export type HubScene = {
  id: string;
  driver: DriverId;
  nativeId: string;
  name: string;
  room?: string;
  /** True when the hub can animate it on its own (Hue "dynamic" scenes). */
  dynamic: boolean;
  /** Up to a few representative colours, for the UI swatch. */
  palette: Rgb[];
};

export const deviceId = (driver: DriverId, nativeId: string) => `${driver}:${nativeId}`;
