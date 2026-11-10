import {normalize} from './core.ts';

const SHOE_TERMS=/\b(shoe|shoes|footwear|sneaker|sneakers|running shoe|running shoes|shoe rotation)\b/;
const RESEARCH_TERMS=/\b(research|search|look up|lookup|find me|current options|current models|new shoes?|shoe options|replacement shoes?|buy shoes?|shopping for shoes?)\b/;

function primaryUserMessage(value:string){return String(value||'').split(/\n\nALL IN /i,1)[0]??'';}
export function shoeGearRelevant(message:string){return SHOE_TERMS.test(normalize(primaryUserMessage(message)));}
export function explicitShoeResearchRequest(message:string){const text=normalize(primaryUserMessage(message));return SHOE_TERMS.test(text)&&RESEARCH_TERMS.test(text);}

export async function addShoeGearContext(client:any,message:string,base:any){
  if(!shoeGearRelevant(message))return base;
  try{
    const [gearResult,historyResult]=await Promise.all([
      client.rpc('allin_my_gear'),
      client.rpc('allin_my_shoe_run_history',{p_limit:40}),
    ]);
    if(gearResult.error||historyResult.error)return base;
    const active=compactShoes(gearResult.data?.active,false),retired=compactShoes(gearResult.data?.retired,true);
    const runs=(Array.isArray(historyResult.data?.runs)?historyResult.data.runs:[]).slice(0,40).map(compactRun).filter(Boolean);
    return {...base,shoe_gear_context:{
      source:'canonical_gear_and_training',
      active_shoes:active,
      retired_shoes:retired,
      recent_shoe_run_history:runs,
      history_limit:Number(historyResult.data?.bounded_limit)||40,
      guardrails:[
        'Saved recommended mileage is user-reviewed canonical Gear data; null means unknown.',
        'Mileage reminder is a separate user alert and must not replace the saved recommended range.',
        'Current mileage and run history come from canonical assigned-workout mileage contributions.',
        'Purchase date and calendar age are not shoe lifecycle signals and are not supplied to Coach.',
        'Mileage thresholds trigger review/inspection and user feedback, never automatic retirement or injury-prevention claims.',
        'Never silently assign, buy, retire, restore, or change a shoe. Durable changes require explicit user action through the owning Gear/Training writer.',
        'Do not re-research a saved recommended range unless the user explicitly asks to research or refresh it.',
      ],
    }};
  }catch{return base;}
}

function compactShoes(value:any,retired:boolean){return (Array.isArray(value)?value:[]).filter((row:any)=>String(row?.gear_type)==='shoes').slice(0,30).map((row:any)=>({
  id:String(row?.id||''),name:text(row?.name),brand:text(row?.brand),model:text(row?.model),retired,
  current_miles:num(row?.current_miles),mileage_reminder_miles:num(row?.mileage_reminder_miles),recommended_miles_min:num(row?.recommended_miles_min),recommended_miles_max:num(row?.recommended_miles_max),
  assigned_workouts:int(row?.assigned_workouts),last_used_on:date(row?.last_used_on),shoe_roles:Array.isArray(row?.shoe_roles)?row.shoe_roles.slice(0,8):[],preserve_for_races:typeof row?.preserve_for_races==='boolean'?row.preserve_for_races:null,shoe_notes:text(row?.shoe_notes),version:int(row?.version),
})).filter((row:any)=>row.id);}
function compactRun(row:any){const workoutId=String(row?.workout_id||''),shoeId=String(row?.shoe_id||'');if(!workoutId||!shoeId)return null;return {workout_id:workoutId,record_date:date(row?.record_date),title:text(row?.title),activity_type:text(row?.activity_type),distance_miles:num(row?.distance_miles),shoe_id:shoeId,shoe_name:text(row?.shoe_name),shoe_brand:text(row?.shoe_brand),shoe_model:text(row?.shoe_model)};}
function text(value:any){const v=String(value??'').trim();return v||null;}
function num(value:any){if(value===null||value===undefined||value==='')return null;const n=Number(value);return Number.isFinite(n)?n:null;}
function int(value:any){const n=Number(value);return Number.isInteger(n)&&n>=0?n:null;}
function date(value:any){const v=String(value??'').trim();return /^\d{4}-\d{2}-\d{2}$/.test(v)?v:null;}
