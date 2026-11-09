import * as SecureStore from 'expo-secure-store';

import type { HueBridgeConnection } from '@/drivers/hue/HueClient';

// Bridge app keys grant full control of the lights, so they live in the iOS Keychain.
const HUE_BRIDGES_KEY = 'hue.bridges.v1';

export async function loadHueBridges(): Promise<HueBridgeConnection[]> {
  try {
    const raw = await SecureStore.getItemAsync(HUE_BRIDGES_KEY);
    return raw ? (JSON.parse(raw) as HueBridgeConnection[]) : [];
  } catch {
    return [];
  }
}

export async function saveHueBridges(bridges: HueBridgeConnection[]) {
  await SecureStore.setItemAsync(HUE_BRIDGES_KEY, JSON.stringify(bridges));
}
