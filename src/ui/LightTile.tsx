import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import type { Device } from '@/core/types';

import { colors, displayColor, radius, spacing, textOn } from './theme';

type Props = {
  device: Device;
  onPress: () => void;
  onToggle: (on: boolean) => void;
};

export function LightTile({ device, onPress, onToggle }: Props) {
  const bg = device.reachable ? displayColor(device.state) : colors.surface;
  const fg = device.state.on && device.reachable ? textOn(bg) : colors.text;
  const subtitle = !device.reachable
    ? 'Unreachable'
    : device.state.on
      ? device.state.brightness !== undefined
        ? `${Math.round(device.state.brightness)}%`
        : 'On'
      : 'Off';

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.tile, { backgroundColor: bg, opacity: pressed ? 0.85 : 1 }]}
      accessibilityRole="button"
      accessibilityLabel={`${device.name}, ${subtitle}`}
    >
      <View style={styles.header}>
        <Text style={[styles.brand, { color: fg }]}>{device.driver.toUpperCase()}</Text>
        <Switch
          value={!!device.state.on}
          onValueChange={onToggle}
          disabled={!device.reachable}
          trackColor={{ true: 'rgba(0,0,0,0.35)', false: colors.border }}
        />
      </View>
      <Text style={[styles.name, { color: fg }]} numberOfLines={2}>
        {device.name}
      </Text>
      <Text style={[styles.subtitle, { color: fg }]}>{subtitle}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: {
    flex: 1,
    minHeight: 120,
    borderRadius: radius.md,
    padding: spacing.md,
    justifyContent: 'space-between',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  brand: { fontSize: 10, fontWeight: '700', letterSpacing: 1, opacity: 0.7 },
  name: { fontSize: 16, fontWeight: '600', marginTop: spacing.sm },
  subtitle: { fontSize: 13, opacity: 0.8 },
});
