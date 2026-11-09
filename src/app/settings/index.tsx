import { router } from 'expo-router';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { removeHueBridge, useHome } from '@/store/home';
import { colors, radius, spacing } from '@/ui/theme';

export default function HubsScreen() {
  const bridges = useHome((s) => s.hueBridges);
  const goveeCount = useHome((s) => s.goveeDevices.length);

  const confirmRemove = (bridgeId: string, name: string) =>
    Alert.alert(`Remove ${name}?`, 'Its lights and scenes will disappear from iHome.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => void removeHueBridge(bridgeId) },
    ]);

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.section}>Philips Hue</Text>
      {bridges.map((b) => (
        <View key={b.bridgeId} style={styles.card}>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{b.name}</Text>
            <Text style={styles.muted}>
              {b.host} · {b.bridgeId}
            </Text>
          </View>
          <Text style={styles.remove} onPress={() => confirmRemove(b.bridgeId, b.name)}>
            Remove
          </Text>
        </View>
      ))}
      <Pressable style={styles.addButton} onPress={() => router.push('/settings/hue-setup')}>
        <Text style={styles.addText}>+ Add Hue bridge</Text>
      </Pressable>

      <Text style={styles.section}>Govee</Text>
      <Pressable style={styles.card} onPress={() => router.push('/settings/govee')}>
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>Govee lights</Text>
          <Text style={styles.muted}>{goveeCount === 0 ? 'None yet' : `${goveeCount} on your network`}</Text>
        </View>
        <Text style={styles.chevron}>›</Text>
      </Pressable>

      <Text style={styles.section}>Coming next</Text>
      <Text style={styles.muted}>Apple Home (HomeKit), for your IKEA lights.</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md },
  section: { color: colors.textMuted, fontSize: 13, fontWeight: '700', marginTop: spacing.lg, textTransform: 'uppercase' },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
  },
  name: { color: colors.text, fontSize: 16, fontWeight: '600' },
  muted: { color: colors.textMuted },
  remove: { color: colors.danger, fontWeight: '600' },
  chevron: { color: colors.textMuted, fontSize: 24 },
  addButton: { padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  addText: { color: colors.accent, fontWeight: '700', textAlign: 'center' },
});
