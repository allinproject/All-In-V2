/**
 * ALL-241 Coach quality evidence contracts.
 * Evaluates supplied observation traces; it does NOT call Coach or prove live behavior.
 * Keep source facts and human assessments outside this dependency-free checker.
 */
export const COACH_COHORTS = Object.freeze([
  ["beginner", "Beginner / returning athlete", "Manageable activity without assumed gym, race or numeric goal"],
  ["road-runner", "Recreational road runner", "Schedule, road-specific sessions, owned gear and recovery"],
  ["ultrarunner", "Trail / ultrarunner", "Verified terrain, course, aid stations, practiced fueling and gear"],
  ["cyclist", "Cyclist", "Cycling-specific time/power/equipment; no run-equivalency guesses"],
  ["lifter", "Strength / physique athlete", "Exercise identity, loads, constraints and approved workout structure"],
  ["multisport", "Swimmer / triathlete / multisport", "Distinct sport-specific loads, coordinated recovery"],
  ["shift-worker", "Changing-schedule athlete", "Changed availability and missed sessions without silent reflow"],
  ["lifestyle", "Lifestyle / nutrition athlete", "Qualitative goals and optional tracking without fabricated progress"],
]);
export const COACH_PHASES = Object.freeze([
  "establish", "fresh-thread", "changed-context", "uncertainty", "action-review", "follow-up",
]);

/**
 * An observation is measured by the executing harness/reviewer, NOT an AI-generated
 * claim of successful execution. Structured invariants can fail fast, while natural
 * language relevance/judgment still require real-model runs and human evaluation.
 */
export function evaluateCoachTrace(trace) {
  const failures = [];
  const fail = (reason) => failures.push(reason);
  if (!trace || typeof trace !== "object" || Array.isArray(trace)) {
    return { status: "FAILED", failures: ["INVALID_TRACE"], releaseAccepted: false };
  }
  if (!COACH_COHORTS.some(([id]) => id === trace.cohort)) fail("UNKNOWN_COHORT");
  if (!["fixture", "integration", "model", "device"].includes(trace.level)) fail("INVALID_LEVEL");
  if (!/^[a-f0-9]{40}$/.test(trace.sourceSha ?? "")) fail("SOURCE_SHA_REQUIRED");
  if (typeof trace.scenarioId !== "string" || !trace.scenarioId.trim()) fail("SCENARIO_ID_REQUIRED");

  const observations = Array.isArray(trace.observations) ? trace.observations : [];
  for (const phase of COACH_PHASES) {
    if (!observations.some((observation) => observation?.phase === phase)) {
      fail("MISSING_PHASE_" + phase.toUpperCase().replace(/-/g, "_"));
    }
  }
  const identities = new Set();
  for (const observation of observations) {
    if (!observation || typeof observation !== "object") {
      fail("INVALID_OBSERVATION");
      continue;
    }
    if (!COACH_PHASES.includes(observation.phase)) fail("UNKNOWN_PHASE");
    if (!observation.actorId || !observation.accountId || !observation.threadId) fail("IDENTITY_MISSING");
    if (observation.accountId) identities.add(observation.accountId);
    if (observation.level && observation.level !== trace.level) fail("LEVEL_MISMATCH");
    if (observation.claimsSaved === true &&
        !(observation.ownerWrite === "applied" && observation.readback === "verified")) fail("FALSE_SAVED_CLAIM");
    if (observation.ownerWrite === "applied" && observation.approved !== true) fail("UNAPPROVED_WRITE");
    if (observation.ownerWrite === "applied" &&
        (!observation.ownerDomain || !observation.targetId || observation.expectedVersion === undefined)) fail("UNBOUND_WRITE");
    if (observation.sourceState === "missing" && observation.treatedAsZero === true) fail("MISSING_TREATED_AS_ZERO");
    if (observation.hardRestrictionViolated === true) fail("RESTRICTION_VIOLATION");
    if (observation.staleContextUsed === true) fail("STALE_CONTEXT");
    if (observation.inventedFact === true) fail("FABRICATED_FACT");
    if (observation.duplicateSideEffect === true) fail("DUPLICATE_SIDE_EFFECT");
    if (observation.accountLeak === true) fail("ACCOUNT_LEAK");
    if (observation.actionChangedAfterApproval === true) fail("CHANGED_AFTER_APPROVAL");
  }
  if (identities.size > 1 && !trace.crossAccountTest) fail("CROSS_ACCOUNT_UNDECLARED");
  if (trace.crossAccountTest === true && identities.size < 2) fail("ACCOUNT_SWITCH_UNTESTED");

  // Grades are human/evaluator-supplied observations, never model self-scores.
  const grades = trace.grades;
  if (!grades || !["continuity", "judgment", "followThrough"].every(
    (key) => Number.isInteger(grades[key]) && grades[key] >= 0 && grades[key] <= 2
  )) fail("GRADES_REQUIRED");
  if (trace.level !== "fixture" &&
      (!trace.captureId || !trace.environment || !trace.observedAt)) fail("RUNTIME_EVIDENCE_REQUIRED");
  if (trace.level === "model" && !trace.modelVersion) fail("MODEL_VERSION_REQUIRED");
  if (trace.level === "device" && !trace.deviceId) fail("DEVICE_EVIDENCE_REQUIRED");

  const passes = failures.length === 0 &&
    grades?.continuity === 2 && grades?.judgment === 2 && grades?.followThrough === 2;
  // Even a passing recorded trace is NOT release acceptance. ALL-241 needs
  // independent model, canonical integration, device and cohort-level evidence.
  return {
    status: failures.length ? "FAILED" : passes ? "TRACE_PASS" : "NEEDS_REVIEW",
    failures,
    level: trace.level,
    releaseAccepted: false,
  };
}

/** Synthetic traces exercise the evaluator ONLY, not the Coach implementation. */
export function makeSyntheticCoachTrace(cohort) {
  return {
    scenarioId: "ALL241-" + cohort + "-fixture",
    cohort,
    level: "fixture",
    sourceSha: "a".repeat(40),
    observations: COACH_PHASES.map((phase, index) => ({
      phase,
      actorId: "synthetic-athlete",
      accountId: "synthetic-account",
      threadId: index === 1 ? "fresh-thread" : "prior-thread",
      ...(phase === "action-review"
        ? { approved: true, ownerDomain: "training", targetId: "workout-1",
            expectedVersion: 4, ownerWrite: "applied", readback: "verified", claimsSaved: true }
        : {}),
    })),
    grades: { continuity: 2, judgment: 2, followThrough: 2 },
  };
}
