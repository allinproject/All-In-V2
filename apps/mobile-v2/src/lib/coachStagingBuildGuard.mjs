/**
 * ALL-210 staging-only native acceptance guard.
 * Prevents an internal Coach-read build from accidentally targeting production
 * or enabling the paid-model send path. Never handles privileged keys.
 */
const STAGING_URL='https://fbtgknlxjyeqrxemskbl.supabase.co';
export function assertCoachStagingBuildEnvironment(env){
 if(env.EXPO_PUBLIC_V2_COACH_STAGING_ACCEPTANCE!=='true')return;
 const url=env.EXPO_PUBLIC_SUPABASE_URL?.trim().replace(/\/$/,'');
 const key=env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
 if(url!==STAGING_URL)throw Error('Coach staging acceptance must target the approved temporary Supabase project.');
 if(!key)throw Error('Coach staging acceptance requires the staging publishable key from approved build configuration.');
 if(env.EXPO_PUBLIC_V2_COACH_READ_ENABLED!=='true')throw Error('Coach staging acceptance requires authenticated read enabled.');
 if(env.EXPO_PUBLIC_V2_COACH_SEND_ENABLED!=='false')throw Error('Coach staging acceptance must keep model sending explicitly disabled.');
}
