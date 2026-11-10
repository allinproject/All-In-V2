import type{Route}from'./core.ts';

const CONDITIONS=new Set(['type_1_diabetes','type_2_diabetes','prediabetes','other']);
const CONDITION_LABELS:Record<string,string>={type_1_diabetes:'Type 1 diabetes',type_2_diabetes:'Type 2 diabetes',prediabetes:'Prediabetes',other:'Other user-entered health condition'};
const DOMAIN_WORKFLOWS=new Set(['nutrition_planning','adaptive_coaching','long_range_training_plan','health_safety','race_execution','race_debrief','workout_analysis','endurance_fueling_plan','endurance_fueling_explain']);
const canonicalProviders=new Set(['apple_health','health_connect','connected_health_source']);
const norm=(v:unknown)=>String(v??'').toLowerCase().replace(/\s+/g,' ').trim();
const finite=(v:unknown)=>{const n=Number(v);return Number.isFinite(n)?n:null};

export function restrictedDiabetesTreatmentRequest(message:string):boolean{
 const m=norm(message);
 const insulin=/\binsulin\b/.test(m)&&/(how much|how many|dose|dosing|units?|bolus|basal|correction|correct|increase|decrease|raise|lower|adjust|change)/.test(m);
 const insulinShorthand=/(bolus|basal|correction dose|insulin[- ]?to[- ]?carb|carb ratio|correction factor)/.test(m)&&/(how much|how many|dose|dosing|units?|take|give|use|increase|decrease|adjust|change|should i)/.test(m);
 const medication=/(medication|medicine|meds?|metformin|glp-?1|semaglutide|ozempic|mounjaro|tirzepatide)/.test(m)&&/(start|stop|skip|change|adjust|increase|decrease|raise|lower|dose|dosing|take more|take less|should i)/.test(m);
 const treatment=/(blood sugar|blood glucose|glucose|hypoglyc|hyperglyc)/.test(m)&&/(treat|treatment|correction dose|target range|what should my target|how do i bring|how can i bring|what should i do|what do i do|how should i respond|how should i handle)/.test(m);
 return insulin||insulinShorthand||medication||treatment;
}

export function medicalBoundaryReply(){return 'I can account for diabetes in Training, fueling, hydration, Nutrition, Recovery, and workout-safety guidance, but I can’t tell you how much insulin to take, change a medication, or set a personal glucose-treatment target. Use your established clinician-provided diabetes plan for those decisions; if you have severe or worsening symptoms, seek appropriate urgent medical care.'}

export function unsafeDiabetesTreatmentAnswer(answer:string):boolean{
 const a=norm(answer);
 if(/\b\d+(?:\.\d+)?\s*(?:u|units?)\b.{0,40}\b(insulin|bolus|basal|correction)\b|\b(insulin|bolus|basal|correction)\b.{0,40}\b\d+(?:\.\d+)?\s*(?:u|units?)\b/.test(a))return true;
 if(/\b(increase|decrease|raise|lower|adjust|change|take|skip|stop|start)\b.{0,45}\b(insulin|bolus|basal|medication|medicine|meds?|metformin|semaglutide|ozempic|mounjaro|tirzepatide)\b/.test(a))return true;
 if(/\b(target|aim for)\b.{0,35}\b(glucose|blood sugar)\b.{0,20}\b\d{2,3}\b/.test(a))return true;
 if(/\b(low|hypoglyc|high|hyperglyc|glucose|blood sugar)\b.{0,70}\b\d+(?:\.\d+)?\s*(?:g|grams?)\b.{0,45}\b(carb|carbohydrate|sugar)\b/.test(a))return true;
 return false;
}

function messageIsHealthRelevant(message:string){const m=norm(message);return/(diabet|glucose|blood sugar|training|workout|run|ride|swim|fuel|carb|meal|eat|nutrition|hydrat|drink|recovery|recover|sleep|exercise)/.test(m)}

export type CanonicalGlucoseSignal={valueMgDl:number;observedAt:string;trend:string|null;source:{kind:'canonical_health';provider:'apple_health'|'health_connect'|'connected_health_source';sourceId:string}};
export function validatedCanonicalGlucoseSignal(value:any):CanonicalGlucoseSignal|null{
 if(!value||typeof value!=='object'||value?.source?.kind!=='canonical_health'||!canonicalProviders.has(String(value?.source?.provider??'')))return null;
 const reading=finite(value.value_mg_dl??value.valueMgDl),observedAt=String(value.observed_at??value.observedAt??'').trim(),sourceId=String(value?.source?.source_id??value?.source?.sourceId??'').trim();
 if(reading===null||reading<=0||reading>1000||!sourceId||!/^\d{4}-\d{2}-\d{2}T/.test(observedAt))return null;
 const provider=String(value.source.provider) as CanonicalGlucoseSignal['source']['provider'];
 const trendRaw=String(value.trend??'').trim();
 return{valueMgDl:reading,observedAt,trend:trendRaw?trendRaw.slice(0,40):null,source:{kind:'canonical_health',provider,sourceId:sourceId.slice(0,200)}};
}

export function taskRelevantPrivateHealthContext(row:any,route:Route,message:string,canonicalGlucose:any=null){
 if(!row||row.coach_opt_in!==true)return null;
 const condition=String(row.condition_key??'');if(!CONDITIONS.has(condition))return null;
 if(!DOMAIN_WORKFLOWS.has(route.workflow)&&!messageIsHealthRelevant(message))return null;
 const sourceKind=String(row.source_kind??''),sourceProvider=String(row.source_provider??'');
 if(sourceKind!=='manual_profile'||sourceProvider!=='all_in_profile')return null;
 const glucose=validatedCanonicalGlucoseSignal(canonicalGlucose);
 return{
  condition:{key:condition,label:CONDITION_LABELS[condition],source:{kind:'manual_profile',provider:'all_in_profile',updated_at:String(row.updated_at??'')||null}},
  relevance:['training','fueling','hydration','nutrition','recovery','workout_safety'],
  treatment_boundaries:['no_insulin_dose_advice','no_medication_changes','no_diagnosis','no_personal_treatment_targets','no_detailed_glycemic_treatment_algorithms'],
  ...(glucose?{canonical_glucose:glucose}:{}),
 };
}
