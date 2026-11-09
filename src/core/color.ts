import type { Hsv, Rgb, Xy } from './types';

export const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

// ---------- RGB <-> HSV ----------

export function rgbToHsv({ r, g, b }: Rgb): Hsv {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

export function hsvToRgb({ h, s, v }: Hsv): Rgb {
  const hh = (((h % 360) + 360) % 360) / 60;
  const c = v * s;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  const m = v - c;
  let rgb: [number, number, number];
  if (hh < 1) rgb = [c, x, 0];
  else if (hh < 2) rgb = [x, c, 0];
  else if (hh < 3) rgb = [0, c, x];
  else if (hh < 4) rgb = [0, x, c];
  else if (hh < 5) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  return {
    r: Math.round((rgb[0] + m) * 255),
    g: Math.round((rgb[1] + m) * 255),
    b: Math.round((rgb[2] + m) * 255),
  };
}

// ---------- Hex ----------

export function rgbToHex({ r, g, b }: Rgb): string {
  const h = (n: number) => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

export function hexToRgb(hex: string): Rgb {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`Invalid hex colour: ${hex}`);
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

// ---------- RGB <-> CIE xy (Philips Hue) ----------

const gammaExpand = (c: number) => (c > 0.04045 ? ((c + 0.055) / 1.055) ** 2.4 : c / 12.92);
const gammaCompress = (c: number) =>
  c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;

/** sRGB → CIE xy using the wide-gamut D65 matrix recommended by Signify. */
export function rgbToXy({ r, g, b }: Rgb): Xy {
  const R = gammaExpand(r / 255);
  const G = gammaExpand(g / 255);
  const B = gammaExpand(b / 255);
  const X = R * 0.664511 + G * 0.154324 + B * 0.162028;
  const Y = R * 0.283881 + G * 0.668433 + B * 0.047685;
  const Z = R * 0.000088 + G * 0.07231 + B * 0.986039;
  const sum = X + Y + Z;
  if (sum === 0) return { x: 0.3127, y: 0.329 }; // black → D65 white point
  return { x: X / sum, y: Y / sum };
}

/** CIE xy → sRGB at full brightness (the brightest colour with that chromaticity). */
export function xyToRgb({ x, y }: Xy): Rgb {
  if (y <= 0) return { r: 255, g: 255, b: 255 };
  const Y = 1;
  const X = (Y / y) * x;
  const Z = (Y / y) * (1 - x - y);
  let R = X * 1.656492 - Y * 0.354851 - Z * 0.255038;
  let G = -X * 0.707196 + Y * 1.655397 + Z * 0.036152;
  let B = X * 0.051713 - Y * 0.121364 + Z * 1.01153;
  // Bring into range keeping the hue, then gamma-compress.
  const max = Math.max(R, G, B, 1e-9);
  R = Math.max(0, R / max);
  G = Math.max(0, G / max);
  B = Math.max(0, B / max);
  return {
    r: Math.round(clamp(gammaCompress(R), 0, 1) * 255),
    g: Math.round(clamp(gammaCompress(G), 0, 1) * 255),
    b: Math.round(clamp(gammaCompress(B), 0, 1) * 255),
  };
}

export type Gamut = { red: Xy; green: Xy; blue: Xy };

const cross = (a: Xy, b: Xy) => a.x * b.y - a.y * b.x;
const sub = (a: Xy, b: Xy): Xy => ({ x: a.x - b.x, y: a.y - b.y });

export function isInGamut(p: Xy, { red, green, blue }: Gamut): boolean {
  const v1 = sub(green, red);
  const v2 = sub(blue, red);
  const q = sub(p, red);
  const denom = cross(v1, v2);
  const s = cross(q, v2) / denom;
  const t = cross(v1, q) / denom;
  return s >= 0 && t >= 0 && s + t <= 1;
}

function closestOnSegment(p: Xy, a: Xy, b: Xy): Xy {
  const ab = sub(b, a);
  const ap = sub(p, a);
  const t = clamp((ap.x * ab.x + ap.y * ab.y) / (ab.x * ab.x + ab.y * ab.y), 0, 1);
  return { x: a.x + ab.x * t, y: a.y + ab.y * t };
}

/** Moves a point that a lamp can't show to the nearest colour it can. */
export function clampToGamut(p: Xy, gamut: Gamut): Xy {
  if (isInGamut(p, gamut)) return p;
  const candidates = [
    closestOnSegment(p, gamut.red, gamut.green),
    closestOnSegment(p, gamut.green, gamut.blue),
    closestOnSegment(p, gamut.blue, gamut.red),
  ];
  const dist = (q: Xy) => (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
  return candidates.reduce((best, q) => (dist(q) < dist(best) ? q : best));
}

// ---------- Colour temperature ----------

export const kelvinToMired = (kelvin: number) => Math.round(1_000_000 / kelvin);
export const miredToKelvin = (mired: number) => Math.round(1_000_000 / mired);

/** Approximate RGB of a black body at `kelvin` (Tanner Helland's fit), for UI swatches and RGB-only lamps. */
export function kelvinToRgb(kelvin: number): Rgb {
  const t = clamp(kelvin, 1000, 40000) / 100;
  const r = t <= 66 ? 255 : 329.698727446 * (t - 60) ** -0.1332047592;
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * (t - 60) ** -0.0755148492;
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  return {
    r: Math.round(clamp(r, 0, 255)),
    g: Math.round(clamp(g, 0, 255)),
    b: Math.round(clamp(b, 0, 255)),
  };
}

// ---------- Blending (used by the scene engine) ----------

/** Linear blend in RGB, `t` in 0..1. */
export function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  const k = clamp(t, 0, 1);
  return {
    r: Math.round(a.r + (b.r - a.r) * k),
    g: Math.round(a.g + (b.g - a.g) * k),
    b: Math.round(a.b + (b.b - a.b) * k),
  };
}
