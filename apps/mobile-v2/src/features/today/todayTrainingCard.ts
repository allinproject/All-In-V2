import {
  calendarDaySections, type CombinedCalendarResult,
} from '../training/trainingCalendarReadModel.ts';
import { validAthleteLocalDate } from '../training/manualActivityDraft.ts';

export type TodayTrainingCard = {
  status: 'unavailable' | 'partial' | 'ready';
  title: string;
  detail: string;
  /** Until the canonical pre-start route is implemented, always open Train's exact selected day. */
  actionLabel: 'Open Training Calendar';
};

/** ALL-250: pure summary of the SAME owner-validated Training calendar read model.
 * No alternate workout history, completion logic, plan mutation or default rest-day inference.
 */
export function summarizeTodayTraining(
  combined: CombinedCalendarResult,
  day: string | null,
): TodayTrainingCard {
  const fallback: TodayTrainingCard = {
    status: 'unavailable',
    title: 'Training plan not connected yet',
    detail: 'Your accepted workouts will appear here when the verified Training reader is connected. No rest day is being inferred.',
    actionLabel: 'Open Training Calendar',
  };
  if (!day || !validAthleteLocalDate(day)) return fallback;
  const sections = calendarDaySections(combined, day);
  if (sections.scheduled.status !== 'ready') {
    if (sections.completed.status === 'ready' && sections.completed.records.length) {
      const n = sections.completed.records.length;
      return {
        status: 'partial',
        title: n === 1 ? '1 activity completed' : `${n} activities completed`,
        detail: 'Completed activities are verified, but the planned training schedule is unavailable.',
        actionLabel: 'Open Training Calendar',
      };
    }
    return fallback;
  }
  const scheduled = sections.scheduled.records;
  const completedKnown = sections.completed.status === 'ready';
  const completedCount = sections.completed.status === 'ready' ? sections.completed.records.length : 0;
  const plannedCount = scheduled.filter(item => item.state === 'planned').length;
  const explicitRest = scheduled.some(item => item.state === 'rest');
  const explicitRecovery = scheduled.some(item => item.state === 'recovery');
  const missed = scheduled.filter(item => item.state === 'missed').length;
  const status = completedKnown ? 'ready' : 'partial';
  if (plannedCount > 0) {
    return {
      status,
      title: plannedCount === 1 ? '1 workout scheduled' : `${plannedCount} workouts scheduled`,
      detail: completedKnown
        ? (completedCount ? `${completedCount} completed ${completedCount === 1 ? 'activity' : 'activities'} also recorded today.` : 'Open today’s calendar to review your scheduled training.')
        : 'Planned training is verified. Completed activity data is currently unavailable.',
      actionLabel: 'Open Training Calendar',
    };
  }
  if (completedCount > 0) {
    return {
      status, title: completedCount === 1 ? '1 activity completed' : `${completedCount} activities completed`,
      detail: 'Completed activity data is verified. Review your day in the Training Calendar.',
      actionLabel: 'Open Training Calendar',
    };
  }
  if (missed > 0) {
    return { status, title: missed === 1 ? '1 workout marked missed' : `${missed} workouts marked missed`,
      detail: completedKnown ? 'This status comes from your accepted Training plan.' : 'Completed activity data is unavailable; review the plan before changing anything.',
      actionLabel: 'Open Training Calendar' };
  }
  if (explicitRest || explicitRecovery) {
    return {
      status,
      title: explicitRest && explicitRecovery ? 'Rest and recovery planned' : explicitRest ? 'Planned rest day' : 'Recovery planned',
      detail: completedKnown ? 'This is an explicit plan entry, not a conclusion drawn from missing workouts.' : 'Your plan is verified; completed activities could not be checked.',
      actionLabel: 'Open Training Calendar',
    };
  }
  return {
    status,
    title: completedKnown ? 'No workouts scheduled today' : 'No scheduled workouts found',
    detail: completedKnown
      ? 'Both planned and completed sources were checked for this day. No rest day was inferred.'
      : 'The plan is verified empty for today, but completed activity data is unavailable.',
    actionLabel: 'Open Training Calendar',
  };
}
