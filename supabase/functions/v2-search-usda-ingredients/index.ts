import { normalizeFdcGenericFood } from '../_shared/fdc.ts';
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const HEADERS = {
  "content-type": "application/json",
  "cache-control": "no-store",
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};
const FDC_BASE = "https://api.nal.usda.gov/fdc/v1";
const MAX_QUERY_LENGTH = 80;
const MAX_RESULTS = 20;
const USER_AGENT = "ALLIN365/2.0 (https://allin365.app)";

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: HEADERS });
}
function normalizeQuery(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, MAX_QUERY_LENGTH) : "";
}
function validFdcId(value: unknown): string | null {
  const id = typeof value === "number" || typeof value === "string" ? String(value).trim() : "";
  return /^\d{1,12}$/.test(id) && Number(id) > 0 ? id : null;
}

async function fetchFdc(url: string, init?: RequestInit): Promise<Response> {
  return await fetch(url, {
    ...init,
    headers: {
      "accept": "application/json",
      "user-agent": USER_AGENT,
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(8000),
  });
}

async function handleSearch(query: string, apiKey: string) {
  const url = new URL(FDC_BASE + "/foods/search");
  url.searchParams.set("api_key", apiKey);
  let upstream: Response;
  try {
    upstream = await fetchFdc(url.toString(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query,
        dataType: ["Foundation", "SR Legacy"],
        pageSize: 25,
        pageNumber: 1,
      }),
    });
  } catch {
    return response({ error: "usda_unavailable", retryable: true }, 503);
  }
  if (upstream.status === 429) {
    return response({ error: "usda_rate_limited", retryable: true }, 429);
  }
  if (!upstream.ok) {
    return response({ error: "usda_unavailable", retryable: upstream.status >= 500 }, upstream.status >= 500 ? 503 : 502);
  }
  const payload = await upstream.json().catch(() => null);
  const foods = Array.isArray(payload?.foods) ? payload.foods : [];
  const retrievedAt = new Date().toISOString();
  const deduped = new Map<string, ReturnType<typeof normalizeFdcGenericFood>>();
  for (const food of foods) {
    const candidate = normalizeFdcGenericFood(food, retrievedAt);
    if (candidate && !deduped.has(candidate.source_id)) deduped.set(candidate.source_id, candidate);
  }
  return response({
    kind: "generic_ingredient_candidates",
    provider: "usda_fdc",
    query,
    source_basis: "100g",
    source_quality: "usda_reference_unreviewed",
    source_license: "USDA FoodData Central / CC0 1.0",
    review_required: true,
    retrieved_at: retrievedAt,
    results: [...deduped.values()].filter(Boolean).slice(0, MAX_RESULTS),
  });
}

async function handleDetail(id: string, apiKey: string) {
  const url = new URL(FDC_BASE + "/food/" + encodeURIComponent(id));
  url.searchParams.set("api_key", apiKey);
  let upstream: Response;
  try {
    upstream = await fetchFdc(url.toString());
  } catch {
    return response({ error: "usda_unavailable", retryable: true }, 503);
  }
  if (upstream.status === 429) {
    return response({ error: "usda_rate_limited", retryable: true }, 429);
  }
  if (upstream.status === 404) {
    return response({ error: "fdc_food_not_found", retryable: false }, 404);
  }
  if (!upstream.ok) {
    return response({ error: "usda_unavailable", retryable: upstream.status >= 500 }, upstream.status >= 500 ? 503 : 502);
  }
  const food = await upstream.json().catch(() => null);
  const retrievedAt = new Date().toISOString();
  const candidate = normalizeFdcGenericFood(food, retrievedAt);
  if (!candidate) return response({ error: "fdc_food_not_usable_as_generic_ingredient" }, 422);
  return response({
    kind: "generic_ingredient_candidate",
    provider: "usda_fdc",
    review_required: true,
    result: candidate,
  });
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: HEADERS });
  if (request.method !== "POST") return response({ error: "method_not_allowed" }, 405);

  const apiKey = (Deno.env.get("USDA_FDC_API_KEY") ?? "").trim();
  if (!apiKey) return response({ error: "usda_not_configured", retryable: false }, 503);

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return response({ error: "invalid_request" }, 400);
  }
  const action = body.action === "detail" ? "detail" : body.action === "search" || body.action == null ? "search" : null;
  if (!action) return response({ error: "unsupported_action" }, 400);

  if (action === "detail") {
    const id = validFdcId(body.fdc_id);
    if (!id) return response({ error: "invalid_fdc_id" }, 400);
    return await handleDetail(id, apiKey);
  }

  const query = normalizeQuery(body.query);
  if (query.length < 2 || query.length > MAX_QUERY_LENGTH) {
    return response({ error: "invalid_query", message: "Enter a 2–80 character ingredient name." }, 400);
  }
  return await handleSearch(query, apiKey);
});
