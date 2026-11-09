import * as SecureStore from 'expo-secure-store';

import type { GoveeDeviceRecord } from '@/drivers/govee/GoveeDriver';
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

// Govee lamps have no key, but the list sits with the rest of the hub config.
const GOVEE_DEVICES_KEY = 'govee.devices.v1';

export async function loadGoveeDevices(): Promise<GoveeDeviceRecord[]> {
  try {
    const raw = await SecureStore.getItemAsync(GOVEE_DEVICES_KEY);
    return raw ? (JSON.parse(raw) as GoveeDeviceRecord[]) : [];
  } catch {
    return [];
  }
}

export async function saveGoveeDevices(devices: GoveeDeviceRecord[]) {
  await SecureStore.setItemAsync(GOVEE_DEVICES_KEY, JSON.stringify(devices));
}
