/**
 * ALL-210 staging-only native acceptance guard.
 * Prevents internal Coach-read and staging-only Fuel backend builds from
 * accidentally targeting production or enabling paid-model send. Never handles privileged keys.
 */
const STAGING_URL='https://fbtgknlxjyeqrxemskbl.supabase.co';
export function assertCoachStagingBuildEnvironment(env){
 const routine=env.EXPO_PUBLIC_V2_ROUTINE_LOCAL_AUTH_ACCEPTANCE==='true';
 if(routine){
  const url=env.EXPO_PUBLIC_SUPABASE_URL?.trim().replace(/\/$/,'');
  if(url!=='http://127.0.0.1:54321'&&url!=='http://localhost:54321')
   throw Error('Saved Routine acceptance may ONLY target disposable local Supabase.');
  if(!env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim())
   throw Error('Saved Routine local acceptance requires an ephemeral local publishable key.');
 }
 const coach=env.EXPO_PUBLIC_V2_COACH_STAGING_ACCEPTANCE==='true';
 const fuel=env.EXPO_PUBLIC_V2_FUEL_DAY_READ_ENABLED==='true'
  || env.EXPO_PUBLIC_V2_FUEL_MANUAL_WRITE_ENABLED==='true';
 if(!coach&&!fuel)return;
 const url=env.EXPO_PUBLIC_SUPABASE_URL?.trim().replace(/\/$/,'');
 const key=env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
 // ALL-247 Food Log is physically installed only in the disposable staging
 // project. Enabling a client feature flag must never reach the canonical V2
 // project (or another project) before an independently approved promotion.
 if(fuel&&url!==STAGING_URL)throw Error('Fuel staging owner RPCs require the approved temporary Supabase project.');
 if(fuel&&!key)throw Error('Fuel staging owner RPCs require the staging publishable key.');
 if(!coach)return;
 if(url!==STAGING_URL)throw Error('Coach staging acceptance must target the approved temporary Supabase project.');
 if(!key)throw Error('Coach staging acceptance requires the staging publishable key from approved build configuration.');
 if(env.EXPO_PUBLIC_V2_COACH_READ_ENABLED!=='true')throw Error('Coach staging acceptance requires authenticated read enabled.');
 if(env.EXPO_PUBLIC_V2_COACH_SEND_ENABLED!=='false')throw Error('Coach staging acceptance must keep model sending explicitly disabled.');
}
