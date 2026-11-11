/**
 * ALL-258: canonical exercise-science metadata contract.
 *
 * A profile is bound to one canonical movement variation. Claims must carry
 * linked sources, population/context, evidence tier, directness and limitations.
 * This file contains no static exercise catalog or Coach recommendation logic.
 */
export type ExerciseEvidenceTier =
  | 'position_stand_or_guideline'
  | 'systematic_review_or_meta_analysis'
  | 'randomized_controlled_trial'
  | 'within_subject_controlled_intervention'
  | 'observational_study'
  | 'biomechanical_study'
  | 'expert_consensus';

export type ExerciseClaimDirectness =
  | 'direct_sport_outcome'
  | 'general_training_adaptation'
  | 'mechanistic_rationale';

export type ExerciseSport =
  | 'running'
  | 'cycling'
  | 'swimming'
  | 'triathlon'
  | 'walking'
  | 'hiking'
  | 'rucking'
  | 'rowing'
  | 'strength_sport'
  | 'general_fitness';

export type ExerciseGoal =
  | 'maximal_strength'
  | 'hypertrophy'
  | 'power'
  | 'muscular_endurance'
  | 'balance'
  | 'mobility'
  | 'sport_performance'
  | 'general_function';

export type ExerciseSource = {
  id: string;
  title: string;
  url: string;
  publishedYear: number;
  sourceType: ExerciseEvidenceTier;
  doi: string | null;
  pmid: string | null;
};

export type ExerciseEvidenceClaim = {
  id: string;
  claimType:
    | 'muscle_emphasis'
    | 'movement_demand'
    | 'general_adaptation'
    | 'sport_transfer'
    | 'recovery_or_load'
    | 'caution';
  statement: string;
  population: string;
  targetSports: readonly ExerciseSport[];
  targetGoals: readonly ExerciseGoal[];
  directness: ExerciseClaimDirectness;
  evidenceTier: ExerciseEvidenceTier;
  /** Confidence in this specific claim, not a universal athlete score. */
  confidence: 'high' | 'moderate' | 'low' | 'very_low' | 'not_rated';
  sourceIds: readonly string[];
  /** Required; states what this evidence does not establish. */
  limitations: string;
};

export type ExerciseScienceProfile = {
  schemaVersion: 1;
  publicationState: 'draft' | 'reviewed';
  movementId: string;
  variationId: string;
  displayName: string;
  aliases: readonly string[];
  variationDescription: string;
  movementPattern:
    | 'squat'
    | 'hinge'
    | 'lunge'
    | 'step'
    | 'horizontal_push'
    | 'vertical_push'
    | 'horizontal_pull'
    | 'vertical_pull'
    | 'carry'
    | 'rotation'
    | 'anti_rotation'
    | 'trunk_flexion'
    | 'trunk_extension'
    | 'jump_or_landing'
    | 'calf_or_ankle'
    | 'knee_flexion'
    | 'elbow_extension'
    | 'locomotion'
    | 'other';
  laterality: 'bilateral' | 'unilateral' | 'alternating' | 'mixed';
  contractionModes: readonly ('concentric' | 'eccentric' | 'isometric' | 'plyometric')[];
  skillLevel: 'beginner' | 'intermediate' | 'advanced';
  equipmentRequiredIds: readonly string[];
  equipmentOptionalIds: readonly string[];
  muscleGroups: readonly {
    muscleGroupId: string;
    role: 'primary' | 'secondary' | 'stabilizer';
    sourceIds: readonly string[];
  }[];
  jointDemands: readonly {
    jointId: string;
    action: string;
    plane: 'sagittal' | 'frontal' | 'transverse' | 'multi_planar' | 'varies';
    rangeOfMotion: 'short' | 'moderate' | 'long' | 'variable' | 'unknown';
    relativeDemand: 'low' | 'moderate' | 'high' | 'variable' | 'unknown';
    sourceIds: readonly string[];
  }[];
  cautionFlags: readonly {
    flagId: string;
    description: string;
    sourceIds: readonly string[];
  }[];
  coachingCues: {
    setup: readonly string[];
    execution: readonly string[];
    commonErrors: readonly string[];
  };
  progressionVariationIds: readonly string[];
  regressionVariationIds: readonly string[];
  alternativeVariationIds: readonly string[];
  sources: readonly ExerciseSource[];
  claims: readonly ExerciseEvidenceClaim[];
};

export type ExerciseProfileValidation =
  | { valid: true; coachEligible: boolean; sourceCount: number; claimCount: number }
  | { valid: false; coachEligible: false; errors: readonly string[] };

const EVIDENCE_TIERS: readonly ExerciseEvidenceTier[] = [
  'position_stand_or_guideline',
  'systematic_review_or_meta_analysis',
  'randomized_controlled_trial',
  'within_subject_controlled_intervention',
  'observational_study',
  'biomechanical_study',
  'expert_consensus',
];
const SPORTS: readonly ExerciseSport[] = [
  'running','cycling','swimming','triathlon','walking','hiking','rucking',
  'rowing','strength_sport','general_fitness',
];
const GOALS: readonly ExerciseGoal[] = [
  'maximal_strength','hypertrophy','power','muscular_endurance','balance',
  'mobility','sport_performance','general_function',
];
const MOVEMENT_PATTERNS = [
  'squat','hinge','lunge','step','horizontal_push','vertical_push',
  'horizontal_pull','vertical_pull','carry','rotation','anti_rotation',
  'trunk_flexion','trunk_extension','jump_or_landing','calf_or_ankle',
  'knee_flexion','elbow_extension','locomotion','other',
] as const;
const PLANES = ['sagittal','frontal','transverse','multi_planar','varies'] as const;
const ROM_RANGES = ['short','moderate','long','variable','unknown'] as const;
const RELATIVE_DEMANDS = ['low','moderate','high','variable','unknown'] as const;
const CLAIM_TYPES = ['muscle_emphasis','movement_demand','general_adaptation','sport_transfer','recovery_or_load','caution'] as const;
const DIRECTNESS = ['direct_sport_outcome','general_training_adaptation','mechanistic_rationale'] as const;
const CONFIDENCE = ['high','moderate','low','very_low','not_rated'] as const;
const LATERALITY = ['bilateral','unilateral','alternating','mixed'] as const;
const SKILL_LEVELS = ['beginner','intermediate','advanced'] as const;
const CONTRACTION_MODES = ['concentric','eccentric','isometric','plyometric'] as const;

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
function stringList(values: readonly string[] | undefined, minimum = 0): boolean {
  return Array.isArray(values) && values.length >= minimum &&
    values.every((value) => nonEmpty(value));
}
function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}
function httpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Validates a single variation profile. Draft profiles may be stored/reviewed
 * by the library owner, but only reviewed profiles are eligible for Coach.
 * This function never turns a draft or unsourced claim into usable guidance.
 */
export function validateExerciseScienceProfile(
  profile: ExerciseScienceProfile,
): ExerciseProfileValidation {
  const errors: string[] = [];
  if (!profile || profile.schemaVersion !== 1) errors.push('Unsupported exercise profile schema version.');
  if (!profile || !['draft','reviewed'].includes(profile.publicationState)) errors.push('Profile publication state is invalid.');
  if (!nonEmpty(profile?.movementId) || !nonEmpty(profile?.variationId)) errors.push('Stable movement and variation IDs are required.');
  if (!nonEmpty(profile?.displayName) || !nonEmpty(profile?.variationDescription)) errors.push('Exercise name and exact variation description are required.');
  if (!Array.isArray(profile?.aliases) || !profile.aliases.every(nonEmpty)) errors.push('Exercise aliases must be non-empty strings.');
  else if (!unique(profile.aliases.map((alias) => alias.trim().toLowerCase()))) errors.push('Exercise aliases must be unique.');
  if (!oneOf(profile?.movementPattern,MOVEMENT_PATTERNS)) errors.push('Movement pattern is invalid.');
  if (!oneOf(profile?.laterality,LATERALITY)) errors.push('Laterality is invalid.');
  if (!Array.isArray(profile?.contractionModes) || profile.contractionModes.length === 0 ||
    !profile.contractionModes.every((mode) => oneOf(mode,CONTRACTION_MODES)) ||
    !unique(profile.contractionModes)) errors.push('At least one valid, unique contraction mode is required.');
  if (!oneOf(profile?.skillLevel,SKILL_LEVELS)) errors.push('Skill level is invalid.');
  if (!stringList(profile?.equipmentRequiredIds) || !unique(profile.equipmentRequiredIds || [])) errors.push('Required equipment IDs must be unique non-empty canonical IDs.');
  if (!stringList(profile?.equipmentOptionalIds) || !unique(profile.equipmentOptionalIds || [])) errors.push('Optional equipment IDs must be unique non-empty canonical IDs.');
  if (!Array.isArray(profile?.sources)) errors.push('Source registry must be a list.');
  const sourceRecords = Array.isArray(profile?.sources) ? profile.sources : [];
  const sourceIds = new Set<string>();
  for (const source of sourceRecords) {
    if (!source || !nonEmpty(source.id) || sourceIds.has(source.id)) {
      errors.push('Source IDs must be present and unique.');
      continue;
    }
    sourceIds.add(source.id);
    if (!nonEmpty(source.title) || !nonEmpty(source.url) || !httpsUrl(source.url)) errors.push('Each source needs a title and HTTPS URL.');
    if (!Number.isInteger(source.publishedYear) || source.publishedYear < 1900 || source.publishedYear > 2100) errors.push('Source publication year is invalid.');
    if (!oneOf(source.sourceType,EVIDENCE_TIERS)) errors.push('Source evidence tier is invalid.');
    if (source.doi !== null && !nonEmpty(source.doi)) errors.push('DOI must be null or a non-empty identifier.');
    if (source.pmid !== null && !/^\d+$/.test(source.pmid)) errors.push('PMID must be null or numeric.');
  }

  const muscleGroups = Array.isArray(profile?.muscleGroups) ? profile.muscleGroups : [];
  const jointDemands = Array.isArray(profile?.jointDemands) ? profile.jointDemands : [];
  const cautionFlags = Array.isArray(profile?.cautionFlags) ? profile.cautionFlags : [];
  const evidenceClaims = Array.isArray(profile?.claims) ? profile.claims : [];
  if (!Array.isArray(profile?.muscleGroups) || profile.muscleGroups.length === 0) {
    errors.push('At least one sourced muscle-group role is required.');
  }
  const muscleGroupIds = new Set<string>();
  let hasPrimaryMuscle = false;
  for (const muscle of muscleGroups) {
    if (!muscle || !nonEmpty(muscle.muscleGroupId) || muscleGroupIds.has(muscle.muscleGroupId) ||
      !oneOf(muscle.role,['primary','secondary','stabilizer'] as const)) {
      errors.push('Muscle group identities and roles must be valid and unique.');
      continue;
    }
    muscleGroupIds.add(muscle.muscleGroupId);
    if (muscle.role === 'primary') hasPrimaryMuscle = true;
    if (!stringList(muscle.sourceIds,1) || muscle.sourceIds.some((id: string) => !sourceIds.has(id))) {
      errors.push('Each muscle-group role must link to registered sources.');
    }
  }
  if (Array.isArray(profile?.muscleGroups) && profile.muscleGroups.length > 0 && !hasPrimaryMuscle) {
    errors.push('At least one primary muscle-group role is required.');
  }

  if (!Array.isArray(profile?.jointDemands)) errors.push('Joint demands must be a list.');
  for (const demand of jointDemands) {
    if (!demand) { errors.push('Joint demand entry is invalid.'); continue; }
    if (!nonEmpty(demand.jointId) || !nonEmpty(demand.action) ||
      !oneOf(demand.plane,PLANES) || !oneOf(demand.rangeOfMotion,ROM_RANGES) || !oneOf(demand.relativeDemand,RELATIVE_DEMANDS)) {
      errors.push('Each joint demand needs a joint, action, plane and demand level.');
    }
    if (!stringList(demand.sourceIds, 1) || demand.sourceIds.some((id: string) => !sourceIds.has(id))) {
      errors.push('Each joint demand must link to registered sources.');
    }
  }

  if (!Array.isArray(profile?.cautionFlags)) errors.push('Caution flags must be a list.');
  const cautionIds = new Set<string>();
  for (const caution of cautionFlags) {
    if (!caution || !nonEmpty(caution.flagId) || cautionIds.has(caution.flagId) || !nonEmpty(caution.description)) {
      errors.push('Caution flags need unique IDs and descriptions.');
      continue;
    }
    cautionIds.add(caution.flagId);
    if (!stringList(caution.sourceIds, 1) || caution.sourceIds.some((id: string) => !sourceIds.has(id))) {
      errors.push('Each caution flag must link to registered sources.');
    }
  }

  const cues = profile?.coachingCues;
  if (!cues || !stringList(cues.setup, 1) || !stringList(cues.execution, 1) ||
    !stringList(cues.commonErrors)) errors.push('Variation-specific written setup and execution cues are required.');

  for (const [label, ids] of [
    ['progression',profile?.progressionVariationIds],
    ['regression',profile?.regressionVariationIds],
    ['alternative',profile?.alternativeVariationIds],
  ] as const) {
    if (!stringList(ids) || !unique(ids || []) || (ids || []).includes(profile.variationId)) {
      errors.push(`Exercise ${label} variation IDs must be unique, non-self references.`);
    }
  }

  if (!Array.isArray(profile?.claims)) errors.push('Exercise evidence claims must be a list.');
  const claimIds = new Set<string>();
  for (const claim of evidenceClaims) {
    if (!claim || !nonEmpty(claim.id) || claimIds.has(claim.id)) {
      errors.push('Evidence claim IDs must be present and unique.');
      continue;
    }
    claimIds.add(claim.id);
    if (!nonEmpty(claim.statement) || !nonEmpty(claim.population) || !nonEmpty(claim.limitations)) errors.push('Each claim needs a bounded statement, population and limitations.');
    if (!oneOf(claim.claimType,CLAIM_TYPES)) errors.push('Claim type is invalid.');
    if (!Array.isArray(claim.targetSports) || !claim.targetSports.every((sport: ExerciseSport) => SPORTS.includes(sport)) || !unique(claim.targetSports)) errors.push('Claim target sports must be valid and unique.');
    if (!Array.isArray(claim.targetGoals) || !claim.targetGoals.every((goal: ExerciseGoal) => GOALS.includes(goal)) || !unique(claim.targetGoals)) errors.push('Claim target goals must be valid and unique.');
    if (!oneOf(claim.directness,DIRECTNESS) || !oneOf(claim.evidenceTier,EVIDENCE_TIERS) || !oneOf(claim.confidence,CONFIDENCE)) errors.push('Claim directness, evidence tier and confidence are invalid.');
    if (!stringList(claim.sourceIds, 1) || claim.sourceIds.some((id: string) => !sourceIds.has(id))) errors.push('Each claim must link to registered source records.');
    if (claim.directness === 'direct_sport_outcome' && Array.isArray(claim.targetSports) && claim.targetSports.length === 0) errors.push('Direct sport-outcome claims must name the studied sport.');
    if (claim.directness === 'mechanistic_rationale' && !['biomechanical_study','expert_consensus'].includes(claim.evidenceTier)) errors.push('Mechanistic rationale cannot be presented as direct outcome evidence.');
  }

  if (errors.length) return {valid:false,coachEligible:false,errors:[...new Set(errors)]};
  return {
    valid:true,
    coachEligible:profile.publicationState === 'reviewed' &&
      profile.sources.length > 0 &&
      profile.claims.length > 0,
    sourceCount:profile.sources.length,
    claimCount:profile.claims.length,
  };
}
