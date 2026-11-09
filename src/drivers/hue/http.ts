// Transport used by the Hue client. On iOS it is backed by the `hue-http` native
// module (see nativeHttp.ts); tests use an in-memory fake bridge.

export type HttpRequest = {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  body?: string;
  /** Lower-case hex SHA-256 of the bridge certificate. Omit only during first contact. */
  pinnedFingerprint?: string;
  /** Required certificate common name (Hue: the lower-case bridge ID). */
  expectedCommonName?: string;
  timeoutMs?: number;
};

export type HttpResponse = {
  status: number;
  body: string;
  /** Certificate actually presented, reported so it can be pinned after first contact. */
  fingerprint?: string;
  commonName?: string | null;
};

export type StreamHandlers = {
  onChunk: (text: string) => void;
  onEnd: (error: string | null) => void;
};

export interface HttpClient {
  request(req: HttpRequest): Promise<HttpResponse>;
  /** Opens a long-lived request (SSE). Returns a function that closes it. */
  stream(req: HttpRequest, handlers: StreamHandlers): () => void;
}
