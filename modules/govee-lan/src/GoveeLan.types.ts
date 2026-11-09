export type GoveeLanModuleEvents = {
  /** A UDP datagram arrived on the listening port. */
  onMessage: (event: { host: string; port: number; data: string }) => void;
  onListenerError: (event: { error: string }) => void;
};
