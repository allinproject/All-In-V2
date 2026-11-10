import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const HEADERS = {
  "content-type": "application/json",
  "cache-control": "no-store",
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};
const SEARCH_URL = "https://search.openfoodfacts.org/search";
const USER_AGENT = "ALLIN365/2.0 (https://allin365.app)";
function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: HEADERS });
}
function text(value: unknown): string | null {
  const s = typeof value === "string" ? value.trim() : "";
  return s || null;
}
function num(value: unknown): number | null {
  if ((typeof value !== "number" && typeof value !== "string") || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
function normalizeProduct(hit: any) {
  const row = hit?._source ?? hit ?? {};
  const code = text(row.code) ?? text(row._id);
  const name = text(row.product_name_en) ?? text(row.product_name);
  if (!code || !name) return null;
  return {
    barcode: code,
    product_name: name,
    brand: text(row.brands),
    serving_size: text(row.serving_size),
    image_url: text(row.image_front_small_url) ?? text(row.image_front_url),
    completeness: num(row.completeness),
    unique_scans_n: num(row.unique_scans_n),
    provider: "open_food_facts_search_a_licious",
    source_quality: "community_unverified",
    source_license: "Open Food Facts / ODbL; community-contributed product data",
    review_required: true,
    exact_identity_confirmed: false,
  };
}
Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: HEADERS });
  if (request.method !== "POST") return reply({ error: "method_not_allowed" }, 405);
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > 4096) return reply({ error: "request_too_large" }, 413);
  const body = await request.json().catch(() => null);
  const query = typeof body?.query === "string" ? body.query.replace(/\s+/g, " ").trim() : "";
  if (query.length < 2 || query.length > 80) {
    return reply({ error: "invalid_query", message: "Enter a 2–80 character product name or brand." }, 400);
  }

  let upstream: Response;
  try {
    upstream = await fetch(SEARCH_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": USER_AGENT,
        "accept": "application/json",
      },
      body: JSON.stringify({
        q: query,
        page_size: 15,
        page: 1,
        boost_phrase: true,
        langs: ["en"],
        fields: [
          "code", "product_name", "product_name_en", "brands", "serving_size",
          "image_front_small_url", "image_front_url", "completeness", "unique_scans_n",
        ],
      }),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    return reply({ error: "open_food_facts_search_unavailable", retryable: true }, 503);
  }
  if (upstream.status === 429 || upstream.status === 503) {
    return reply({ error: "open_food_facts_search_rate_limited", retryable: true }, upstream.status);
  }
  if (!upstream.ok) {
    return reply({ error: "open_food_facts_search_unavailable", retryable: upstream.status >= 500 }, 502);
  }
  const data = await upstream.json().catch(() => null);
  const hits = Array.isArray(data?.hits) ? data.hits : [];
  const deduped = new Map<string, ReturnType<typeof normalizeProduct>>();
  for (const hit of hits) {
    const product = normalizeProduct(hit);
    if (product && !deduped.has(product.barcode)) deduped.set(product.barcode, product);
  }
  const results = [...deduped.values()]
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .slice(0, 15);
  return reply({
    query,
    provider: "open_food_facts_search_a_licious",
    source_quality: "community_unverified",
    source_license: "Open Food Facts / ODbL; community-contributed product data",
    exact_identity_confirmed: false,
    barcode_lookup_required: true,
    results,
  });
});
