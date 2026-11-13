/**
 * ALL-246 — review an approved, private Routine before a single workout.
 *
 * This is a pure client-side preview of owner-certified records. It cannot
 * authenticate, persist an updated Routine, accept a Training plan, or start a
 * workout. Those operations remain with existing canonical V2 owners.
 *
 * Coach suggestions are proposal-only and never replace the user's original.
 */
import {inspectRoutineDraft,newRoutineDraft,type RoutineBlock,type RoutineDraft} from './routineDraftEditor.ts';
import type {TrainingSport} from '../trainingPlanSynthesis.ts';
import {V2_ACTIVITY_SPORTS} from '../activityEntryContract.ts';

export type SavedRoutineOwnerSnapshot={
 identity:'canonical_saved_routine';
 routineId:string;ownerId:string;version:number;sessionGeneration:number;
 name:string;sport:TrainingSport;notes:string;
 /** Complete, owner-verified structure for this exact immutable version. */
 complete:true;blocks:readonly RoutineBlock[];
};
export type CoachRoutineSuggestion={
 identity:'coach_routine_proposal_only';
 proposalId:string;ownerId:string;sessionGeneration:number;
 routineId:string;routineVersion:number;
 /** Evidence owner is responsible for actual training context and provenance. */
 evidenceRefs:readonly string[];
 rationale:string;
 blockId:string;
 replacement:RoutineBlock;
};
export type RoutineWorkoutReview={
 identity:'session_only_routine_preview';
 ownerId:string;sessionGeneration:number;
 routineId:string;routineVersion:number;
 original:RoutineDraft;
 sessionDraft:RoutineDraft;
 /** Owner-certified block identity mapped to private, local editor identity. */
 blockMapping:readonly {sourceBlockId:string;draftBlockId:string}[];
 suggestion:CoachRoutineSuggestion|null;
 suggestionStatus:'none'|'proposed'|'kept_original'|'applied_for_session';
 sourceComplete:true;
 /** Always false: invoking this pure adapter is never an accepted Training write. */
 planMutation:false;
};
const id=(v:unknown)=>typeof v==='string'&&v.length>0&&v.length<=150&&/^[a-zA-Z0-9_:.\-]+$/.test(v);
const revision=(v:unknown)=>Number.isSafeInteger(v)&&Number(v)>0;
const generation=(v:unknown)=>Number.isSafeInteger(v)&&Number(v)>=0;
const clone=<T>(v:T):T=>JSON.parse(JSON.stringify(v)) as T;
const allowed=new Set<string>(V2_ACTIVITY_SPORTS);
function draftFromSnapshot(snapshot:SavedRoutineOwnerSnapshot):
 {draft:RoutineDraft;mapping:{sourceBlockId:string;draftBlockId:string}[]}|null{
 const local=newRoutineDraft(snapshot.sport);
 const sourceIds=new Set<string>();
 const mapping:{sourceBlockId:string;draftBlockId:string}[]=[];
 const blocks:RoutineBlock[]=snapshot.blocks.map((block,i)=>{
  if(!block||!id(block.id)||sourceIds.has(block.id))throw new Error('Invalid source block');
  sourceIds.add(block.id);
  const draftBlockId='draft-'+(i+1);
  mapping.push({sourceBlockId:block.id,draftBlockId});
  return {...clone(block),id:draftBlockId};
 });
 const draft:RoutineDraft={...local,name:snapshot.name,notes:snapshot.notes,
  blocks,nextId:blocks.length+1,version:0};
 return inspectRoutineDraft(draft).ready?{draft,mapping}:null;
}
/** The supplied identity must come from the authenticated canonical owner reader.
 * A supplied snapshot alone does not prove that such a reader exists.
 */
export function openOwnedRoutineWorkoutReview(
 snapshot:SavedRoutineOwnerSnapshot,ownerId:string,sessionGeneration:number,
):RoutineWorkoutReview|null{
 if(!snapshot||snapshot.identity!=='canonical_saved_routine'||snapshot.complete!==true||
    !id(ownerId)||snapshot.ownerId!==ownerId||!id(snapshot.routineId)||
    !revision(snapshot.version)||!generation(sessionGeneration)||
    snapshot.sessionGeneration!==sessionGeneration||
    !allowed.has(snapshot.sport)||typeof snapshot.name!=='string'||!snapshot.name.trim()||
    snapshot.name.length>120||typeof snapshot.notes!=='string'||snapshot.notes.length>1000||
    !Array.isArray(snapshot.blocks)||snapshot.blocks.length===0||snapshot.blocks.length>60)return null;
 let converted:ReturnType<typeof draftFromSnapshot>=null;
 // A typed owner DTO may still be malformed on the wire. Treat it as
 // unavailable, never as a confirmed session or a reason to write anything.
 try{converted=draftFromSnapshot(snapshot);}catch{return null;}
 if(!converted)return null;
 const {draft:original,mapping}=converted;
 return {identity:'session_only_routine_preview',ownerId,sessionGeneration,
   routineId:snapshot.routineId,routineVersion:snapshot.version,
   original,sessionDraft:clone(original),blockMapping:mapping,
   suggestion:null,suggestionStatus:'none',
   sourceComplete:true,planMutation:false};
}
export function reviewCoachRoutineSuggestion(
 review:RoutineWorkoutReview,proposal:CoachRoutineSuggestion,
 currentOwnerId:string,currentGeneration:number,
):RoutineWorkoutReview{
 if(!review||!proposal||review.ownerId!==currentOwnerId||
    !generation(currentGeneration)||currentGeneration!==review.sessionGeneration||
    proposal.identity!=='coach_routine_proposal_only'||
    proposal.ownerId!==review.ownerId||proposal.sessionGeneration!==review.sessionGeneration||
    proposal.routineId!==review.routineId||proposal.routineVersion!==review.routineVersion||
    !id(proposal.proposalId)||!id(proposal.blockId)||
    typeof proposal.rationale!=='string'||!proposal.rationale.trim()||proposal.rationale.length>500||
    !Array.isArray(proposal.evidenceRefs)||proposal.evidenceRefs.length===0||
    proposal.evidenceRefs.length>30||!proposal.evidenceRefs.every(id))return review;
 const mapped=review.blockMapping.find(b=>b.sourceBlockId===proposal.blockId);
 const originalBlock=review.original.blocks.find(b=>b.id===mapped?.draftBlockId);
 if(!mapped||!originalBlock||!proposal.replacement||
    proposal.replacement.id!==proposal.blockId||
    proposal.replacement.kind!==originalBlock.kind)return review;
 // Explicitly retain local editor ID and reject invalid or unchanged content.
 const replacement={...clone(proposal.replacement),id:mapped.draftBlockId};
 const sessionDraft={...clone(review.original),
  blocks:review.original.blocks.map(b=>b.id===mapped.draftBlockId?replacement:clone(b))};
 if(!inspectRoutineDraft(sessionDraft).ready||
   JSON.stringify(originalBlock)===JSON.stringify(replacement))return review;
 return {...review,suggestion:clone(proposal),suggestionStatus:'proposed',
   sessionDraft:clone(review.original)};
}
/** Keep Original is a real, explicit user choice. Never modify original. */
export function keepOriginalRoutineWorkout(review:RoutineWorkoutReview):RoutineWorkoutReview{
 return {...review,sessionDraft:clone(review.original),
  suggestionStatus:review.suggestion?'kept_original':'none'};
}
/** Apply Change affects a disposable session preview only, never the saved routine. */
export function applyCoachChangeForSession(
 review:RoutineWorkoutReview,currentOwnerId:string,currentGeneration:number,
):RoutineWorkoutReview{
 const p=review?.suggestion;
 if(!p||review.suggestionStatus!=='proposed'||review.ownerId!==currentOwnerId||
   currentGeneration!==review.sessionGeneration||
   p.ownerId!==review.ownerId||p.sessionGeneration!==review.sessionGeneration||
   p.routineVersion!==review.routineVersion)return review;
 const mapped=review.blockMapping.find(b=>b.sourceBlockId===p.blockId);
 if(!mapped||!p.replacement||p.replacement.id!==p.blockId)return review;
 const updated={...clone(review.original),
  blocks:review.original.blocks.map(b=>b.id===mapped.draftBlockId
   ?{...clone(p.replacement),id:mapped.draftBlockId}:clone(b))};
 if(!inspectRoutineDraft(updated).ready)return review;
 return {...review,sessionDraft:updated,suggestionStatus:'applied_for_session'};
}
