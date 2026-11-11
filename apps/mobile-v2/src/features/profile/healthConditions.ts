/** ALL-251: owner-scoped health entries. Coach runtime access remains disabled. */
export type HealthFact = { id:string; text:string };
export type HealthDraft = { conditions:HealthFact[]; limitations:HealthFact[] };
export const EMPTY_HEALTH_DRAFT:HealthDraft = { conditions:[],limitations:[] };
export const MAX_FACTS_PER_SECTION=12;
export const MAX_FACT_LENGTH=180;
export function normalizeHealthFact(value:string):string {
 return value.trim().replace(/\s+/g,' ').slice(0,MAX_FACT_LENGTH);
}
export function addHealthFact(draft:HealthDraft,section:keyof HealthDraft,value:string,id:string):HealthDraft {
 const text=normalizeHealthFact(value);
 if(!text)throw new Error('Enter a condition or limitation first.');
 if(!id||id.length>100)throw new Error('Invalid entry identifier.');
 if(draft[section].length>=MAX_FACTS_PER_SECTION)throw new Error('Too many entries. Remove one before adding another.');
 if(draft.conditions.some(x=>x.id===id)||draft.limitations.some(x=>x.id===id))throw new Error('Duplicate entry identifier.');
 if(draft[section].some(x=>x.text.toLocaleLowerCase()===text.toLocaleLowerCase()))throw new Error('Already added.');
 return {...draft,[section]:[...draft[section],{id,text}]};
}
export function removeHealthFact(draft:HealthDraft,section:keyof HealthDraft,id:string):HealthDraft {
 return {...draft,[section]:draft[section].filter(x=>x.id!==id)};
}

export type SavedHealthConsiderations = {
  draft: HealthDraft;
  coachOptIn: boolean;
  version: number;
};
export function parseSavedHealthConsiderations(value: unknown): SavedHealthConsiderations {
  const item = value && typeof value==='object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
  const parse = (raw:unknown, prefix:string):HealthFact[] => Array.isArray(raw)
    ? raw.filter((v):v is string=>typeof v==='string' && v.trim().length>0)
      .slice(0,MAX_FACTS_PER_SECTION).map((text,i)=>({id:prefix+i,text:normalizeHealthFact(text)}))
    : [];
  return {
    draft:{conditions:parse(item.conditions,'condition-'),limitations:parse(item.limitations,'limitation-')},
    coachOptIn:item.coach_opt_in===true,
    version:typeof item.version==='number' && Number.isSafeInteger(item.version) && item.version>=0?item.version:0,
  };
}
export function healthConsiderationsPayload(draft:HealthDraft) {
  const encode=(facts:HealthFact[])=>facts.map(x=>normalizeHealthFact(x.text)).filter(Boolean);
  if(draft.conditions.length>MAX_FACTS_PER_SECTION || draft.limitations.length>MAX_FACTS_PER_SECTION)
    throw new Error('Too many health records.');
  return {conditions:encode(draft.conditions),limitations:encode(draft.limitations)};
}
