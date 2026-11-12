// ALL-12: recovery scope is explicit; missing domains never silently count as backed up.
// No database access or secrets. Used to gate future full logical dump/restore tests.
export const recoveryDomains=Object.freeze([
 {name:'auth',tables:['auth.users','auth.identities'],kind:'database'},
 {name:'profile_legal',tables:['public.v2_profiles'],kind:'database'},
 {name:'training',tables:['public.v2_training_session_instances'],kind:'database'},
 {name:'completed_activity',tables:['public.v2_completed_activities','public.v2_activity_sources'],kind:'database'},
 {name:'coach',tables:['public.v2_coach_threads'],kind:'database'},
 {name:'billing',tables:['allin_private.v2_subscription_purchases','allin_private.v2_subscription_verified_events'],kind:'database'},
 {name:'private_media',tables:[],kind:'storage'},
 {name:'auth_configuration',tables:[],kind:'configuration'}
]);
export function assessRecoveryCoverage({presentTables=[],verifiedTables=[],verifiedExternal=[]}={}){
 const present=new Set(presentTables),verified=new Set(verifiedTables),external=new Set(verifiedExternal);
 const result=recoveryDomains.map(domain=>{
  const absent=domain.tables.filter(t=>!present.has(t));
  const unverified=domain.tables.filter(t=>present.has(t)&&!verified.has(t));
  const status=domain.kind!=='database'?(external.has(domain.name)?'verified':'unverified'):
    absent.length?'absent':unverified.length?'unverified':'verified';
  return {name:domain.name,status,absent,unverified};
 });
 return {complete:result.every(d=>d.status==='verified'),domains:result};
}
