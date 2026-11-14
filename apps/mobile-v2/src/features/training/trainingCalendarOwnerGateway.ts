import {
  combineCalendarReads,
  type CombinedCalendarResult,
  type CompletedCalendarItem,
  type OwnerCalendarRead,
  type PlannedCalendarItem,
} from './trainingCalendarReadModel.ts';
import { validAthleteLocalDate } from './manualActivityDraft.ts';

/**
 * ALL-246/243: authenticated client boundary for two independent canonical
 * owner readers. The readers must be supplied by their approved domain owners.
 * No database table names, unauthorized RPCs, or fallback mock rows live here.
 */
export type TrainingCalendarOwnerSession = {
  ownerId: string;
  generation: number;
  isCurrent: () => boolean;
};
export type TrainingCalendarOwnerReader<T> = (
  scope: { ownerId: string; sessionGeneration: number; fromDate: string; throughDate: string },
) => Promise<OwnerCalendarRead<T>>;

const unavailable = (): OwnerCalendarRead<never> => ({ status: 'unavailable' });

export async function readAuthenticatedTrainingCalendar(args: {
  session: TrainingCalendarOwnerSession;
  fromDate: string;
  throughDate: string;
  readPlanned: TrainingCalendarOwnerReader<PlannedCalendarItem>;
  readCompleted: TrainingCalendarOwnerReader<CompletedCalendarItem>;
}): Promise<CombinedCalendarResult> {
  const { session, fromDate, throughDate } = args;
  const safeResult = () => combineCalendarReads({
    ownerId: session.ownerId,
    fromDate,
    throughDate,
    planned: unavailable(),
    completed: unavailable(),
  });
  if (!session.ownerId?.trim() || !Number.isSafeInteger(session.generation) ||
    session.generation < 0 || !validAthleteLocalDate(fromDate) ||
    !validAthleteLocalDate(throughDate) || fromDate > throughDate ||
    !session.isCurrent()) return safeResult();

  const scope = Object.freeze({
    ownerId: session.ownerId,
    sessionGeneration: session.generation,
    fromDate,
    throughDate,
  });
  // An independent source may fail without hiding certified results from
  // the other owner; neither failure is a legitimate zero-workout read.
  const [planned, completed] = await Promise.all([
    Promise.resolve().then(() => args.readPlanned(scope)).catch(() => unavailable()),
    Promise.resolve().then(() => args.readCompleted(scope)).catch(() => unavailable()),
  ]);
  // A user switch, sign-out or new session generation during either network
  // request invalidates BOTH results, even when their row owner IDs match.
  if (!session.isCurrent()) return safeResult();
  return combineCalendarReads({
    ownerId: session.ownerId, fromDate, throughDate, planned, completed,
  });
}
