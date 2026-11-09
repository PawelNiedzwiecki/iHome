import GoveeLan from '@modules/govee-lan';

import type { UdpTransport } from './udp';

function createNativeUdp(native: NonNullable<typeof GoveeLan>): UdpTransport {
  return {
    listen: (port) => native.startListening(port),
    onMessage(listener) {
      const sub = native.addListener('onMessage', (e) => listener({ host: e.host, port: e.port }, e.data));
      return () => sub.remove();
    },
    send: (host, port, message) => native.send(host, port, message),
    sendMulticast: (group, port, message) => native.sendMulticast(group, port, message),
  };
}

/** UdpTransport backed by the `govee-lan` Swift module, or null if it isn't in this build. */
export const nativeUdp: UdpTransport | null = GoveeLan ? createNativeUdp(GoveeLan) : null;
