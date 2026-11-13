/**
 * ALL-246 / ALL-243: a source-backed preview for "Save as Routine".
 *
 * A completed activity is immutable historical evidence. This adapter never
 * writes it, produces no save command, and refuses to infer future targets
 * from measured performance. A separately authorized owner reader must supply
 * the versioned structures; the generic Completed Activity detail sections
 * expose only counts, not enough to invent a reusable workout.
 */
import type {TrainingSport} from '../trainingPlanSynthesis.ts';
import {V2_ACTIVITY_SPORTS} from '../activityEntryContract.ts';
import {
  addRoutineBlock,inspectRoutineDraft,newRoutineDraft,renameRoutineDraft,
  updateRoutineBlock,type RoutineDraft,type RoutineStrengthBlock,type RoutineIntervalBlock,
} from './routineDraftEditor.ts';

export type ConfirmedRoutineSource={
  activityId:string;
  activityVersion:number;
  ownerId:string;
  sport:TrainingSport;
  title:string;
  /** A source-backed certified version of the structured read. */
  structuredEvidenceVersion:number;
  /** True only when the owner reader returned all approved pages, not an empty placeholder. */
  complete:boolean;
  /** A workout structure explicitly prescribed before completion, not measured outcome. */
  prescribedBlocks:readonly (
    | {kind:'strength';sourceBlockId:string;exercise:string;sets:number;reps:string|null;
        weight:string|null;restSeconds:number|null;equipment:string|null;
        notes:string;setType:RoutineStrengthBlock['setType'];groupId:string|null}
    | {kind:'interval';sourceBlockId:string;phase:RoutineIntervalBlock['phase'];
        repetitions:number;durationSeconds:number|null;distance:number|null;
        distanceUnit:RoutineIntervalBlock['distanceUnit'];effort:string|null;notes:string}
  )[];
  /** Source tells us there were blocks, but not necessarily prescribed targets. */
  actualStructureCount:number;
};
export type RoutineConversionPreview={
  status:'ready_for_athlete_review'|'requires_manual_review';
  source:{activityId:string;activityVersion:number;structuredEvidenceVersion:number};
  draft:RoutineDraft;
  /** Source IDs remain review-only evidence and never become completion claims in a routine. */
  blockLineage:readonly {draftBlockId:string;sourceBlockId:string}[];
  excludedBlocks:number;
  notes:readonly string[];
};

const allowed=new Set<string>(V2_ACTIVITY_SPORTS);
const validId=(x:unknown)=>typeof x==='string'&&x.length>0&&x.length<=150&&/^[\w:.-]+$/.test(x);
const validInt=(x:unknown)=>Number.isSafeInteger(x)&&Number(x)>0;

/** Does NOT accept the display-only CompletedActivityScreenInput: its list of
 * "strength_sets"/"intervals" sections has no certified prescriptions.
 * No current V2 backend writer is authorized to persist this preview.
 */
export function prepareCompletedActivityRoutinePreview(
 source:ConfirmedRoutineSource,expectedOwner:string,
):RoutineConversionPreview|null{
 if(!source||!validId(expectedOwner)||source.ownerId!==expectedOwner||
    !validId(source.activityId)||!validInt(source.activityVersion)||
    !validInt(source.structuredEvidenceVersion)||!source.complete||
    !allowed.has(source.sport)||typeof source.title!=='string'||
    !source.title.trim()||source.title.length>120||
    !Array.isArray(source.prescribedBlocks)||source.prescribedBlocks.length>60||
    !Number.isSafeInteger(source.actualStructureCount)||source.actualStructureCount<0||
    source.actualStructureCount<source.prescribedBlocks.length)return null;
 const sourceIds=new Set<string>();
 const blockLineage:{draftBlockId:string;sourceBlockId:string}[]=[];
 let draft=renameRoutineDraft(newRoutineDraft(source.sport),source.title);
 let excluded=source.actualStructureCount-source.prescribedBlocks.length;
 const notes:string[]=[];
 for(const b of source.prescribedBlocks){
  if(!b||!validId(b.sourceBlockId)||sourceIds.has(b.sourceBlockId))return null;
  sourceIds.add(b.sourceBlockId);
  // Untrusted, unsupported or incomplete prescriptions must be reviewed in
  // the existing builder, not silently guessed from measured sets/splits.
  if((source.sport==='strength')!==(b.kind==='strength')){
   excluded++;continue;
  }
  const previous=draft;
  draft=addRoutineBlock(draft);
  const target=draft.blocks.at(-1)!;
  const candidate=b.kind==='strength'&&target.kind==='strength'
   ?{...target,exercise:b.exercise,sets:b.sets,reps:b.reps,weight:b.weight,
       restSeconds:b.restSeconds,equipment:b.equipment,notes:b.notes,
       setType:b.setType,groupId:b.groupId}
   :b.kind==='interval'&&target.kind==='interval'
   ?{...target,phase:b.phase,repetitions:b.repetitions,
       durationSeconds:b.durationSeconds,distance:b.distance,
       distanceUnit:b.distanceUnit,effort:b.effort,notes:b.notes}
   :null;
  if(!candidate){draft=previous;excluded++;continue;}
  const proposed=updateRoutineBlock(draft,candidate);
  if(proposed===draft){draft=previous;excluded++;continue;}
  draft=proposed;
  blockLineage.push({draftBlockId:target.id,sourceBlockId:b.sourceBlockId});
 }
 if(excluded)notes.push(`${excluded} recorded block(s) had no reusable, verified prescription and were not copied.`);
 if(!draft.blocks.length)notes.push('No complete pre-workout prescriptions were provided. Build a routine manually rather than treating performance measurements as targets.');
 if(!inspectRoutineDraft(draft).ready)notes.push('Review incomplete prescription fields before any future save.');
 return {
  status:excluded===0&&inspectRoutineDraft(draft).ready?'ready_for_athlete_review':'requires_manual_review',
  source:{activityId:source.activityId,activityVersion:source.activityVersion,
    structuredEvidenceVersion:source.structuredEvidenceVersion},
  draft,blockLineage,excludedBlocks:excluded,notes,
 };
}
