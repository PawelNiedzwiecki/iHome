import { NativeModule, requireOptionalNativeModule } from 'expo';

import type { HueHttpModuleEvents, HueRequestOptions, HueResponse } from './HueHttp.types';

declare class HueHttpModule extends NativeModule<HueHttpModuleEvents> {
  request(options: HueRequestOptions): Promise<HueResponse>;
  startStream(id: string, options: HueRequestOptions): Promise<void>;
  stopStream(id: string): void;
}

/** `null` when the native module is not compiled in (Expo Go, web, unit tests). */
export default requireOptionalNativeModule<HueHttpModule>('HueHttp');
