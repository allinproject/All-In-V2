import 'react-native-url-polyfill/auto';
import 'expo-sqlite/localStorage/install';

import { AppState, Platform } from 'react-native';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../types/database.types';
import { assertCoachStagingBuildEnvironment } from './coachStagingBuildGuard.mjs';

assertCoachStagingBuildEnvironment({
  EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  EXPO_PUBLIC_V2_COACH_STAGING_ACCEPTANCE: process.env.EXPO_PUBLIC_V2_COACH_STAGING_ACCEPTANCE,
  EXPO_PUBLIC_V2_COACH_READ_ENABLED: process.env.EXPO_PUBLIC_V2_COACH_READ_ENABLED,
  EXPO_PUBLIC_V2_COACH_SEND_ENABLED: process.env.EXPO_PUBLIC_V2_COACH_SEND_ENABLED,
});

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
const supabasePublishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

if (!supabaseUrl || !supabasePublishableKey) {
  throw new Error('ALL IN 365 V2 Supabase public configuration is missing.');
}

export const supabase = createClient<Database>(supabaseUrl, supabasePublishableKey, {
  auth: {
    storage: globalThis.localStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    flowType: 'pkce',
  },
});

if (Platform.OS !== 'web') {
  if (AppState.currentState === 'active') supabase.auth.startAutoRefresh();
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}