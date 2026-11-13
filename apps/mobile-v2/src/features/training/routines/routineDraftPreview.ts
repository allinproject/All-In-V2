/**
 * ALL-246 athlete-owned, read-only routine review of the current editor draft.
 * No inferred paces, loads, training stress, calories or completed measurements.
 */
import {inspectRoutineDraft,type RoutineDraft} from './routineDraftEditor.ts';
export type RoutinePreviewRow={id:string;title:string;details:readonly string[]};
export type RoutineDraftPreview={
  ready:boolean;issues:readonly string[];name:string;sport:string;
  rows:readonly RoutinePreviewRow[];totalDurationSeconds:number|null;
};
export function projectRoutineDraftPreview(draft:RoutineDraft):RoutineDraftPreview{
 const review=inspectRoutineDraft(draft);
 if(!draft||!Array.isArray(draft.blocks))return{ready:false,issues:review.issues,name:'',
   sport:'',rows:[],totalDurationSeconds:null};
 let allIntervalsHaveDurations=draft.sport!=='strength'&&draft.blocks.length>0;
 let sum=0;
 const rows:RoutinePreviewRow[]=draft.blocks.map((block,i)=>{
  if(block.kind==='strength'){
   const details=[
    `${block.sets} ${block.setType} set${block.sets===1?'':'s'}`,
    ...(block.reps?.trim()?[ `Reps: ${block.reps.trim()}` ]:[]),
    ...(block.weight?.trim()?[ `Load: ${block.weight.trim()}` ]:[]),
    ...(block.restSeconds!==null?[ `Rest: ${block.restSeconds}s` ]:[]),
    ...(block.equipment?.trim()?[ `Equipment: ${block.equipment.trim()}` ]:[]),
    ...(block.groupId?.trim()?[ `Circuit: ${block.groupId.trim()}` ]:[]),
    ...(block.notes.trim()?[ `Notes: ${block.notes.trim()}` ]:[]),
   ];
   return {id:block.id,title:`${i+1}. ${block.exercise.trim()||'Unnamed exercise'}`,details};
  }
  if(block.durationSeconds===null)allIntervalsHaveDurations=false;
  else sum+=block.durationSeconds*block.repetitions;
  return {id:block.id,title:`${i+1}. ${block.phase.replaceAll('_',' ')} × ${block.repetitions}`,details:[
   ...(block.durationSeconds!==null?[`Duration: ${block.durationSeconds}s per repetition`]:[]),
   ...(block.distance!==null&&block.distanceUnit?[`Distance: ${block.distance} ${block.distanceUnit} per repetition`]:[]),
   ...(block.effort?.trim()?[`Effort: ${block.effort.trim()}`]:[]),
   ...(block.notes.trim()?[`Notes: ${block.notes.trim()}`]:[]),
  ]};
 });
 return {ready:review.ready,issues:review.issues,name:draft.name.trim(),sport:draft.sport,rows,
  totalDurationSeconds:allIntervalsHaveDurations&&review.ready?sum:null};
}
