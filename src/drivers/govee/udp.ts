/** UDP as the Govee driver needs it. iOS: `modules/govee-lan`; tests: a fake network. */
export interface UdpTransport {
  /** Starts receiving datagrams on `port` (idempotent). */
  listen(port: number): Promise<void>;
  onMessage(listener: (from: { host: string; port: number }, data: string) => void): () => void;
  send(host: string, port: number, message: string): Promise<void>;
  /** Rejects when multicast isn't allowed (iOS needs an Apple-granted entitlement). */
  sendMulticast(group: string, port: number, message: string): Promise<void>;
}
