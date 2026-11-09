import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { discoverBridgesViaCloud, normaliseHost, type DiscoveredBridge } from '@/drivers/hue/discovery';
import { pairWhenButtonPressed, probeBridge } from '@/drivers/hue/HueClient';
import { nativeHttpClient } from '@/drivers/hue/nativeHttp';
import { addHueBridge } from '@/store/home';
import { colors, radius, spacing } from '@/ui/theme';

type Step =
  | { kind: 'choose' }
  | { kind: 'probing'; host: string }
  | { kind: 'press-button'; host: string; name: string }
  | { kind: 'error'; message: string };

export default function HueSetupScreen() {
  const [found, setFound] = useState<DiscoveredBridge[] | null>(null);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  const [manualHost, setManualHost] = useState('');
  const [step, setStep] = useState<Step>({ kind: 'choose' });
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    discoverBridgesViaCloud()
      .then(setFound)
      .catch((e: Error) => {
        setFound([]);
        setDiscoveryError(e.message);
      });
    return () => {
      cancelled.current = true;
    };
  }, []);

  const connect = async (rawHost: string) => {
    const host = normaliseHost(rawHost);
    if (!host) return setStep({ kind: 'error', message: 'Enter an IP address like 192.168.1.20' });
    if (!nativeHttpClient) {
      return setStep({ kind: 'error', message: 'This build is missing the hue-http native module.' });
    }
    try {
      setStep({ kind: 'probing', host });
      const { config, fingerprint } = await probeBridge(nativeHttpClient, host);
      setStep({ kind: 'press-button', host, name: config.name });

      const keys = await pairWhenButtonPressed(nativeHttpClient, host, config.bridgeid, fingerprint, {
        isCancelled: () => cancelled.current,
      });
      if (!keys) return;
      await addHueBridge({ bridgeId: config.bridgeid, host, name: config.name, fingerprint, ...keys });
      router.back();
    } catch (e) {
      setStep({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  };

  if (step.kind === 'probing' || step.kind === 'press-button') {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} size="large" />
        {step.kind === 'probing' ? (
          <Text style={styles.title}>Connecting to {step.host}…</Text>
        ) : (
          <>
            <Text style={styles.title}>Press the link button</Text>
            <Text style={styles.muted}>
              Press the round button on top of “{step.name}”. iHome will connect automatically.
            </Text>
          </>
        )}
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {step.kind === 'error' && <Text style={styles.error}>{step.message}</Text>}

      <Text style={styles.section}>Bridges on your network</Text>
      {found === null && <ActivityIndicator color={colors.accent} />}
      {found?.length === 0 && (
        <Text style={styles.muted}>{discoveryError ?? 'None found automatically. Enter the IP below.'}</Text>
      )}
      {found?.map((b) => (
        <Pressable key={b.id} style={styles.card} onPress={() => connect(b.host)}>
          <Text style={styles.name}>Hue bridge {b.id.slice(-6)}</Text>
          <Text style={styles.muted}>{b.host}</Text>
        </Pressable>
      ))}

      <Text style={styles.section}>Or enter its IP address</Text>
      <Text style={styles.muted}>Find it in the Hue app: Settings → Bridges → (i).</Text>
      <TextInput
        style={styles.input}
        placeholder="192.168.1.20"
        placeholderTextColor={colors.textMuted}
        keyboardType="numbers-and-punctuation"
        autoCapitalize="none"
        autoCorrect={false}
        value={manualHost}
        onChangeText={setManualHost}
        onSubmitEditing={() => connect(manualHost)}
      />
      <Pressable style={styles.button} onPress={() => connect(manualHost)}>
        <Text style={styles.buttonText}>Connect</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl },
  title: { color: colors.text, fontSize: 20, fontWeight: '700', textAlign: 'center' },
  section: { color: colors.textMuted, fontSize: 13, fontWeight: '700', marginTop: spacing.lg, textTransform: 'uppercase' },
  muted: { color: colors.textMuted, textAlign: 'center' },
  error: { color: colors.danger },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, gap: 2 },
  name: { color: colors.text, fontSize: 16, fontWeight: '600' },
  input: {
    backgroundColor: colors.surface,
    color: colors.text,
    borderRadius: radius.sm,
    padding: spacing.md,
    fontSize: 16,
  },
  button: { backgroundColor: colors.accent, borderRadius: radius.lg, padding: spacing.md },
  buttonText: { color: '#1A1100', fontWeight: '700', textAlign: 'center', fontSize: 16 },
});
