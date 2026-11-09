import { create } from 'zustand';

import { GoveeDriver, type GoveeDeviceRecord } from '@/drivers/govee/GoveeDriver';
import { nativeUdp } from '@/drivers/govee/nativeUdp';
import type { HueBridgeConnection } from '@/drivers/hue/HueClient';
import { HueDriver } from '@/drivers/hue/HueDriver';
import { nativeHttpClient } from '@/drivers/hue/nativeHttp';
import { DeviceRegistry, type RegistrySnapshot } from '@/registry/DeviceRegistry';

import { loadGoveeDevices, loadHueBridges, saveGoveeDevices, saveHueBridges } from './secureConfig';

/** The single registry instance the whole app uses. */
export const registry = new DeviceRegistry();

type HomeState = RegistrySnapshot & {
  started: boolean;
  refreshing: boolean;
  hueBridges: HueBridgeConnection[];
  goveeDevices: GoveeDeviceRecord[];
  /** False when iOS refused multicast, so Govee lamps must be added by IP. Undefined before the first scan. */
  goveeMulticast: boolean | undefined;
  /** Set when this build lacks the native modules (e.g. running in Expo Go). */
  nativeMissing: boolean;
};

export const useHome = create<HomeState>(() => ({
  ...registry.snapshot(),
  started: false,
  refreshing: false,
  hueBridges: [],
  goveeDevices: [],
  goveeMulticast: undefined,
  nativeMissing: nativeHttpClient === null || nativeUdp === null,
}));

registry.onChange((snapshot) => useHome.setState(snapshot));

const hueDrivers = new Map<string, HueDriver>();

function attachHue(connection: HueBridgeConnection) {
  if (!nativeHttpClient || hueDrivers.has(connection.bridgeId)) return;
  const driver = new HueDriver(nativeHttpClient, connection);
  hueDrivers.set(connection.bridgeId, driver);
  registry.addDriver(driver);
}

let goveeDriver: GoveeDriver | null = null;

function attachGovee(records: GoveeDeviceRecord[]) {
  if (!nativeUdp || goveeDriver) return;
  goveeDriver = new GoveeDriver(nativeUdp, {
    records,
    onRecordsChanged: (next) => {
      useHome.setState({ goveeDevices: next });
      void saveGoveeDevices(next);
    },
  });
  registry.addDriver(goveeDriver);
}

/** Loads saved hubs and lamps and connects to them. Safe to call more than once. */
export async function startHome() {
  if (useHome.getState().started) return;
  useHome.setState({ started: true });
  const [bridges, goveeDevices] = await Promise.all([loadHueBridges(), loadGoveeDevices()]);
  useHome.setState({ hueBridges: bridges, goveeDevices });
  bridges.forEach(attachHue);
  attachGovee(goveeDevices);
  await refreshHome();
}

export async function refreshHome() {
  useHome.setState({ refreshing: true });
  try {
    await registry.refresh();
  } finally {
    useHome.setState({ refreshing: false, goveeMulticast: goveeDriver?.multicastAvailable });
  }
}

// ---------- Govee ----------

function requireGovee(): GoveeDriver {
  if (!goveeDriver) throw new Error('This build is missing the govee-lan native module.');
  return goveeDriver;
}

/** Scans the network for Govee lamps (needs the multicast entitlement) and reloads them. */
export async function scanGovee() {
  const driver = requireGovee();
  await registry.refresh(driver);
  useHome.setState({ goveeMulticast: driver.multicastAvailable });
}

export async function addGoveeByHost(host: string) {
  const driver = requireGovee();
  const record = await driver.addByHost(host);
  await registry.refresh(driver);
  return record;
}

export async function renameGovee(nativeId: string, name: string) {
  const driver = requireGovee();
  driver.rename(nativeId, name);
  await registry.refresh(driver);
}

export async function forgetGovee(nativeId: string) {
  const driver = requireGovee();
  driver.forget(nativeId);
  await registry.refresh(driver);
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
