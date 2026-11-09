export type HueRequestOptions = {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  body?: string;
  /** Lower-case hex SHA-256 of the bridge's leaf certificate. Omit only while pairing. */
  pinnedFingerprint?: string;
  /** Required certificate common name (the Hue bridge ID). */
  expectedCommonName?: string;
  timeoutMs?: number;
};

export type HueResponse = {
  status: number;
  body: string;
  fingerprint?: string;
  commonName?: string | null;
};

export type HueHttpModuleEvents = {
  onStreamData: (event: { id: string; chunk: string }) => void;
  onStreamEnd: (event: { id: string; error: string | null }) => void;
};
