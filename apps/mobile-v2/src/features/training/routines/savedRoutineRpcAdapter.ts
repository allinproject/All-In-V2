/**
 * ALL-246 staged read-only adapter for the canonical Saved Routine owner.
 *
 * Source-only until the explicit ALL-222 RPC grant, staging two-user
 * acceptance and privacy lifecycle gates pass. No direct table operations,
 * service-role client key, mock records, or fallback to V1.
 */
import type {SavedRoutineReadServices,SavedRoutineListPage} from './savedRoutineOwnerReader';
import type {SavedRoutineOwnerSnapshot} from './routineWorkoutReview';

export type OwnerAuthTransport={
 auth:{
  getUser:()=>Promise<{data:{user:{id:string}|null};error:unknown}>;
  getSession:()=>Promise<{data:{session:{user:{id:string};expires_at?:number}|null};error:unknown}>;
 };
 rpc:(name:string,args:Record<string,unknown>)=>Promise<{data:unknown;error:unknown}>;
};
const ID=/^[a-z0-9_:.-]{1,150}$/i;
const validId=(v:unknown):v is string=>typeof v==='string'&&ID.test(v);
const isObject=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
export type RoutineRpcAuthIdentity={
 ownerId:string;sessionGeneration:number;
 /** Current auth context, NOT a cached initial owner or a caller-created token. */
 isCurrent:()=>boolean;
};
export function createStagedSavedRoutineReadServices(
 transport:OwnerAuthTransport,identity:RoutineRpcAuthIdentity
):SavedRoutineReadServices{
 const assertOwner=async(ownerId:string,generation:number)=>{
  if(!validId(ownerId)||identity.ownerId!==ownerId||
     identity.sessionGeneration!==generation||!identity.isCurrent())throw Error('Stale Routine owner');
  const session=await transport.auth.getSession();
  if(session.error||session.data.session?.user.id!==ownerId||
    (session.data.session.expires_at!==undefined&&
      session.data.session.expires_at<=Math.floor(Date.now()/1000)))throw Error('Routine session unavailable');
  const actor=await transport.auth.getUser();
  if(actor.error||actor.data.user?.id!==ownerId||!identity.isCurrent())
   throw Error('Routine authenticated owner unavailable');
 };
 const call=async(name:string,args:Record<string,unknown>)=>{
  await assertOwner(identity.ownerId,identity.sessionGeneration);
  const result=await transport.rpc(name,args);
  if(result.error)throw Error('Routine owner RPC unavailable');
  await assertOwner(identity.ownerId,identity.sessionGeneration);
  return result.data;
 };
 return {
  authenticateOwner:assertOwner,
  readListPage:async({expectedOwnerId,sessionGeneration,cursor,limit})=>{
   if(!validId(expectedOwnerId)||sessionGeneration!==identity.sessionGeneration||
      (cursor!==null&&!validId(cursor))||!Number.isSafeInteger(limit)||limit<1||limit>100)
    throw Error('Invalid Routine page');
   const data=await call('v2_training_routine_list_owner_candidate',{
    p_expected_user_id:expectedOwnerId,p_session_generation:sessionGeneration,
    p_cursor:cursor,p_limit:limit,
   });
   if(!isObject(data)||!Array.isArray(data.records)||
     data.expectedOwnerId!==expectedOwnerId||data.sessionGeneration!==sessionGeneration)
    throw Error('Invalid Routine page from server');
   return data as SavedRoutineListPage;
  },
  readVersion:async({expectedOwnerId,sessionGeneration,routineId,version})=>{
   if(!validId(expectedOwnerId)||!validId(routineId)||!Number.isSafeInteger(version)||version<1)
    throw Error('Invalid Routine version request');
   const data=await call('v2_training_routine_read_owner_candidate',{
    p_expected_user_id:expectedOwnerId,p_session_generation:sessionGeneration,
    p_routine_id:routineId,p_version:version,
   });
   if(data===null)return null;
   if(!isObject(data)||data.identity!=='canonical_saved_routine'||
      data.ownerId!==expectedOwnerId||data.sessionGeneration!==sessionGeneration||
      data.routineId!==routineId||data.version!==version||data.complete!==true||
      !Array.isArray(data.blocks))throw Error('Invalid Routine version from server');
   return data as SavedRoutineOwnerSnapshot;
  },
 };
}
