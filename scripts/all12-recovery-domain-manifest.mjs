// ALL-12: recovery scope is explicit; missing domains never silently count as backed up.
// No database access or secrets. Used to gate future full logical dump/restore tests.
export const recoveryDomains=Object.freeze([
 {name:'auth',tables:['auth.users','auth.identities','auth.sessions','auth.refresh_tokens'],kind:'database'},
 {name:'profile_legal',tables:['public.v2_profiles'],kind:'database'},
 {name:'training',tables:['public.v2_training_session_instances'],kind:'database'},
 {name:'completed_activity',tables:['public.v2_completed_activities','public.v2_activity_sources'],kind:'database'},
 {name:'coach',tables:['public.v2_coach_threads','public.v2_coach_messages'],kind:'database'},
 {name:'goals',tables:['public.v2_goals','public.v2_goal_revisions'],kind:'database'},
 {name:'billing',tables:['allin_private.v2_subscription_purchases','allin_private.v2_subscription_verified_events'],kind:'database'},
 {name:'community',tables:[],kind:'pending_schema'},
 {name:'nutrition',tables:[],kind:'pending_schema'},
 {name:'progress_recovery',tables:[],kind:'pending_schema'},
 {name:'eventhub',tables:[],kind:'pending_schema'},
 {name:'private_media',tables:[],kind:'storage'},
 {name:'auth_configuration',tables:[],kind:'configuration'}
]);
export function assessRecoveryCoverage({presentTables=[],verifiedTables=[],verifiedExternal=[],actualTables=[]}={}){
 const present=new Set(presentTables),verified=new Set(verifiedTables),external=new Set(verifiedExternal);
 const result=recoveryDomains.map(domain=>{
  const absent=domain.tables.filter(t=>!present.has(t));
  const unverified=domain.tables.filter(t=>present.has(t)&&!verified.has(t));
  const status=domain.kind==='pending_schema'?'unverified':domain.kind!=='database'?(external.has(domain.name)?'verified':'unverified'):
    absent.length?'absent':unverified.length?'unverified':'verified';
  return {name:domain.name,status,absent,unverified};
 });
 const untrackedTables=findUntrackedRecoveryTables(actualTables);
 return {complete:untrackedTables.length===0 && result.every(d=>d.status==='verified'),domains:result,untrackedTables};
}
