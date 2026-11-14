/**
 * ALL-246 candidate authenticated Routine writer. This is deliberately NOT
 * mounted in Train until real Supabase Auth/RLS, ALL-222 grants and ALL-251
 * lifecycle acceptance. Never call on initial render, Coach proposal arrival
 * or silent background synchronization. Athlete action is mandatory.
 */
import {inspectRoutineDraft,type RoutineDraft} from './routineDraftEditor.ts';
import type {OwnerAuthTransport,RoutineRpcAuthIdentity} from './savedRoutineRpcAdapter';
import type {SavedRoutineReadServices} from './savedRoutineOwnerReader';

export type SavedRoutineMutationReceipt={
 routineId:string;version:number;replayed:boolean;
};
export type SavedRoutineArchiveReceipt=SavedRoutineMutationReceipt&{archived:true};
export type SavedRoutineMutationServices={
 saveFromUserAction:(request:{
  expectedOwnerId:string;sessionGeneration:number;routineId:string|null;
  expectedVersion:number;actionId:string;draft:RoutineDraft;
 })=>Promise<SavedRoutineMutationReceipt>;
 archiveFromUserAction:(request:{
  expectedOwnerId:string;sessionGeneration:number;routineId:string;
  expectedVersion:number;actionId:string;
 })=>Promise<SavedRoutineArchiveReceipt>;
};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isUuid=(value:unknown):value is string=>typeof value==='string'&&UUID.test(value);
const positive=(value:unknown):value is number=>Number.isSafeInteger(value)&&Number(value)>0;
const validReceipt=(v:unknown):v is SavedRoutineMutationReceipt=>
 !!v&&typeof v==='object'&&isUuid((v as SavedRoutineMutationReceipt).routineId)&&
 positive((v as SavedRoutineMutationReceipt).version)&&
 typeof (v as SavedRoutineMutationReceipt).replayed==='boolean';
export function createStagedSavedRoutineMutationServices(
 transport:OwnerAuthTransport,identity:RoutineRpcAuthIdentity,
 ownerReader:SavedRoutineReadServices,
):SavedRoutineMutationServices{
 const auth=async(ownerId:string,generation:number)=>{
  if(identity.ownerId!==ownerId||identity.sessionGeneration!==generation||
     !identity.isCurrent())throw Error('Stale Routine owner');
  await ownerReader.authenticateOwner(ownerId,generation);
 };
 const write=async(name:string,ownerId:string,generation:number,args:Record<string,unknown>)=>{
  await auth(ownerId,generation);
  const result=await transport.rpc(name,args);
  if(result.error)throw Error('Saved Routine mutation rejected by owner');
  await auth(ownerId,generation);
  return result.data;
 };
 return {
  saveFromUserAction:async req=>{
   if(!isUuid(req.actionId)||(req.routineId!==null&&!isUuid(req.routineId))||
     !Number.isSafeInteger(req.expectedVersion)||req.expectedVersion<0||
     (req.routineId===null)!==(req.expectedVersion===0))
    throw Error('Invalid Routine create/update identity');
   const inspection=inspectRoutineDraft(req.draft);
   if(!inspection.ready)throw Error('Incomplete Routine draft');
   const response=await write('v2_training_routine_save_owner_candidate',
    req.expectedOwnerId,req.sessionGeneration,{
     p_expected_user_id:req.expectedOwnerId,p_routine_id:req.routineId,
     p_expected_version:req.expectedVersion,p_action_id:req.actionId,
     p_name:req.draft.name,p_sport:req.draft.sport,p_notes:req.draft.notes,
     p_blocks:req.draft.blocks,
    });
   if(!validReceipt(response)||response.version!==req.expectedVersion+1)
    throw Error('Invalid Routine write receipt');
   if(req.routineId!==null&&response.routineId!==req.routineId)
    throw Error('Routine identity changed');
   return response;
  },
  archiveFromUserAction:async req=>{
   if(!isUuid(req.routineId)||!isUuid(req.actionId)||!positive(req.expectedVersion))
    throw Error('Invalid Routine archive request');
   const response=await write('v2_training_routine_archive_owner_candidate',
    req.expectedOwnerId,req.sessionGeneration,{
     p_expected_user_id:req.expectedOwnerId,p_routine_id:req.routineId,
     p_expected_version:req.expectedVersion,p_action_id:req.actionId,
    });
   if(!validReceipt(response)||response.routineId!==req.routineId||
      response.version!==req.expectedVersion||
      (response as SavedRoutineArchiveReceipt).archived!==true)
    throw Error('Invalid Routine archive receipt');
   return response as SavedRoutineArchiveReceipt;
  },
 };
}
