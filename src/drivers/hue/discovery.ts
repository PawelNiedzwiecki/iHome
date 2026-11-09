export type DiscoveredBridge = { id: string; host: string };

/**
 * Finds bridges via Signify's cloud discovery endpoint, which lists the bridges
 * that have checked in from the same public IP. Works without any native module;
 * if it returns nothing, the setup screen lets the user type the bridge IP.
 */
export async function discoverBridgesViaCloud(
  fetchFn: typeof fetch = fetch,
): Promise<DiscoveredBridge[]> {
  const res = await fetchFn('https://discovery.meethue.com/');
  if (res.status === 429) throw new Error('Too many discovery requests; wait a minute or enter the IP');
  if (!res.ok) throw new Error(`Discovery failed (${res.status})`);
  const list = (await res.json()) as { id: string; internalipaddress: string; port?: number }[];
  return list
    .filter((b) => b.internalipaddress)
    .map((b) => ({
      id: b.id.toUpperCase(),
      host: b.port && b.port !== 443 ? `${b.internalipaddress}:${b.port}` : b.internalipaddress,
    }));
}

export { normaliseHost } from '@/core/net';
