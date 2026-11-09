import Slider from '@react-native-community/slider';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { hsvToRgb, kelvinToRgb, rgbToHex } from '@/core/color';
import type { LightState } from '@/core/types';
import { registry, useHome } from '@/store/home';
import { colors, displayColor, radius, spacing } from '@/ui/theme';

const HUES = [0, 20, 35, 50, 90, 140, 180, 200, 230, 260, 290, 320];
const COLOR_SWATCHES = [
  ...HUES.map((h) => hsvToRgb({ h, s: 1, v: 1 })),
  ...HUES.map((h) => hsvToRgb({ h, s: 0.45, v: 1 })),
];
const WHITES = [2200, 2700, 3000, 4000, 5000, 6500];

/** Minimum gap between brightness commands while the slider is moving. */
const SLIDE_THROTTLE_MS = 150;

export default function LightScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const device = useHome((s) => s.devices.find((d) => d.id === id));
  const lastSent = useRef(0);

  if (!device) {
    return (
      <View style={styles.missing}>
        <Text style={styles.muted}>This light is no longer available.</Text>
      </View>
    );
  }

  const send = (state: LightState, transitionMs = 400) => {
    registry.setState(device.id, state, { transitionMs }).catch(() => {});
  };

  const caps = device.capabilities;
  const whites = caps.temperature
    ? WHITES.filter((k) => k >= caps.temperature!.minKelvin - 50 && k <= caps.temperature!.maxKelvin + 50)
    : caps.color
      ? WHITES
      : [];

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: device.name }} />
      <View style={[styles.preview, { backgroundColor: displayColor(device.state) }]} />

      <View style={styles.row}>
        <Text style={styles.label}>{device.room ?? 'Light'}</Text>
        <Switch value={!!device.state.on} onValueChange={(on) => send({ on })} disabled={!device.reachable} />
      </View>

      {caps.brightness && (
        <View style={styles.section}>
          <Text style={styles.label}>Brightness {Math.round(device.state.brightness ?? 0)}%</Text>
          <Slider
            minimumValue={1}
            maximumValue={100}
            value={device.state.brightness ?? 100}
            minimumTrackTintColor={colors.accent}
            maximumTrackTintColor={colors.border}
            onValueChange={(v) => {
              const now = Date.now();
              if (now - lastSent.current < SLIDE_THROTTLE_MS) return;
              lastSent.current = now;
              send({ brightness: v }, 100);
            }}
            onSlidingComplete={(v) => send({ brightness: v }, 100)}
          />
        </View>
      )}

      {caps.color && (
        <View style={styles.section}>
          <Text style={styles.label}>Colour</Text>
          <View style={styles.swatches}>
            {COLOR_SWATCHES.map((rgb) => (
              <Pressable
                key={rgbToHex(rgb)}
                accessibilityLabel={`Colour ${rgbToHex(rgb)}`}
                style={[styles.swatch, { backgroundColor: rgbToHex(rgb) }]}
                onPress={() => send({ on: true, color: { mode: 'rgb', rgb } })}
              />
            ))}
          </View>
        </View>
      )}

      {whites.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.label}>White</Text>
          <View style={styles.swatches}>
            {whites.map((kelvin) => (
              <Pressable
                key={kelvin}
                accessibilityLabel={`${kelvin} kelvin`}
                style={[styles.swatch, styles.whiteSwatch, { backgroundColor: rgbToHex(kelvinToRgb(kelvin)) }]}
                onPress={() => send({ on: true, color: { mode: 'temperature', kelvin } })}
              >
                <Text style={styles.kelvin}>{kelvin}K</Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.xl },
  missing: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  muted: { color: colors.textMuted },
  preview: { height: 140, borderRadius: radius.lg },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  section: { gap: spacing.md },
  label: { color: colors.text, fontSize: 16, fontWeight: '600' },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  swatch: { width: 44, height: 44, borderRadius: 22 },
  whiteSwatch: { width: 64, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  kelvin: { fontSize: 11, fontWeight: '600', color: '#222' },
});
