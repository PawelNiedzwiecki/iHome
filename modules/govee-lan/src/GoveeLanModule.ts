import { NativeModule, requireOptionalNativeModule } from 'expo';

import type { GoveeLanModuleEvents } from './GoveeLan.types';

declare class GoveeLanModule extends NativeModule<GoveeLanModuleEvents> {
  startListening(port: number): Promise<void>;
  stopListening(): void;
  send(host: string, port: number, message: string): Promise<void>;
  /** Rejects with a message starting `ERR_GOVEE_MULTICAST` when the multicast entitlement is missing. */
  sendMulticast(group: string, port: number, message: string): Promise<void>;
}

/** `null` when the native module is not compiled in (Expo Go, unit tests). */
export default requireOptionalNativeModule<GoveeLanModule>('GoveeLan');
