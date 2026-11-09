import { StyleSheet, View } from 'react-native';

import { rgbToHex } from '@/core/color';
import type { Rgb } from '@/core/types';

import { colors } from './theme';

export function PaletteStrip({ palette, height = 36 }: { palette: Rgb[]; height?: number }) {
  const swatches = palette.length ? palette : [{ r: 60, g: 62, b: 70 }];
  return (
    <View style={[styles.strip, { height }]}>
      {swatches.map((c, i) => (
        <View key={i} style={{ flex: 1, backgroundColor: rgbToHex(c) }} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    flexDirection: 'row',
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
});
