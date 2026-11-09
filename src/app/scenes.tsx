import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { HubScene } from '@/core/types';
import { registry, useHome } from '@/store/home';
import { PaletteStrip } from '@/ui/PaletteStrip';
import { colors, radius, spacing } from '@/ui/theme';

/**
 * Scenes stored on your hubs. Hue gallery scenes (including the Halloween ones you add
 * in the Hue app) have a palette, so they can be played "dynamic": the bridge animates
 * them itself and they keep running after you close iHome.
 */
export default function ScenesScreen() {
  const scenes = useHome((s) => s.scenes);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const byRoom = useMemo(() => {
    const map = new Map<string, HubScene[]>();
    for (const s of scenes) map.set(s.room ?? 'Other', [...(map.get(s.room ?? 'Other') ?? []), s]);
    return [...map];
  }, [scenes]);

  const play = async (scene: HubScene, dynamic: boolean) => {
    setBusy(scene.id);
    setError(null);
    try {
      await registry.activateScene(scene.id, { dynamic });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.content}>
      {error && <Text style={styles.error}>{error}</Text>}
      {scenes.length === 0 && (
        <Text style={styles.muted}>
          No scenes yet. Scenes you create or add from the gallery in the Hue app appear here.
        </Text>
      )}
      {byRoom.map(([room, list]) => (
        <View key={room} style={styles.room}>
          <Text style={styles.roomTitle}>{room}</Text>
          {list.map((scene) => (
            <View key={scene.id} style={styles.card}>
              <Pressable onPress={() => play(scene, false)} style={styles.cardMain} disabled={busy === scene.id}>
                <PaletteStrip palette={scene.palette} />
                <Text style={styles.sceneName}>{scene.name}</Text>
              </Pressable>
              {scene.dynamic && (
                <Pressable
                  style={styles.dynamicButton}
                  onPress={() => play(scene, true)}
                  disabled={busy === scene.id}
                  accessibilityLabel={`Play ${scene.name} as a dynamic scene`}
                >
                  <Text style={styles.dynamicText}>▶ Dynamic</Text>
                </Pressable>
              )}
            </View>
          ))}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.xl },
  muted: { color: colors.textMuted },
  error: { color: colors.danger },
  room: { gap: spacing.md },
  roomTitle: { color: colors.text, fontSize: 20, fontWeight: '700' },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  cardMain: { flex: 1, gap: spacing.sm },
  sceneName: { color: colors.text, fontSize: 15, fontWeight: '600' },
  dynamicButton: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.lg,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  dynamicText: { color: colors.accent, fontWeight: '700' },
});
