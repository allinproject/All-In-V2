import type {Route} from './core.ts';
import {normalize} from './core.ts';

export type KitchenCapabilityAvailability='available'|'unavailable'|'unknown';
export type KitchenCapabilityScope='home_kitchen'|'work_reheat';
export type KitchenCapabilityFact={
 id:string;
 label:string;
 availability:KitchenCapabilityAvailability;
 scope:KitchenCapabilityScope;
 source:'profile_settings.kitchen_equipment'|'profile_settings.work_reheat_equipment';
};
export type KitchenCapabilityConstraints={burner_count:number|null;skillet_count:number|null;container_count:number|null;notes:string|null};
export type KitchenCapabilityContext={
 version:'kitchen_capability_context_v1';
 facts:KitchenCapabilityFact[];
 constraints:KitchenCapabilityConstraints;
 guardrails:string[];
};

function cleanLabel(value:unknown):string|null{if(typeof value!=='string')return null;const label=value.replace(/[\r\n\t]+/g,' ').trim().slice(0,80);return label||null;}
function idFor(label:string){return label.toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,80);}
function availability(value:unknown):KitchenCapabilityAvailability|null{if(value===true)return'available';if(value===false)return'unavailable';if(typeof value!=='string')return null;const normalized=value.trim().toLowerCase();if(['available','yes','have','owned','supported'].includes(normalized))return'available';if(['unavailable','no','none','missing','not_owned','not owned'].includes(normalized))return'unavailable';if(['unknown','unsure','not_sure','not sure'].includes(normalized))return'unknown';return null;}
function cleanCount(value:unknown):number|null{return typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<=99?value:null;}
function cleanNotes(value:unknown):string|null{if(typeof value!=='string')return null;const text=value.replace(/[\r\n\t]+/g,' ').trim().slice(0,500);return text||null;}
function pushFact(out:KitchenCapabilityFact[],seen:Set<string>,scope:KitchenCapabilityScope,source:KitchenCapabilityFact['source'],label:string,status:KitchenCapabilityAvailability){const id=idFor(label);if(!id)return;const key=`${scope}:${id}`;if(seen.has(key))return;seen.add(key);out.push({id,label,availability:status,scope,source});}
function collect(value:unknown,scope:KitchenCapabilityScope,source:KitchenCapabilityFact['source'],out:KitchenCapabilityFact[],seen:Set<string>){
 if(Array.isArray(value)){for(const raw of value.slice(0,80)){const label=cleanLabel(raw);if(label)pushFact(out,seen,scope,source,label,'available');}return;}
 if(typeof value==='string'){for(const raw of value.split(',').slice(0,80)){const label=cleanLabel(raw);if(label)pushFact(out,seen,scope,source,label,'available');}return;}
 if(!value||typeof value!=='object')return;
 for(const [rawLabel,rawStatus] of Object.entries(value as Record<string,unknown>).slice(0,80)){if(rawLabel==='_constraints')continue;const label=cleanLabel(rawLabel),status=availability(rawStatus);if(label&&status)pushFact(out,seen,scope,source,label,status);}
}
function collectConstraints(value:unknown):KitchenCapabilityConstraints{
 const section=value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
 const raw=section._constraints&&typeof section._constraints==='object'&&!Array.isArray(section._constraints)?section._constraints as Record<string,unknown>:{};
 return{burner_count:cleanCount(raw.burner_count),skillet_count:cleanCount(raw.skillet_count),container_count:cleanCount(raw.container_count),notes:cleanNotes(raw.notes)};
}
export function kitchenCapabilityRelevant(message:string,route:Route){if(route.workflow==='nutrition_planning')return true;return/(recipe|cook|cooking|meal prep|kitchen|microwave|oven|air fryer|slow cooker|crock[- ]?pot|blender|food processor|stovetop|skillet|pan|reheat)/.test(normalize(message));}

/** Reads only explicit canonical Profile settings. Missing equipment remains absent/unknown; this helper never infers ownership from recipes, conversations, usage, or Coach memory. */
export function buildKitchenCapabilityContext(profileSettings:unknown):KitchenCapabilityContext|null{
 if(!profileSettings||typeof profileSettings!=='object'||Array.isArray(profileSettings))return null;
 const settings=profileSettings as Record<string,unknown>,facts:KitchenCapabilityFact[]=[],seen=new Set<string>();
 collect(settings.kitchen_equipment,'home_kitchen','profile_settings.kitchen_equipment',facts,seen);
 collect(settings.work_reheat_equipment,'work_reheat','profile_settings.work_reheat_equipment',facts,seen);
 const constraints=collectConstraints(settings.kitchen_equipment);
 if(!facts.length&&!Object.values(constraints).some(value=>value!==null))return null;
 facts.sort((a,b)=>a.scope.localeCompare(b.scope,'en')||a.id.localeCompare(b.id,'en'));
 return{
  version:'kitchen_capability_context_v1',facts,constraints,
  guardrails:[
   'These are explicit canonical Profile facts only. Missing equipment remains unknown and must not be inferred.',
   'Home-kitchen and work-reheat capabilities are separate scopes; do not treat availability in one scope as availability in the other.',
   'Counts and free-text constraints are user-supplied planning constraints; do not infer additional equipment from them.',
   'Coach may use these facts to rank or explain validated Recipe options, but may not silently create or change canonical equipment facts.',
   'A Recipe adaptation still requires validated substitution/technique candidates and deterministic nutrition/yield review; equipment availability alone does not validate an adaptation.',
  ],
 };
}
