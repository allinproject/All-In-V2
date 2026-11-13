export type CoachStagingBuildEnvironment = {
  EXPO_PUBLIC_SUPABASE_URL?: string;
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
  EXPO_PUBLIC_V2_COACH_STAGING_ACCEPTANCE?: string;
  EXPO_PUBLIC_V2_COACH_READ_ENABLED?: string;
  EXPO_PUBLIC_V2_COACH_SEND_ENABLED?: string;
};
export function assertCoachStagingBuildEnvironment(
  env: CoachStagingBuildEnvironment,
): void;
