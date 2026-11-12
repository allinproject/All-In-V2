/**
 * ALL-208: fail-closed preflight for an actual signed V2 iPhone build.
 * No Apple/EAS login, network call, build or deployment is performed.
 */
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const bundle=/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;
const target='https://xarhuczrtzuiljmtdaeu.supabase.co';
const requiredProfiles=['founder-ios-device','founder-ios-testflight'];

export function verifyFounderIosBuild({config,appConfig,env={},configOnly=false}){
 const errors=[];
 if(!config||!config.build||config.cli?.appVersionSource!=='local')
  errors.push('EAS build profiles and local version source are required.');
 for(const profile of requiredProfiles){
  const p=config?.build?.[profile];
  if(!p||p.ios?.simulator!==false||p.credentialsSource!=='remote'||
     p.distribution!==(profile.endsWith('device')?'internal':'store')||
     p.autoSubmit===true)
   errors.push('Invalid explicit signed iOS profile: '+profile);
 }
 if(config?.submit&&Object.keys(config.submit).length>0)
  errors.push('Founder build configuration must not include auto-submit settings.');
 if(typeof appConfig!=='string'||!appConfig.includes("ALLIN_V2_IOS_BUNDLE_ID")||
    !appConfig.includes("ALLIN_V2_EAS_PROJECT_ID")||
    !appConfig.includes('allin365v2'))
  errors.push('V2 Expo identity and deep-link scheme must remain explicit.');
 if(!configOnly){
  const bundleId=env.ALLIN_V2_IOS_BUNDLE_ID?.trim();
  const projectId=env.ALLIN_V2_EAS_PROJECT_ID?.trim();
  const key=env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if(!bundleId||!bundle.test(bundleId)||bundleId.length>180)
   errors.push('Set the verified V2 Apple bundle ID (ALLIN_V2_IOS_BUNDLE_ID).');
  if(!projectId||!uuid.test(projectId))
   errors.push('Set the verified V2 Expo EAS project UUID (ALLIN_V2_EAS_PROJECT_ID).');
  if(env.EXPO_PUBLIC_SUPABASE_URL?.trim()!==target)
   errors.push('Use only the canonical V2 Supabase URL for the founder build.');
  if(!key||key.length<20||/placeholder|your_|example|test[_-]?key/i.test(key))
   errors.push('Set the real V2 Supabase publishable key (never the service-role key).');
  if(Object.keys(env).some(k=>k.startsWith('EXPO_PUBLIC_')&&
    /SERVICE_ROLE|SECRET|PRIVATE_KEY|STRIPE_SECRET|APPLE_PRIVATE/i.test(k)))
   errors.push('Privileged secrets may not use EXPO_PUBLIC_ prefixes.');
 }
 return errors;
}
export function main(argv=process.argv.slice(2),env=process.env){
 const allowed=['--config-only','--device','--testflight'];
 if(argv.length!==1||!allowed.includes(argv[0])){
  throw new Error('Usage: node scripts/check-v2-founder-ios-build.mjs --config-only | --device | --testflight');
 }
 const config=JSON.parse(readFileSync(root+'apps/mobile-v2/eas.json','utf8'));
 const appConfig=readFileSync(root+'apps/mobile-v2/app.config.ts','utf8');
 const failures=verifyFounderIosBuild({
  config,appConfig,env,configOnly:argv[0]==='--config-only'
 });
 if(failures.length)throw new Error(failures.map(x=>'• '+x).join('\n'));
 return argv[0]==='--config-only'
  ? 'PASS founder iOS build profiles are explicit and cannot auto-submit'
  : 'PASS signed iPhone build configuration preflight; this does not verify credentials or produce a binary';
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
 try{console.log(main())}catch(e){console.error(String(e.message??e));process.exitCode=1}
}
