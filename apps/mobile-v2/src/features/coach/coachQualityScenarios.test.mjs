import test from "node:test";
import assert from "node:assert/strict";
import { COACH_QUALITY_JOURNEYS, validateQualityJourneys } from "./coachQualityScenarios.mjs";
import { COACH_COHORTS } from "./coachQualityEvidence.mjs";
test("ALL-241 eight real-world scenario specifications are complete", () => {
  assert.deepEqual(validateQualityJourneys(COACH_QUALITY_JOURNEYS), {valid:true,failures:[]});
  assert.deepEqual(
    COACH_QUALITY_JOURNEYS.map(j=>j.cohort).sort(),
    COACH_COHORTS.map(([id])=>id).sort()
  );
});
test("each action is preview/review and not an implicit AI write", () => {
  for (const journey of COACH_QUALITY_JOURNEYS) {
    const action=journey.steps.find(step=>step.phase==="action-review");
    assert.match(action.input,/Show me before applying/);
    assert.ok(action.expected.some(rule=>rule.includes("approval")));
    assert.ok(action.expected.some(rule=>rule.includes("readback")));
  }
});
test("uncertainty never treats missing evidence as observed", () => {
  for (const journey of COACH_QUALITY_JOURNEYS) {
    const step=journey.steps.find(s=>s.phase==="uncertainty");
    assert.ok(step.expected.some(rule=>rule.includes("unknown")));
    assert.ok(step.expected.some(rule=>rule.includes(journey.forbidden)));
  }
});
test("an omitted phase or duplicate cohort invalidates the scenario matrix", () => {
  const absent=structuredClone(COACH_QUALITY_JOURNEYS);
  absent[0].steps.pop();
  assert.equal(validateQualityJourneys(absent).valid,false);
  const dup=structuredClone(COACH_QUALITY_JOURNEYS);
  dup[1].cohort=dup[0].cohort;
  assert.ok(validateQualityJourneys(dup).failures.some(x=>x.startsWith("DUPLICATE_COHORT:")));
});
