import HueHttp from '@modules/hue-http';

import type { HttpClient } from './http';

let streamCounter = 0;

function createNativeClient(native: NonNullable<typeof HueHttp>): HttpClient {
  return {
    request: (req) => native.request(req),

    stream(req, { onChunk, onEnd }) {
      const id = `hue-stream-${++streamCounter}`;
      const dataSub = native.addListener('onStreamData', (e) => {
        if (e.id === id) onChunk(e.chunk);
      });
      const endSub = native.addListener('onStreamEnd', (e) => {
        if (e.id !== id) return;
        cleanup();
        onEnd(e.error);
      });
      const cleanup = () => {
        dataSub.remove();
        endSub.remove();
      };
      native.startStream(id, req).catch((error: Error) => {
        cleanup();
        onEnd(error.message);
      });
      return () => {
        cleanup();
        native.stopStream(id);
      };
    },
  };
}

/** HttpClient backed by the `hue-http` Swift module, or null if it isn't compiled into this build. */
export const nativeHttpClient: HttpClient | null = HueHttp ? createNativeClient(HueHttp) : null;
