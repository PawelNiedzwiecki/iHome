import {
  clampToGamut,
  hexToRgb,
  hsvToRgb,
  isInGamut,
  kelvinToMired,
  kelvinToRgb,
  miredToKelvin,
  mixRgb,
  rgbToHex,
  rgbToHsv,
  rgbToXy,
  xyToRgb,
} from '../color';
import { GAMUT_C } from '@/drivers/hue/mapping';

describe('colour conversions', () => {
  it('round-trips RGB through HSV', () => {
    for (const rgb of [
      { r: 255, g: 0, b: 0 },
      { r: 12, g: 200, b: 99 },
      { r: 128, g: 0, b: 255 },
      { r: 0, g: 0, b: 0 },
      { r: 255, g: 255, b: 255 },
    ]) {
      expect(hsvToRgb(rgbToHsv(rgb))).toEqual(rgb);
    }
  });

  it('parses and formats hex', () => {
    expect(hexToRgb('#ff7a00')).toEqual({ r: 255, g: 122, b: 0 });
    expect(rgbToHex({ r: 255, g: 122, b: 0 })).toBe('#ff7a00');
    expect(() => hexToRgb('orange')).toThrow();
  });

  it('maps sRGB primaries to the expected CIE xy region', () => {
    const red = rgbToXy({ r: 255, g: 0, b: 0 });
    expect(red.x).toBeCloseTo(0.7006, 3);
    expect(red.y).toBeCloseTo(0.2993, 3);
    const white = rgbToXy({ r: 255, g: 255, b: 255 });
    expect(white.x).toBeCloseTo(0.3227, 2);
    expect(white.y).toBeCloseTo(0.329, 2);
  });

  it('round-trips saturated colours through xy (hue preserved)', () => {
    for (const rgb of [
      { r: 255, g: 0, b: 0 },
      { r: 0, g: 255, b: 0 },
      { r: 0, g: 0, b: 255 },
      { r: 255, g: 120, b: 0 },
      { r: 120, g: 0, b: 255 },
    ]) {
      const back = xyToRgb(rgbToXy(rgb));
      expect(Math.abs(rgbToHsv(back).h - rgbToHsv(rgb).h)).toBeLessThan(3);
    }
  });

  it('clamps out-of-gamut points onto the gamut triangle', () => {
    const outside = { x: 0.8, y: 0.2 };
    expect(isInGamut(outside, GAMUT_C)).toBe(false);
    const clamped = clampToGamut(outside, GAMUT_C);
    expect(isInGamut({ x: clamped.x - 1e-6, y: clamped.y }, GAMUT_C) || isInGamut(clamped, GAMUT_C)).toBe(true);
    const inside = { x: 0.4, y: 0.4 };
    expect(clampToGamut(inside, GAMUT_C)).toEqual(inside);
  });

  it('converts kelvin and mireds', () => {
    expect(kelvinToMired(2700)).toBe(370);
    expect(miredToKelvin(370)).toBe(2703);
    const warm = kelvinToRgb(2200);
    const cool = kelvinToRgb(6500);
    expect(warm.r).toBe(255);
    expect(warm.b).toBeLessThan(cool.b);
  });

  it('mixes colours linearly', () => {
    expect(mixRgb({ r: 0, g: 0, b: 0 }, { r: 200, g: 100, b: 50 }, 0.5)).toEqual({ r: 100, g: 50, b: 25 });
    expect(mixRgb({ r: 0, g: 0, b: 0 }, { r: 200, g: 100, b: 50 }, 2)).toEqual({ r: 200, g: 100, b: 50 });
  });
});
