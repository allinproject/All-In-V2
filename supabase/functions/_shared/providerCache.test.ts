import { assertEquals, assertNotEquals } from "jsr:@std/assert";
import { coalesceProviderRequest, providerCacheKey } from "./providerCache.ts";

Deno.test("provider cache keys hash normalized provider and query text", async () => {
  const first = await providerCacheKey("usda_fdc_generic_search", "  Chicken   Breast ");
  const normalized = await providerCacheKey("usda_fdc_generic_search", "chicken breast");
  const otherProvider = await providerCacheKey("open_food_facts_search", "chicken breast");

  assertEquals(first, normalized);
  assertNotEquals(first, otherProvider);
  assertEquals(first.length, 64);
  assertEquals(/^[0-9a-f]{64}$/.test(first), true);
  assertEquals(first.includes("chicken"), false);
});

Deno.test("same-isolate concurrent cache misses share one upstream operation", async () => {
  let executions = 0;
  let release!: (value: { id: number }) => void;
  const gate = new Promise<{ id: number }>(resolve => {
    release = resolve;
  });
  const operation = async () => {
    executions += 1;
    return await gate;
  };

  const first = coalesceProviderRequest("test-provider:shared-key", operation);
  const second = coalesceProviderRequest("test-provider:shared-key", operation);

  await Promise.resolve();
  assertEquals(executions, 1);

  release({ id: 42 });
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assertEquals(firstResult, { id: 42 });
  assertEquals(secondResult, { id: 42 });
  assertEquals(executions, 1);
});

Deno.test("failed coalesced requests are removed so a retry can execute", async () => {
  let executions = 0;
  const key = "test-provider:retry-key";

  await coalesceProviderRequest(key, async () => {
    executions += 1;
    throw new Error("synthetic upstream failure");
  }).catch(error => {
    assertEquals(error instanceof Error, true);
    assertEquals((error as Error).message, "synthetic upstream failure");
  });

  const retry = await coalesceProviderRequest(key, async () => {
    executions += 1;
    return "retry-success";
  });

  assertEquals(retry, "retry-success");
  assertEquals(executions, 2);
});
