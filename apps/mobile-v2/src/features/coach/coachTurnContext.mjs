/**
 * ALL-217 / ALL-232 / ALL-241 — read-only Coach turn context preflight.
 *
 * The canonical owners fetch and certify data before this function is called.
 * This function does not authenticate, query, persist, summarize, or authorize
 * writes. It rejects mixed owners and missing restriction state rather than
 * presenting incomplete context as safe personalized guidance.
 */
import { projectCoachThreadAnchors } from "./coachTurnContinuity.mjs";

const VALID_COMPLETENESS = new Set(["complete_for_requested_scope", "partial", "unavailable"]);
const VALID_RESTRICTIONS = new Set(["exercise", "equipment", "schedule", "pain_or_return", "preference"]);
const VALID_SOURCES = new Set(["explicit_user", "approved_plan", "system_inferred"]);
const VALID_COVERAGE = new Set(["complete", "partial", "none", "unknown"]);
const MAX_HISTORY_EVENTS = 100;
const validId = x => typeof x === "string" && x.trim().length > 0;
const validTime = x => typeof x === "string" && x.trim().length > 0 && Number.isFinite(Date.parse(x));
const validDate = x => {
  if (typeof x !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(x)) return false;
  const parsed = new Date(x + "T12:00:00Z");
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0,10) === x;
};

/**
 * historyCertification must come from the authenticated canonical owner
 * adapter, NOT the model or arbitrary screen text. `verified` is only a
 * preflight input, not proof that an actual owner reader was executed.
 */
export function prepareCoachTurnContext(input) {
  const blocked = reason => ({kind:"blocked",reason});
  if (!input || !validId(input.authenticatedUserId)) return blocked("signed_out");
  if (input.accessGateReady !== true) return blocked("access_gate_required");
  if (!validId(input.accountId) || input.accountId !== input.authenticatedUserId) return blocked("account_mismatch");
  if (!validId(input.threadId) || !validId(input.message)) return blocked("missing_turn_identity");
  const cert = input.historyCertification;
  if (!cert || cert.verified !== true || cert.ownerId !== input.authenticatedUserId ||
      !validId(cert.sourceRef) || !validTime(cert.readAt)) return blocked("history_owner_unverified");

  const model = input.history;
  if (!model || model.version !== 1 ||
      !VALID_COMPLETENESS.has(model.completeness) ||
      !validTime(model.generatedAt) ||
      !model.requested || !validDate(model.requested.fromDate) ||
      !validDate(model.requested.throughDate) ||
      model.requested.fromDate > model.requested.throughDate ||
      !Array.isArray(model.requested.sports) || model.requested.sports.length === 0 ||
      !model.requested.sports.every(validId) ||
      !Array.isArray(model.events) || model.events.length > MAX_HISTORY_EVENTS ||
      !Array.isArray(model.restrictions) ||
      !Array.isArray(model.coverage) || !Array.isArray(model.warnings)) {
    return blocked("history_invalid");
  }
  if (Date.parse(model.generatedAt) > Date.parse(cert.readAt)) return blocked("history_future_snapshot");
  // The trusted host supplies currentTime. No cached history snapshot should
  // silently provide current-day plan advice after the owner read goes stale.
  if (!validTime(input.currentTime) ||
      Date.parse(cert.readAt) > Date.parse(input.currentTime)) return blocked("history_future_read");
  const ageMs = Date.parse(input.currentTime) - Date.parse(cert.readAt);
  if (ageMs > 15 * 60 * 1000) return blocked("history_stale");

  // A missing restrictions reader is not an empty verified restriction list.
  if (input.restrictionsVerified !== true) return blocked("restrictions_unverified");
  if (!model.restrictions.every(r =>
    r && r.status === "active" && validId(r.id) && validId(r.subject) &&
    VALID_RESTRICTIONS.has(r.category) && VALID_SOURCES.has(r.source) &&
    validTime(r.updatedAt)
  )) return blocked("restrictions_invalid");
  if (model.currentPlan !== null && (
      !model.currentPlan || !validId(model.currentPlan.id) ||
      !Number.isSafeInteger(model.currentPlan.revision) ||
      model.currentPlan.revision < 1 || model.currentPlan.status !== "accepted")) {
    return blocked("plan_invalid");
  }
  if (!model.coverage.every(c => c && validId(c.sport) && VALID_COVERAGE.has(c.status) &&
      validDate(c.fromDate) && validDate(c.throughDate) &&
      Array.isArray(c.missingIntervals))) return blocked("coverage_invalid");
  if (!model.events.every(e => e && validId(e.id) && validTime(e.occurredAt) &&
      validTime(e.recordedAt) && validId(e.summary) &&
      Date.parse(e.occurredAt) <= Date.parse(e.recordedAt))) return blocked("events_invalid");
  // A current accepted calendar day is distinct from completed history.
  // Keep its original structured session-intent blocks, not a generated or
  // chat-derived description of the routine. Invalid/mixed-day data blocks.
  const day = model.plannedDay;
  if (day !== undefined && (
      !day || day.verified !== true || !validDate(day.localDate) ||
      day.localDate < model.requested.fromDate ||
      day.localDate !== model.requested.throughDate ||
      !Array.isArray(day.calendarDays) || day.calendarDays.length > 64 ||
      !Array.isArray(day.sessions) || day.sessions.length > 8 ||
      JSON.stringify(day.sessions).length > 16000 ||
      day.calendarDays.some(d => !d || !validId(d.planId) ||
        !validId(d.revisionId) ||
        !["planned","rest","recovery","unavailable","race","review_required"].includes(d.dayState)) ||
      day.sessions.some(s => !s || !validId(s.sessionId) ||
        !validId(s.planId) || !validId(s.revisionId) ||
        s.localDate !== day.localDate ||
        !model.requested.sports.includes(s.sport) ||
        !validId(s.sessionKind) || !validId(s.purpose) ||
        s.intentSchemaVersion !== "session-intent-v1" ||
        !s.intent || typeof s.intent !== "object" ||
        Array.isArray(s.intent) ||
        !day.calendarDays.some(d => d.planId === s.planId &&
          d.revisionId === s.revisionId)))) {
    return blocked("planned_day_invalid");
  }
  if (day && new Set(day.sessions.map(s => s.sessionId)).size !== day.sessions.length)
    return blocked("planned_day_invalid");
  if (model.completeness === "complete_for_requested_scope") {
    const allCovered = model.requested.sports.every(sport => {
      const reports = model.coverage.filter(c => c.sport === sport);
      return reports.length > 0 &&
        reports.every(c => c.status === "complete" && c.missingIntervals.length === 0) &&
        reports.some(c => c.fromDate <= model.requested.fromDate &&
          c.throughDate >= model.requested.throughDate);
    });
    if (!allCovered) return blocked("coverage_not_complete");
  }

  // Neither the model nor conversation may assert complete history merely
  // because no recent events were returned.
  const coverage = model.completeness;
  const anchors = input.conversationRows === undefined
    ? null : projectCoachThreadAnchors({
      accountId: input.accountId,threadId:input.threadId,
      message:input.message,rows:input.conversationRows,
      recentLimit:input.recentLimit ?? 4,maxAnchors:input.maxAnchors ?? 4
    });
  if (input.conversationRows !== undefined &&
      !Array.isArray(input.conversationRows)) return blocked("conversation_invalid");

  return {
    kind:"ready",
    scope:"coach_read_only",
    accountId:input.accountId,
    threadId:input.threadId,
    historySourceRef:cert.sourceRef,
    historyReadAt:cert.readAt,
    completeness:coverage,
    incompleteHistory:coverage!=="complete_for_requested_scope",
    warnings:[...model.warnings, ...(coverage!=="complete_for_requested_scope"
      ? ["Incomplete or unavailable history cannot be interpreted as zero activity or adherence."] : [])],
    activeRestrictions:model.restrictions.map(r=>({
      id:r.id,category:r.category,subject:r.subject,source:r.source,updatedAt:r.updatedAt
    })),
    acceptedPlan:model.currentPlan===null?null:{
      id:model.currentPlan.id,revision:model.currentPlan.revision
    },
    relevantHistory:model.events.map(e=>({
      id:e.id,kind:e.kind,sport:e.sport,occurredAt:e.occurredAt,
      source:e.source,canonicalRef:e.canonicalRef,summary:e.summary,confidence:e.confidence
    })),
    plannedDay:day===undefined?null:day,
    priorConversation:anchors,
    noWriteAuthority:true
  };
}
