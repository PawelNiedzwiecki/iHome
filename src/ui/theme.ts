import { kelvinToRgb, rgbToHex } from '@/core/color';
import type { LightState } from '@/core/types';

export const colors = {
  background: '#0E0F13',
  surface: '#181A20',
  surfaceRaised: '#22252D',
  border: '#2C2F38',
  text: '#F2F3F5',
  textMuted: '#9599A4',
  accent: '#FFB547',
  danger: '#FF6B6B',
  off: '#3A3D46',
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };
export const radius = { sm: 8, md: 14, lg: 20 };

/** The colour to paint a light's tile/swatch, given its state. */
export function displayColor(state: LightState): string {
  if (!state.on) return colors.off;
  if (state.color?.mode === 'rgb') return rgbToHex(state.color.rgb);
  if (state.color?.mode === 'temperature') return rgbToHex(kelvinToRgb(state.color.kelvin));
  return '#FFE8C2';
}

/** Black or white text for legibility on `hex`. */
export function textOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#111' : '#fff';
}
