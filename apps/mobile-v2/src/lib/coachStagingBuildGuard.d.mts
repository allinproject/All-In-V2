export type CoachStagingBuildEnvironment = {
  EXPO_PUBLIC_SUPABASE_URL?: string;
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
  EXPO_PUBLIC_V2_COACH_STAGING_ACCEPTANCE?: string;
  EXPO_PUBLIC_V2_COACH_READ_ENABLED?: string;
  EXPO_PUBLIC_V2_COACH_SEND_ENABLED?: string;
  EXPO_PUBLIC_V2_FUEL_DAY_READ_ENABLED?: string;
  EXPO_PUBLIC_V2_FUEL_MANUAL_WRITE_ENABLED?: string;
  EXPO_PUBLIC_V2_ROUTINE_LOCAL_AUTH_ACCEPTANCE?: string;
  EXPO_PUBLIC_V2_ROUTINE_TEMP_STAGING_ACCEPTANCE?: string;
};
export function assertCoachStagingBuildEnvironment(
  env: CoachStagingBuildEnvironment,
): void;
