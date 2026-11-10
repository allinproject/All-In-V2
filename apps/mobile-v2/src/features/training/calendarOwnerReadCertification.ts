import { validAthleteLocalDate } from './manualActivityDraft.ts';
import type { OwnerCalendarRead } from './trainingCalendarReadModel.ts';

/**
 * ALL-222/243/246: narrow bridge between canonical owner readers and the
 * existing Training calendar read model. This does NOT fetch from a database.
 * A caller may certify ready only after an authenticated, complete owner read.
 */
export type OwnerCalendarWindowSnapshot<T> = {
  ownerId: string;
  /** Auth session generation that initiated this read, not the current render generation. */
  authSessionGeneration: number;
  fromDate: string;
  throughDate: string;
  /** Non-empty authoritative owner revision / snapshot token. */
  snapshotVersion: string;
  /** Explicit successful coverage, never inferred from an empty array. */
  complete: boolean;
  /** Null means all pages consumed. */
  nextCursor: string | null;
  records: readonly T[];
};

export function certifyCalendarOwnerRead<T>(input: {
  expectedOwnerId: string;
  authenticatedOwnerId: string | null;
  activeSessionGeneration: number;
  accessGateReady: boolean;
  requestedFromDate: string;
  requestedThroughDate: string;
  snapshot: OwnerCalendarWindowSnapshot<T> | null | undefined;
}): OwnerCalendarRead<T> {
  const {
    expectedOwnerId, authenticatedOwnerId, activeSessionGeneration, accessGateReady,
    requestedFromDate, requestedThroughDate, snapshot,
  } = input;
  if (!accessGateReady || !expectedOwnerId || !authenticatedOwnerId
    || expectedOwnerId !== authenticatedOwnerId
    || !validAthleteLocalDate(requestedFromDate)
    || !validAthleteLocalDate(requestedThroughDate)
    || requestedFromDate > requestedThroughDate
    || !snapshot
    || snapshot.ownerId !== expectedOwnerId
    || !Number.isSafeInteger(activeSessionGeneration) || activeSessionGeneration < 0
    || snapshot.authSessionGeneration !== activeSessionGeneration
    || !validAthleteLocalDate(snapshot.fromDate)
    || !validAthleteLocalDate(snapshot.throughDate)
    || snapshot.fromDate > requestedFromDate
    || snapshot.throughDate < requestedThroughDate
    || snapshot.fromDate > snapshot.throughDate
    || !snapshot.complete
    || snapshot.nextCursor !== null
    || typeof snapshot.snapshotVersion !== 'string'
    || !snapshot.snapshotVersion.trim()
    || !Array.isArray(snapshot.records)) {
    return { status: 'unavailable' };
  }
  return {
    status: 'ready',
    ownerId: expectedOwnerId,
    fromDate: snapshot.fromDate,
    throughDate: snapshot.throughDate,
    records: snapshot.records,
  };
}
