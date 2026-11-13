/** Fail closed until canonical Training owns a complete, session-bound plan snapshot. */
export type AcceptedTrainingPlan = {
  ownerId: string;
  revisionId: string;
  title: string;
  goal: string;
  phase: string | null;
  dateRange: string;
  weekStructure: readonly { id: string; day: string; sport: string; purpose: string }[];
};
export type TrainingPlanOwnerEvidence =
  | { status: 'unavailable' | 'loading' | 'error' }
  | { status: 'ready'; ownerId: string; sessionGeneration: number; complete: true; plans: readonly AcceptedTrainingPlan[] };
export type TrainingPlanProjection =
  | { status: 'unavailable' }
  | { status: 'ready'; plans: readonly AcceptedTrainingPlan[] };
export function projectAcceptedTrainingPlans(
  expectedOwnerId: string,
  expectedSessionGeneration: number,
  evidence: TrainingPlanOwnerEvidence,
): TrainingPlanProjection {
  if (!expectedOwnerId.trim() || !Number.isSafeInteger(expectedSessionGeneration) || expectedSessionGeneration < 0 ||
      evidence.status !== 'ready' || !evidence.complete ||
      evidence.ownerId !== expectedOwnerId ||
      evidence.sessionGeneration !== expectedSessionGeneration || !Array.isArray(evidence.plans)) return { status: 'unavailable' };
  const revisions = new Set<string>();
  for (const p of evidence.plans) {
    if (!p || p.ownerId !== expectedOwnerId || typeof p.revisionId !== 'string' || !p.revisionId.trim() ||
        revisions.has(p.revisionId) || typeof p.title !== 'string' || !p.title.trim() ||
        typeof p.goal !== 'string' || !p.goal.trim() ||
        typeof p.dateRange !== 'string' || !p.dateRange.trim() ||
        !Array.isArray(p.weekStructure)) return { status: 'unavailable' };
    revisions.add(p.revisionId);
    const sessionIds = new Set<string>();
    for (const s of p.weekStructure) {
      if (!s || !s.id?.trim() || sessionIds.has(s.id) ||
          !s.day?.trim() || !s.sport?.trim() || !s.purpose?.trim()) return { status: 'unavailable' };
      sessionIds.add(s.id);
    }
  }
  return { status: 'ready', plans: evidence.plans };
}
