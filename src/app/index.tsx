import { Link, router, Stack } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { Device } from '@/core/types';
import { refreshHome, registry, useHome } from '@/store/home';
import { LightTile } from '@/ui/LightTile';
import { colors, radius, spacing } from '@/ui/theme';

export default function HomeScreen() {
  const { devices, errors, refreshing, hueBridges, goveeDevices, nativeMissing } = useHome();

  const rooms = useMemo(() => {
    const byRoom = new Map<string, Device[]>();
    for (const d of devices) {
      const room = d.room ?? 'Other';
      byRoom.set(room, [...(byRoom.get(room) ?? []), d]);
    }
    return [...byRoom];
  }, [devices]);

  const toggle = (device: Device, on: boolean) => {
    registry.setState(device.id, { on }).catch(() => {});
  };

  const setRoom = (list: Device[], on: boolean) => {
    list.filter((d) => d.reachable).forEach((d) => toggle(d, on));
  };

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () => (
            <View style={styles.headerButtons}>
              <Link href="/scenes" style={styles.headerLink}>
                Scenes
              </Link>
              <Link href="/settings" style={styles.headerLink}>
                Hubs
              </Link>
            </View>
          ),
        }}
      />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshHome} tintColor={colors.text} />}
      >
        {nativeMissing && (
          <Banner text="This build doesn't include the iHome native modules. Run a development build (npx expo run:ios or EAS) instead of Expo Go." />
        )}
        {errors.map((e) => (
          <Banner key={e.driver} text={`${e.driver}: ${e.message}`} />
        ))}

        {hueBridges.length === 0 && goveeDevices.length === 0 && devices.length === 0 && (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No lights yet</Text>
            <Text style={styles.emptyText}>Add your Philips Hue bridge or Govee lights to see them here.</Text>
            <Pressable style={styles.primaryButton} onPress={() => router.push('/settings/hue-setup')}>
              <Text style={styles.primaryButtonText}>Add Hue bridge</Text>
            </Pressable>
            <Text style={styles.roomAction} onPress={() => router.push('/settings/govee')}>
              Add Govee lights
            </Text>
          </View>
        )}

        {rooms.map(([room, list]) => (
          <View key={room} style={styles.room}>
            <View style={styles.roomHeader}>
              <Text style={styles.roomTitle}>{room}</Text>
              <View style={styles.roomActions}>
                <Text style={styles.roomAction} onPress={() => setRoom(list, true)}>
                  All on
                </Text>
                <Text style={styles.roomAction} onPress={() => setRoom(list, false)}>
                  All off
                </Text>
              </View>
            </View>
            <View style={styles.grid}>
              {list.map((device) => (
                <View key={device.id} style={styles.cell}>
                  <LightTile
                    device={device}
                    onPress={() => router.push({ pathname: '/light/[id]', params: { id: device.id } })}
                    onToggle={(on) => toggle(device, on)}
                  />
                </View>
              ))}
            </View>
          </View>
        ))}
      </ScrollView>
    </>
  );
}

function Banner({ text }: { text: string }) {
  return (
    <View style={styles.banner}>
      <Text style={styles.bannerText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.xl },
  headerButtons: { flexDirection: 'row', gap: spacing.lg },
  headerLink: { color: colors.accent, fontSize: 16, fontWeight: '600' },
  banner: { backgroundColor: '#3A2020', borderRadius: radius.sm, padding: spacing.md },
  bannerText: { color: '#FFC9C9' },
  empty: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xl * 2 },
  emptyTitle: { color: colors.text, fontSize: 20, fontWeight: '700' },
  emptyText: { color: colors.textMuted, textAlign: 'center' },
  primaryButton: {
    backgroundColor: colors.accent,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
  },
  primaryButtonText: { color: '#1A1100', fontWeight: '700', fontSize: 16 },
  room: { gap: spacing.md },
  roomHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  roomTitle: { color: colors.text, fontSize: 20, fontWeight: '700' },
  roomActions: { flexDirection: 'row', gap: spacing.lg },
  roomAction: { color: colors.accent, fontWeight: '600' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -spacing.xs },
  cell: { width: '50%', padding: spacing.xs },
});
