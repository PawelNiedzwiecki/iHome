import { create } from 'zustand';

import type { HueBridgeConnection } from '@/drivers/hue/HueClient';
import { HueDriver } from '@/drivers/hue/HueDriver';
import { nativeHttpClient } from '@/drivers/hue/nativeHttp';
import { DeviceRegistry, type RegistrySnapshot } from '@/registry/DeviceRegistry';

import { loadHueBridges, saveHueBridges } from './secureConfig';

/** The single registry instance the whole app uses. */
export const registry = new DeviceRegistry();

type HomeState = RegistrySnapshot & {
  started: boolean;
  refreshing: boolean;
  hueBridges: HueBridgeConnection[];
  /** Set when this build lacks the native modules (e.g. running in Expo Go). */
  nativeMissing: boolean;
};

export const useHome = create<HomeState>(() => ({
  ...registry.snapshot(),
  started: false,
  refreshing: false,
  hueBridges: [],
  nativeMissing: nativeHttpClient === null,
}));

registry.onChange((snapshot) => useHome.setState(snapshot));

const hueDrivers = new Map<string, HueDriver>();

function attachHue(connection: HueBridgeConnection) {
  if (!nativeHttpClient || hueDrivers.has(connection.bridgeId)) return;
  const driver = new HueDriver(nativeHttpClient, connection);
  hueDrivers.set(connection.bridgeId, driver);
  registry.addDriver(driver);
}

/** Loads saved bridges and connects to them. Safe to call more than once. */
export async function startHome() {
  if (useHome.getState().started) return;
  useHome.setState({ started: true });
  const bridges = await loadHueBridges();
  useHome.setState({ hueBridges: bridges });
  bridges.forEach(attachHue);
  await refreshHome();
}

export async function refreshHome() {
  useHome.setState({ refreshing: true });
  try {
    await registry.refresh();
  } finally {
    useHome.setState({ refreshing: false });
  }
}

export async function addHueBridge(connection: HueBridgeConnection) {
  const others = useHome.getState().hueBridges.filter((b) => b.bridgeId !== connection.bridgeId);
  const bridges = [...others, connection];
  await saveHueBridges(bridges);
  useHome.setState({ hueBridges: bridges });
  const existing = hueDrivers.get(connection.bridgeId);
  if (existing) {
    registry.removeDriver(existing);
    hueDrivers.delete(connection.bridgeId);
  }
  attachHue(connection);
  await registry.refresh(hueDrivers.get(connection.bridgeId));
}

export async function removeHueBridge(bridgeId: string) {
  const bridges = useHome.getState().hueBridges.filter((b) => b.bridgeId !== bridgeId);
  await saveHueBridges(bridges);
  useHome.setState({ hueBridges: bridges });
  const driver = hueDrivers.get(bridgeId);
  if (driver) {
    registry.removeDriver(driver);
    hueDrivers.delete(bridgeId);
  }
}
