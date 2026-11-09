import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import { startHome } from '@/store/home';
import { colors } from '@/ui/theme';

export default function RootLayout() {
  useEffect(() => {
    void startHome();
  }, []);

  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.text,
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="index" options={{ title: 'iHome', headerLargeTitle: true }} />
        <Stack.Screen name="scenes" options={{ title: 'Scenes' }} />
        <Stack.Screen name="light/[id]" options={{ title: '', presentation: 'modal' }} />
        <Stack.Screen name="settings/index" options={{ title: 'Hubs' }} />
        <Stack.Screen name="settings/hue-setup" options={{ title: 'Add Hue bridge' }} />
      </Stack>
    </>
  );
}
