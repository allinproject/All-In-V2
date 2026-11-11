import test from "node:test";
import assert from "node:assert/strict";
import { COACH_COHORTS, COACH_PHASES, evaluateCoachTrace, makeSyntheticCoachTrace } from "./coachQualityEvidence.mjs";

test("ALL-241 covers eight distinct cohorts and all six linked phases", () => {
  assert.equal(COACH_COHORTS.length, 8);
  assert.equal(new Set(COACH_COHORTS.map(([id]) => id)).size, 8);
  assert.equal(COACH_PHASES.length, 6);
});
test("synthetic evaluation passes never imply Coach or release verification", () => {
  for (const [cohort] of COACH_COHORTS) {
    const result = evaluateCoachTrace(makeSyntheticCoachTrace(cohort));
    assert.equal(result.status, "TRACE_PASS");
    assert.equal(result.level, "fixture");
    assert.equal(result.releaseAccepted, false);
  }
});
const corrupt = (cohort, update) => {
  const trace = makeSyntheticCoachTrace(cohort);
  update(trace);
  return evaluateCoachTrace(trace);
};
test("false save without canonical readback fails closed", () => {
  assert.ok(corrupt("beginner", (t) => { t.observations[4].readback = "unknown"; }).failures.includes("FALSE_SAVED_CLAIM"));
});
test("unapproved write and changed approved action fail", () => {
  assert.ok(corrupt("lifter", (t) => { t.observations[4].approved = false; }).failures.includes("UNAPPROVED_WRITE"));
  assert.ok(corrupt("lifter", (t) => { t.observations[4].actionChangedAfterApproval = true; }).failures.includes("CHANGED_AFTER_APPROVAL"));
});
test("missing records cannot be reinterpreted as zero", () => {
  assert.ok(corrupt("lifestyle", (t) => {
    t.observations[2].sourceState = "missing";
    t.observations[2].treatedAsZero = true;
  }).failures.includes("MISSING_TREATED_AS_ZERO"));
});
test("stale context, hard restrictions, fabricated facts and leaks are hard failures", () => {
  for (const [field, expected] of [
    ["staleContextUsed", "STALE_CONTEXT"],
    ["hardRestrictionViolated", "RESTRICTION_VIOLATION"],
    ["inventedFact", "FABRICATED_FACT"],
    ["accountLeak", "ACCOUNT_LEAK"],
    ["duplicateSideEffect", "DUPLICATE_SIDE_EFFECT"],
  ]) {
    assert.ok(corrupt("ultrarunner", (t) => { t.observations[2][field] = true; }).failures.includes(expected));
  }
});
test("missing phase, account-switch proof or runtime provenance is not accepted", () => {
  assert.ok(corrupt("cyclist", (t) => { t.observations.pop(); }).failures.includes("MISSING_PHASE_FOLLOW_UP"));
  assert.ok(corrupt("shift-worker", (t) => { t.crossAccountTest = true; }).failures.includes("ACCOUNT_SWITCH_UNTESTED"));
  assert.ok(corrupt("multisport", (t) => { t.level = "model"; }).failures.includes("RUNTIME_EVIDENCE_REQUIRED"));
  assert.ok(corrupt("multisport", (t) => { t.level = "model"; }).failures.includes("MODEL_VERSION_REQUIRED"));
});
test("graded partially useful answers require review and cannot release", () => {
  const result = corrupt("road-runner", (t) => { t.grades.judgment = 1; });
  assert.equal(result.status, "NEEDS_REVIEW");
  assert.equal(result.releaseAccepted, false);
});
