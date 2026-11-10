import type { TrainingSport } from './trainingPlanSynthesis';

/** ALL-246/243: one sport identity, two always-available entry modes. */
export const V2_ACTIVITY_SPORTS = [
  'running', 'walking', 'cycling', 'swimming', 'strength', 'hiking',
  'rucking', 'rowing', 'elliptical', 'stair', 'yoga', 'mobility', 'other',
] as const satisfies readonly TrainingSport[];

export type ActivityEntryMode = 'start_activity' | 'manual_entry';
export type ActivitySport = typeof V2_ACTIVITY_SPORTS[number];
export type MachineSubtype = 'treadmill' | 'rowing_machine' | 'stair_stepper' | 'elliptical' | 'stationary_bike' | 'other_machine';

export function activityEntryOptions(sport: ActivitySport): readonly ActivityEntryMode[] {
  if (!V2_ACTIVITY_SPORTS.includes(sport)) throw new Error('Unrecognized sport');
  return ['start_activity', 'manual_entry'];
}

/** Photo capture is optional input to the MANUAL entry workflow, never an automatic workout. */
export function machinePhotoSport(machine: MachineSubtype): ActivitySport {
  switch (machine) {
    case 'treadmill': return 'running';
    case 'rowing_machine': return 'rowing';
    case 'stair_stepper': return 'stair';
    case 'elliptical': return 'elliptical';
    case 'stationary_bike': return 'cycling';
    default: return 'other';
  }
}

export type MachineReadingKind =
  | 'duration_seconds' | 'distance_meters' | 'calories_kcal'
  | 'heart_rate_bpm' | 'speed_kph' | 'incline_percent'
  | 'steps' | 'floors' | 'stroke_rate_spm' | 'resistance_level';

export type PhotoReadingCandidate = {
  metric: MachineReadingKind;
  value: number | null;
  displayUnit: string | null;
  /** No inferred value is authoritative until user review. */
  confidence: 'high' | 'uncertain' | 'unreadable';
};

export type MachinePhotoDraft = {
  machine: MachineSubtype;
  capturedAt: string | null;
  readings: PhotoReadingCandidate[];
  reviewed: false;
  source: 'machine_display_photo';
};

const allowedMetrics = new Set<MachineReadingKind>([
  'duration_seconds', 'distance_meters', 'calories_kcal', 'heart_rate_bpm',
  'speed_kph', 'incline_percent', 'steps', 'floors', 'stroke_rate_spm', 'resistance_level',
]);

/**
 * Normalizes model-extracted readings into a NON-SAVABLE draft.
 * Inconsistent, ambiguous, missing or unsupported readings stay null.
 * No photo bytes, GPS, machine identity or personally identifying data retained.
 */
export function prepareMachinePhotoDraft(
  machine: MachineSubtype,
  proposed: readonly PhotoReadingCandidate[],
): MachinePhotoDraft {
  const seen = new Set<string>();
  const readings = proposed.filter(item => {
    if (!allowedMetrics.has(item.metric) || seen.has(item.metric)) return false;
    seen.add(item.metric);
    return true;
  }).map(item => ({
    metric: item.metric,
    value: item.confidence === 'unreadable' || item.value === null || !Number.isFinite(item.value) || item.value < 0
      ? null : item.value,
    displayUnit: item.displayUnit?.trim() || null,
    confidence: item.confidence,
  }));
  return { machine, capturedAt: null, readings, reviewed: false, source: 'machine_display_photo' };
}
