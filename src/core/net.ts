/** Accepts "192.168.1.20", "192.168.1.20:443", or "https://192.168.1.20/"; returns host[:port] or null. */
export function normaliseHost(input: string): string | null {
  const trimmed = input.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  if (!trimmed) return null;
  if (!/^[a-z0-9.-]+(:\d{1,5})?$/i.test(trimmed)) return null;
  return trimmed.toLowerCase();
}
