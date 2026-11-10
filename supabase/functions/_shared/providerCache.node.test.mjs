import test from "node:test";
import assert from "node:assert/strict";
import {
  coalesceProviderRequest,
  providerCacheKey,
} from "./providerCache.ts";

test("provider cache keys hash normalized provider and query text", async () => {
  const first = await providerCacheKey(
    "usda_fdc_generic_search",
    "  Chicken   Breast ",
  );
  const normalized = await providerCacheKey(
    "usda_fdc_generic_search",
    "chicken breast",
  );
  const otherProvider = await providerCacheKey(
    "open_food_facts_search",
    "chicken breast",
  );

  assert.equal(first, normalized);
  assert.notEqual(first, otherProvider);
  assert.equal(first.length, 64);
  assert.match(first, /^[0-9a-f]{64}$/);
  assert.equal(first.includes("chicken"), false);
});

test("same-isolate concurrent misses share one upstream operation", async () => {
  let executions = 0;
  let release;
  const gate = new Promise(resolve => {
    release = resolve;
  });
  const operation = async () => {
    executions += 1;
    return await gate;
  };

  const first = coalesceProviderRequest("test-provider:shared-key", operation);
  const second = coalesceProviderRequest("test-provider:shared-key", operation);

  await Promise.resolve();
  assert.equal(executions, 1);

  release({ id: 42 });
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.deepEqual(firstResult, { id: 42 });
  assert.deepEqual(secondResult, { id: 42 });
  assert.equal(executions, 1);
});

test("failed coalesced requests are removed so a later retry can run", async () => {
  let executions = 0;
  const key = "test-provider:retry-key";

  await assert.rejects(
    coalesceProviderRequest(key, async () => {
      executions += 1;
      throw new Error("synthetic upstream failure");
    }),
    /synthetic upstream failure/,
  );

  const retry = await coalesceProviderRequest(key, async () => {
    executions += 1;
    return "retry-success";
  });

  assert.equal(retry, "retry-success");
  assert.equal(executions, 2);
});
