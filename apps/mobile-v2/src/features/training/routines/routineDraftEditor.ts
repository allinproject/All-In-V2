/**
 * ALL-246 reusable workout authoring. This is an ephemeral editor model, NOT
 * an accepted Training prescription, completed activity or persistent Routine.
 * A canonical owner service will later consume explicit, reviewed versions.
 */
import type {TrainingSport} from '../trainingPlanSynthesis.ts';

export type RoutineStrengthSetType='warmup'|'working'|'drop'|'failure';
export type RoutineStrengthBlock={
 kind:'strength';id:string;exercise:string;equipment:string|null;notes:string;
 sets:number;reps:string|null;weight:string|null;restSeconds:number|null;
 setType:RoutineStrengthSetType;groupId:string|null;
};
export type RoutineIntervalBlock={
 kind:'interval';id:string;phase:'warmup'|'work'|'recovery'|'cooldown';
 repetitions:number;durationSeconds:number|null;distance:number|null;
 distanceUnit:'meters'|'yards'|'kilometers'|'miles'|null;
 effort:string|null;notes:string;
};
export type RoutineBlock=RoutineStrengthBlock|RoutineIntervalBlock;
export type RoutineDraft={
 schemaVersion:1;id:null;sourceCompletionId:null;sourceRoutineVersion:null;
 name:string;sport:TrainingSport;notes:string;blocks:RoutineBlock[];
 nextId:number;version:number;status:'unsaved_draft';
};
const supportedSports=new Set<TrainingSport>(['strength','running','walking','cycling','swimming','hiking','rucking','rowing','elliptical','stair_stepper','yoga','mobility','other']);
const clean=(value:string,max=200)=>value.replace(/[\r\n\t]+/g,' ').trim().slice(0,max);
export function isStrengthRoutine(sport:TrainingSport){return sport==='strength';}
export function newRoutineDraft(sport:TrainingSport='strength'):RoutineDraft{
 if(!supportedSports.has(sport))throw new Error('Unsupported routine sport.');
 return {schemaVersion:1,id:null,sourceCompletionId:null,sourceRoutineVersion:null,name:'Untitled Routine',
  sport,notes:'',blocks:[],nextId:1,version:0,status:'unsaved_draft'};
}
export function renameRoutineDraft(draft:RoutineDraft,value:string):RoutineDraft{
 const name=clean(value,120);return name&&name!==draft.name?{...draft,name,version:draft.version+1}:draft;
}
export function changeRoutineSport(draft:RoutineDraft,sport:TrainingSport):RoutineDraft{
 if(!supportedSports.has(sport))return draft;
 if(sport===draft.sport)return draft;
 // Never reinterpret a strength set as a cycling interval or vice versa.
 return {...newRoutineDraft(sport),name:draft.name,notes:draft.notes,version:draft.version+1};
}
export function setRoutineNotes(draft:RoutineDraft,value:string):RoutineDraft{
 return {...draft,notes:clean(value,1000),version:draft.version+1};
}
export function addRoutineBlock(draft:RoutineDraft):RoutineDraft{
 if(draft.blocks.length>=60)return draft;
 const id='draft-'+draft.nextId;
 const block:RoutineBlock=isStrengthRoutine(draft.sport)
  ?{kind:'strength',id,exercise:'',equipment:null,notes:'',sets:1,reps:null,weight:null,
    restSeconds:null,setType:'working',groupId:null}
  :{kind:'interval',id,phase:'work',repetitions:1,durationSeconds:null,distance:null,
    distanceUnit:null,effort:null,notes:''};
 return {...draft,blocks:[...draft.blocks,block],nextId:draft.nextId+1,version:draft.version+1};
}
export function updateRoutineBlock(draft:RoutineDraft,block:RoutineBlock):RoutineDraft{
 if(!draft.blocks.some(row=>row.id===block.id)||(
   isStrengthRoutine(draft.sport)?block.kind!=='strength':block.kind!=='interval'))return draft;
 if(!validateBlock(block,false))return draft;
 return {...draft,version:draft.version+1,blocks:draft.blocks.map(row=>row.id===block.id?block:row)};
}
export function deleteRoutineBlock(draft:RoutineDraft,id:string):RoutineDraft{
 if(!draft.blocks.some(row=>row.id===id))return draft;
 return {...draft,blocks:draft.blocks.filter(row=>row.id!==id),version:draft.version+1};
}
export function moveRoutineBlock(draft:RoutineDraft,id:string,direction:-1|1):RoutineDraft{
 const old=draft.blocks.findIndex(row=>row.id===id),target=old+direction;
 if(old<0||target<0||target>=draft.blocks.length)return draft;
 const blocks=[...draft.blocks];[blocks[old],blocks[target]]=[blocks[target],blocks[old]];
 return {...draft,blocks,version:draft.version+1};
}
export function duplicateRoutineBlock(draft:RoutineDraft,id:string):RoutineDraft{
 if(draft.blocks.length>=60)return draft;
 const index=draft.blocks.findIndex(row=>row.id===id);if(index<0)return draft;
 const blocks=[...draft.blocks];
 blocks.splice(index+1,0,{...blocks[index],id:'draft-'+draft.nextId});
 return {...draft,blocks,nextId:draft.nextId+1,version:draft.version+1};
}
function validateBlock(block:RoutineBlock,requireContent:boolean):boolean{
 if(!block||!/^draft-[1-9]\d*$/.test(block.id)||typeof block.notes!=='string'||block.notes.length>1000)return false;
 if(block.kind==='strength')return (
  typeof block.exercise==='string'&&block.exercise.length<=150&&(!requireContent||!!block.exercise.trim())&&
  typeof block.sets==='number'&&Number.isInteger(block.sets)&&block.sets>=1&&block.sets<=20&&
  ['warmup','working','drop','failure'].includes(block.setType)&&
  (block.reps===null||typeof block.reps==='string'&&block.reps.length<=60)&&
  (block.weight===null||typeof block.weight==='string'&&block.weight.length<=60)&&
  (block.equipment===null||typeof block.equipment==='string'&&block.equipment.length<=100)&&
  (block.groupId===null||typeof block.groupId==='string'&&block.groupId.length<=80)&&
  (block.restSeconds===null||Number.isInteger(block.restSeconds)&&block.restSeconds>=0&&block.restSeconds<=3600));
 if(block.kind==='interval')return (
  ['warmup','work','recovery','cooldown'].includes(block.phase)&&
  Number.isInteger(block.repetitions)&&block.repetitions>=1&&block.repetitions<=100&&
  (block.durationSeconds===null||Number.isInteger(block.durationSeconds)&&block.durationSeconds>0&&block.durationSeconds<=86400)&&
  (block.distance===null||Number.isFinite(block.distance)&&block.distance>0&&block.distance<=500000)&&
  (block.distanceUnit===null||['meters','yards','kilometers','miles'].includes(block.distanceUnit))&&
  (block.effort===null||typeof block.effort==='string'&&block.effort.length<=100)&&
  (!requireContent||(block.durationSeconds!==null||(block.distance!==null&&block.distanceUnit!==null))));
 return false;
}
/** A readiness check is not a save command, does not infer sport targets,
 * and never uses a completed activity as a reusable prescription.
 */
export function inspectRoutineDraft(draft:RoutineDraft):{ready:boolean;issues:string[]}{
 const issues:string[]=[];
 if(!draft||draft.status!=='unsaved_draft'||draft.schemaVersion!==1||
  draft.id!==null||draft.sourceCompletionId!==null||draft.sourceRoutineVersion!==null||
  !supportedSports.has(draft.sport)||!draft.name?.trim()||draft.name.length>120||
  !Array.isArray(draft.blocks)||draft.blocks.length>60)return{ready:false,issues:['Invalid draft identity or structure.']};
 if(draft.blocks.length===0)issues.push('Add at least one exercise or interval.');
 const ids=new Set<string>();
 for(const row of draft.blocks){
  if(ids.has(row.id))issues.push('Duplicate block identity.');
  ids.add(row.id);
  if(row.kind!==(isStrengthRoutine(draft.sport)?'strength':'interval')||
    !validateBlock(row,true))issues.push('Complete the exercise or interval fields.');
 }
 return{ready:issues.length===0,issues:[...new Set(issues)]};
}
