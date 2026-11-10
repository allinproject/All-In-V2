import { assertEquals, assertNotEquals } from "jsr:@std/assert";
import { normalizeFdcGenericFood } from "../_shared/fdc.ts";

const retrievedAt = "2026-11-10T00:00:00.000Z";
const makeFood = (overrides: Record<string, unknown> = {}) => ({
  fdcId: 12345,
  description: "Chicken breast, cooked",
  dataType: "SR Legacy",
  foodNutrients: [
    { nutrientId: 1008, unitName: "KCAL", value: 165 },
    { nutrientId: 1003, unitName: "G", value: 31 },
    { nutrientId: 1005, unitName: "G", value: 0 },
    { nutrientId: 1004, unitName: "G", value: 3.6 },
  ],
  ...overrides,
});

Deno.test("generic USDA candidate normalization preserves 100g source and quality", () => {
  const result = normalizeFdcGenericFood(makeFood(), retrievedAt);
  assertNotEquals(result, null);
  assertEquals(result?.source_id, "12345");
  assertEquals(result?.nutrition_basis, "100g");
  assertEquals(result?.calories, 165);
  assertEquals(result?.usable, true);
  assertEquals(result?.review_required, true);
  assertEquals(result?.source_quality, "usda_reference_unreviewed");
});

Deno.test("generic ingredient search refuses branded FDC records", () => {
  assertEquals(normalizeFdcGenericFood(makeFood({ dataType: "Branded" }), retrievedAt), null);
});

Deno.test("missing nutrients remain null and make candidate unusable", () => {
  const result = normalizeFdcGenericFood(makeFood({
    foodNutrients: [{ nutrientId: 1008, unitName: "KCAL", value: 100 }],
  }), retrievedAt);
  assertEquals(result?.protein_g, null);
  assertEquals(result?.usable, false);
});
