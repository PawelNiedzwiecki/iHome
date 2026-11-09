import type { HttpClient, HttpRequest } from './http';
import type { HueBridgeConfig, HueResponseBody } from './hueTypes';

/** What we persist about a paired bridge. */
export type HueBridgeConnection = {
  /** 16-hex-char bridge ID, upper case as the bridge reports it. */
  bridgeId: string;
  host: string;
  name: string;
  appKey: string;
  clientKey?: string;
  /** Pinned certificate fingerprint captured during pairing. */
  fingerprint: string;
};

export class HueError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: number,
  ) {
    super(message);
    this.name = 'HueError';
  }
}

/** Hue link-button error: the user hasn't pressed the button on the bridge yet. */
export const LINK_BUTTON_NOT_PRESSED = 101;

const DEFAULT_TIMEOUT_MS = 8000;

/**
 * Talks to an unpaired bridge. Used by the setup flow:
 * `probe` reads the bridge ID and its certificate, then `pair` creates an app key.
 */
export async function probeBridge(
  http: HttpClient,
  host: string,
): Promise<{ config: HueBridgeConfig; fingerprint: string }> {
  const res = await http.request({ url: `https://${host}/api/0/config`, timeoutMs: 5000 });
  if (res.status !== 200) throw new HueError(`Bridge at ${host} replied ${res.status}`, res.status);
  const config = JSON.parse(res.body) as HueBridgeConfig;
  if (!config.bridgeid) throw new HueError(`${host} is not a Hue bridge`);
  if (!res.fingerprint) throw new HueError('Bridge did not present a certificate');
  // Hue bridge certificates are issued for the bridge ID; reject anything else.
  if (res.commonName && res.commonName.toLowerCase() !== config.bridgeid.toLowerCase()) {
    throw new HueError(`Certificate is for ${res.commonName}, not bridge ${config.bridgeid}`);
  }
  return { config, fingerprint: res.fingerprint };
}

/**
 * Asks the bridge for an application key. Throws a HueError with code 101 until the
 * link button has been pressed, so callers can poll.
 */
export async function pairBridge(
  http: HttpClient,
  host: string,
  bridgeId: string,
  fingerprint: string,
  deviceType = 'ihome#iphone',
): Promise<{ appKey: string; clientKey?: string }> {
  const res = await http.request({
    url: `https://${host}/api`,
    method: 'POST',
    body: JSON.stringify({ devicetype: deviceType, generateclientkey: true }),
    headers: { 'Content-Type': 'application/json' },
    pinnedFingerprint: fingerprint,
    expectedCommonName: bridgeId.toLowerCase(),
    timeoutMs: DEFAULT_TIMEOUT_MS,
  });
  const body = JSON.parse(res.body) as {
    success?: { username: string; clientkey?: string };
    error?: { type: number; description: string };
  }[];
  const first = body[0];
  if (first?.success) return { appKey: first.success.username, clientKey: first.success.clientkey };
  throw new HueError(first?.error?.description ?? 'Pairing failed', res.status, first?.error?.type);
}

/** Authenticated CLIP v2 client for a paired bridge. */
export class HueClient {
  constructor(
    private readonly http: HttpClient,
    readonly connection: HueBridgeConnection,
  ) {}

  private base(req: Omit<HttpRequest, 'url'> & { path: string }): HttpRequest {
    const { path, ...rest } = req;
    return {
      ...rest,
      url: `https://${this.connection.host}${path}`,
      headers: { 'hue-application-key': this.connection.appKey, ...rest.headers },
      pinnedFingerprint: this.connection.fingerprint,
      expectedCommonName: this.connection.bridgeId.toLowerCase(),
      timeoutMs: rest.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    };
  }

  async list<T>(resource: string): Promise<T[]> {
    const res = await this.http.request(this.base({ path: `/clip/v2/resource/${resource}` }));
    return this.unwrap<T>(res.status, res.body);
  }

  async put(resource: string, id: string, body: unknown): Promise<void> {
    const res = await this.http.request(
      this.base({
        path: `/clip/v2/resource/${resource}/${id}`,
        method: 'PUT',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    this.unwrap(res.status, res.body);
  }

  /** Opens `/eventstream/clip/v2` (Server-Sent Events). */
  eventStream(onChunk: (text: string) => void, onEnd: (error: string | null) => void): () => void {
    return this.http.stream(
      this.base({
        path: '/eventstream/clip/v2',
        headers: { Accept: 'text/event-stream' },
        // The stream itself is long-lived; this only bounds the wait for the first byte.
        timeoutMs: 60_000,
      }),
      { onChunk, onEnd },
    );
  }

  private unwrap<T>(status: number, text: string): T[] {
    let body: HueResponseBody<T> | undefined;
    try {
      body = JSON.parse(text) as HueResponseBody<T>;
    } catch {
      // Non-JSON error page.
    }
    if (status === 429) throw new HueError('Bridge is rate limiting requests', status);
    if (status === 403 || status === 401) throw new HueError('App key rejected by bridge; pair again', status);
    if (status < 200 || status >= 300 || !body) {
      throw new HueError(body?.errors?.[0]?.description ?? `Bridge replied ${status}`, status);
    }
    return body.data;
  }
}

export type PairPollOptions = {
  timeoutMs?: number;
  intervalMs?: number;
  /** Polled between attempts; return true to stop (e.g. the screen was closed). */
  isCancelled?: () => boolean;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

/**
 * Repeats `pairBridge` until the user presses the link button, the timeout passes,
 * or the caller cancels. Resolves to null when cancelled.
 */
export async function pairWhenButtonPressed(
  http: HttpClient,
  host: string,
  bridgeId: string,
  fingerprint: string,
  {
    timeoutMs = 60_000,
    intervalMs = 2000,
    isCancelled = () => false,
    now = Date.now,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  }: PairPollOptions = {},
): Promise<{ appKey: string; clientKey?: string } | null> {
  const deadline = now() + timeoutMs;
  while (!isCancelled()) {
    try {
      return await pairBridge(http, host, bridgeId, fingerprint);
    } catch (error) {
      if (!(error instanceof HueError && error.code === LINK_BUTTON_NOT_PRESSED)) throw error;
    }
    if (now() + intervalMs > deadline) throw new HueError('Timed out waiting for the link button');
    await sleep(intervalMs);
  }
  return null;
}
