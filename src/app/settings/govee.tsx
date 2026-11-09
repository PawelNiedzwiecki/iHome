import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { normaliseHost } from '@/core/net';
import { addGoveeByHost, forgetGovee, renameGovee, scanGovee, useHome } from '@/store/home';
import { colors, radius, spacing } from '@/ui/theme';

export default function GoveeScreen() {
  const records = useHome((s) => s.goveeDevices);
  const devices = useHome((s) => s.devices.filter((d) => d.driver === 'govee'));
  const multicast = useHome((s) => s.goveeMulticast);
  const [host, setHost] = useState('');
  const [busy, setBusy] = useState<'scan' | 'add' | null>(null);
  const [message, setMessage] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);

  const run = async (kind: 'scan' | 'add', task: () => Promise<string | void>) => {
    setBusy(kind);
    setMessage(null);
    try {
      const info = await task();
      if (info) setMessage({ kind: 'info', text: info });
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  const scan = () =>
    run('scan', async () => {
      const before = records.length;
      await scanGovee();
      const after = useHome.getState().goveeDevices.length;
      return after > before ? `Found ${after - before} new light(s).` : 'No new lights found.';
    });

  const add = () =>
    run('add', async () => {
      const normalised = normaliseHost(host);
      if (!normalised) throw new Error('Enter an IP address like 192.168.1.30');
      const record = await addGoveeByHost(normalised);
      setHost('');
      return `Added ${record.sku} at ${record.host}.`;
    });

  const rename = (nativeId: string, current: string) =>
    Alert.prompt('Rename light', undefined, (name) => void renameGovee(nativeId, name), 'plain-text', current);

  const forget = (nativeId: string, name: string) =>
    Alert.alert(`Forget ${name}?`, 'It will come back if a network scan finds it again.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Forget', style: 'destructive', onPress: () => void forgetGovee(nativeId) },
    ]);

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.muted}>
        In the Govee Home app, open each light’s settings and turn on <Text style={styles.bold}>LAN Control</Text>.
        Not every Govee model has it.
      </Text>

      {multicast === false && (
        <View style={styles.note}>
          <Text style={styles.noteText}>
            Automatic discovery needs a network permission from Apple that this build doesn’t have yet. Add your
            lights by IP address below; find it in your router’s device list.
          </Text>
        </View>
      )}

      {message && <Text style={message.kind === 'error' ? styles.error : styles.info}>{message.text}</Text>}

      <Text style={styles.section}>Lights</Text>
      {records.length === 0 && <Text style={styles.muted}>No Govee lights yet.</Text>}
      {records.map((r) => {
        const device = devices.find((d) => d.nativeId === r.id);
        const name = device?.name ?? r.id;
        return (
          <View key={r.id} style={styles.card}>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{name}</Text>
              <Text style={styles.muted}>
                {r.sku} · {r.host} · {device?.reachable ? 'online' : 'not answering'}
              </Text>
            </View>
            <View style={styles.actions}>
              <Text style={styles.link} onPress={() => rename(r.id, name)}>
                Rename
              </Text>
              <Text style={styles.danger} onPress={() => forget(r.id, name)}>
                Forget
              </Text>
            </View>
          </View>
        );
      })}

      <Pressable style={styles.secondaryButton} onPress={scan} disabled={busy !== null}>
        {busy === 'scan' ? <ActivityIndicator color={colors.accent} /> : <Text style={styles.link}>Scan network</Text>}
      </Pressable>

      <Text style={styles.section}>Add by IP address</Text>
      <TextInput
        style={styles.input}
        placeholder="192.168.1.30"
        placeholderTextColor={colors.textMuted}
        keyboardType="numbers-and-punctuation"
        autoCapitalize="none"
        autoCorrect={false}
        value={host}
        onChangeText={setHost}
        onSubmitEditing={add}
      />
      <Pressable style={styles.button} onPress={add} disabled={busy !== null}>
        {busy === 'add' ? <ActivityIndicator color="#1A1100" /> : <Text style={styles.buttonText}>Add light</Text>}
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md },
  section: { color: colors.textMuted, fontSize: 13, fontWeight: '700', marginTop: spacing.lg, textTransform: 'uppercase' },
  muted: { color: colors.textMuted },
  bold: { fontWeight: '700', color: colors.text },
  note: { backgroundColor: colors.surfaceRaised, borderRadius: radius.sm, padding: spacing.md },
  noteText: { color: colors.text },
  error: { color: colors.danger },
  info: { color: colors.accent },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, flexDirection: 'row', alignItems: 'center' },
  name: { color: colors.text, fontSize: 16, fontWeight: '600' },
  actions: { gap: spacing.sm, alignItems: 'flex-end' },
  link: { color: colors.accent, fontWeight: '700', textAlign: 'center' },
  danger: { color: colors.danger, fontWeight: '600' },
  secondaryButton: { padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  input: { backgroundColor: colors.surface, color: colors.text, borderRadius: radius.sm, padding: spacing.md, fontSize: 16 },
  button: { backgroundColor: colors.accent, borderRadius: radius.lg, padding: spacing.md },
  buttonText: { color: '#1A1100', fontWeight: '700', textAlign: 'center', fontSize: 16 },
});
