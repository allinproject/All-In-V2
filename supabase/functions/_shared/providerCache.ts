/**
 * Server-only V2 provider cache client.
 *
 * Cache RPCs are callable only with the Supabase service-role credential.
 * This module must only be imported by Supabase Edge Functions.
 * Keys are hashed so raw search terms are not retained as cache keys.
 */
type ProviderCacheEntry = {
  payload: unknown;
  source_quality: string | null;
  source_license: string | null;
  fetched_at: string;
  expires_at: string;
};

function env(name: string): string {
  return (Deno.env.get(name) ?? "").trim();
}
function restHeaders(serviceKey: string) {
  return {
    "apikey": serviceKey,
    "authorization": "Bearer " + serviceKey,
    "content-type": "application/json",
    "accept": "application/json",
  };
}
export async function providerCacheKey(provider: string, rawKey: string): Promise<string> {
  const bytes = new TextEncoder().encode(provider + "\n" + rawKey.trim().toLowerCase().replace(/\s+/g, " "));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map(value => value.toString(16).padStart(2, "0")).join("");
}
export async function getProviderCache(
  provider: string,
  cacheKey: string,
): Promise<ProviderCacheEntry | null> {
  const url = env("SUPABASE_URL");
  const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return null;
  try {
    const result = await fetch(url + "/rest/v1/rpc/v2_provider_cache_get", {
      method: "POST",
      headers: restHeaders(serviceKey),
      body: JSON.stringify({ p_provider: provider, p_cache_key: cacheKey }),
      signal: AbortSignal.timeout(3000),
    });
    if (!result.ok) return null;
    const payload = await result.json().catch(() => null);
    if (!payload || typeof payload !== "object" || !("payload" in payload)) return null;
    return payload as ProviderCacheEntry;
  } catch {
    return null;
  }
}
export async function putProviderCache(
  provider: string,
  cacheKey: string,
  payload: unknown,
  sourceQuality: string,
  sourceLicense: string,
  ttlSeconds: number,
  fetchedAt = new Date().toISOString(),
): Promise<void> {
  const url = env("SUPABASE_URL");
  const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey || !Number.isSafeInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 30 * 86400) return;
  try {
    const expiresAt = new Date(Date.parse(fetchedAt) + ttlSeconds * 1000).toISOString();
    await fetch(url + "/rest/v1/rpc/v2_provider_cache_put", {
      method: "POST",
      headers: restHeaders(serviceKey),
      body: JSON.stringify({
        p_provider: provider,
        p_cache_key: cacheKey,
        p_payload: payload,
        p_source_quality: sourceQuality,
        p_source_license: sourceLicense,
        p_fetched_at: fetchedAt,
        p_expires_at: expiresAt,
      }),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // Cache is an optimization. Provider availability is handled by the caller.
  }
}

const inFlightProviderRequests = new Map<string, Promise<unknown>>();

/** Coalesce duplicate in-flight calls within a warm Edge Function isolate. */
export async function coalesceProviderRequest<T>(
  key: string,
  operation: () => Promise<T>,
): Promise<T> {
  const existing = inFlightProviderRequests.get(key) as Promise<T> | undefined;
  if (existing) return await existing;
  const pending = operation().finally(() => {
    inFlightProviderRequests.delete(key);
  });
  inFlightProviderRequests.set(key, pending);
  try {
    return await pending;
  } catch (error) {
    inFlightProviderRequests.delete(key);
    throw error;
  }
}
