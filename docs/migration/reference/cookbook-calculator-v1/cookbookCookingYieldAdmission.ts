import {nativeIngredientSourceText} from './nativeIngredientImportParser';

export type CookbookCookingYieldAdmissionSummary={
  version:1;
  policy:'classified_on_ingest';
  ingredient_count:number;
  exact_yield_count:number;
  explicit_handling_count:number;
  manual_review_count:number;
  user_facing_review_count:number;
  unneeded_count:number;
};

const STATES=new Set(['raw','cooked','dry','prepared','drained','as_sold']);
const GENERIC_METHODS=new Set(['cooked','prepared']);
const PREPARED_WORD=/\b(cooked|prepared|roasted|baked|boiled|grilled|fried|steamed|sauteed|sautéed|drained|mashed|precooked|smoked|cured|deli|canned|as sold|ready to eat)\b/i;
const PURCHASE_STATE_FOOD=/\b(chicken|turkey|pork|beef|lamb|sausage|bacon|ham|steak|potato|potatoes|fish|salmon|tuna|cod|tilapia|shrimp|prawn|scallop|crab|lobster|venison|bison)\b/i;
const RAW_STATE_WORD=/\b(raw|uncooked)\b/i;

export function admitCookbookCookingYieldIngredients(
  rows:any[],
  options:{allowRawKit?:boolean}={},
):{ingredients:any[];summary:CookbookCookingYieldAdmissionSummary}{
  let exact=0,handling=0,manual=0,userFacingReview=0,unneeded=0;
  const allowRawKit=options.allowRawKit===true;
  const ingredients=(Array.isArray(rows)?rows:[]).slice(0,250).map(raw=>{
    const row=baseIngredient(raw);if(!row)return null;
    // Normal finished-dish ingredient lists describe what is served, not raw meat
    // or uncooked potatoes that happen to be used during preparation. A deliberate
    // raw Freezer Kit is the only current exception.
    if(!allowRawKit&&needsCookedFacingReview(row)){
      userFacingReview++;
    }
    const explicitHandling=sanitizeHandling(raw?.cooking_yield_handling);
    if(explicitHandling){row.cooking_yield_handling=explicitHandling;handling++;if(explicitHandling.mode==='manual_review_required')manual++;return row;}
    const explicitYield=sanitizeYield(raw?.cooking_yield);
    if(explicitYield){row.cooking_yield=explicitYield;exact++;return row;}
    if(raw?.cooking_yield!==undefined||raw?.cooking_yield_handling!==undefined||preparedStateText(row)){
      row.cooking_yield_handling={mode:'manual_review_required',reason:'This cookbook ingredient describes or supplied a prepared-state Cooking Yield conversion without a complete exact food/form/method authority. Review it before automatic raw/dry purchase conversion.'};
      handling++;manual++;return row;
    }
    unneeded++;return row;
  }).filter(Boolean) as any[];
  return {ingredients,summary:{version:1,policy:'classified_on_ingest',ingredient_count:ingredients.length,exact_yield_count:exact,explicit_handling_count:handling,manual_review_count:manual,user_facing_review_count:userFacingReview,unneeded_count:unneeded}};
}

// URL import editing round-trips ingredients through text. Restore only source-authored
// Cooking Yield fields when exactly one original ingredient has the same normalized source line.
// Edited/ambiguous/unmatched lines inherit nothing and are classified fail-closed at save time.
export function restoreExactCookbookYieldMetadata(parsedRows:any[],sourceRows:any[]):any[]{
  const source=Array.isArray(sourceRows)?sourceRows:[];
  return (Array.isArray(parsedRows)?parsedRows:[]).map(parsed=>{
    if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))return parsed;
    if(parsed.cooking_yield!==undefined||parsed.cooking_yield_handling!==undefined)return parsed;
    const identity=sourceIdentity(parsed);if(!identity)return parsed;
    const matches=source.filter(row=>sourceIdentity(row)===identity);
    if(matches.length!==1)return parsed;
    const match=matches[0],additions:Record<string,any>={};
    if(match?.cooking_yield!==undefined)additions.cooking_yield=match.cooking_yield;
    if(match?.cooking_yield_handling!==undefined)additions.cooking_yield_handling=match.cooking_yield_handling;
    return Object.keys(additions).length?{...parsed,...additions}:parsed;
  });
}

export function sanitizeCookbookCookingYield(value:any){return sanitizeYield(value)}
export function sanitizeCookbookCookingYieldHandling(value:any){return sanitizeHandling(value)}

function needsCookedFacingReview(row:Record<string,any>){
  const line=[row.item,row.text,row.source_text,row.amount,row.qty,row.quantity].filter(Boolean).join(' ');
  if(!PURCHASE_STATE_FOOD.test(line))return false;
  const amount=String(row.amount??row.qty??row.quantity??'');
  const targetAt=amount.search(/\(\s*target\b/i);
  if(targetAt>=0){
    const purchaseAmount=amount.slice(0,targetAt);
    const targetNote=amount.slice(targetAt);
    const hasRawPurchaseState=RAW_STATE_WORD.test(purchaseAmount);
    const hasCookedFinishedTarget=/\b(?:target)\s+(?:about\s+)?(?:\d+(?:\.\d+)?|\d+\/\d+)\s*(?:g|grams?|kg|oz|ounces?|lbs?|pounds?)\s+(?:cooked|prepared)\s*\)/i.test(targetNote);
    // The finished recipe view shows only this explicit cooked target, while
    // Pantry/Shopping retain the raw/dry purchase amount separately.
    if(hasRawPurchaseState&&hasCookedFinishedTarget)return false;
  }
  if(RAW_STATE_WORD.test(line))return true;
  return !PREPARED_WORD.test(line);
}
function sourceIdentity(raw:any){return normalizeSource(nativeIngredientSourceText(raw&&typeof raw==='object'?raw:{text:String(raw??'')}))}
function normalizeSource(v:string){return String(v??'').trim().toLowerCase().replace(/\s+/g,' ')}
function baseIngredient(raw:any):Record<string,any>|null{
  if(typeof raw==='string'){const text=raw.trim().slice(0,500);return text?{text}:null;}
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
  const out:Record<string,any>={};
  for(const k of ['item','text','amount','quantity','qty','unit','notes','optional','source_text']){
    const v=raw[k];if(v===undefined)continue;
    if(typeof v==='string')out[k]=v.trim().slice(0,500);else if(['number','boolean'].includes(typeof v)||v===null)out[k]=v;
  }
  return Object.keys(out).length?out:null;
}
function sanitizeHandling(value:any){
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const mode=String(value.mode??'').trim();if(mode!=='batch_required'&&mode!=='manual_review_required')return null;
  const reason=String(value.reason??'').trim().slice(0,500)||'Cooking Yield requires explicit review before automatic purchase conversion.';
  return {mode,reason};
}
function sanitizeYield(value:any){
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const target=state(value.target_state??value.targetState),purchase=state(value.purchase_state??value.purchaseState);
  const rawKey=value.key??value.yield_key??value.yieldKey;
  if(!target||!purchase||!rawKey||typeof rawKey!=='object'||Array.isArray(rawKey))return null;
  const food=clean(rawKey.food,160);if(!food)return null;
  const key:Record<string,any>={food};
  for(const k of ['form','method','doneness'] as const){const v=clean(rawKey[k],160);if(v)key[k]=v;}
  const lid=clean(rawKey.lid,20);if(['covered','uncovered','mixed'].includes(lid))key.lid=lid;
  if(typeof rawKey.drained==='boolean')key.drained=rawKey.drained;
  if((target==='cooked'||target==='prepared')&&(purchase==='raw'||purchase==='dry')){
    if(!key.form||!key.method||GENERIC_METHODS.has(String(key.method).toLowerCase()))return null;
  }
  const out:Record<string,any>={target_state:target,purchase_state:purchase,key};
  const usage=state(value.usage_state??value.usageState);if(usage)out.usage_state=usage;
  const basis=clean(value.measurement_basis??value.measurementBasis,60);if(basis)out.measurement_basis=basis;
  return out;
}
function preparedStateText(row:Record<string,any>){return PREPARED_WORD.test([row.item,row.text,row.source_text,row.notes].filter(Boolean).join(' '))}
function state(v:any){const s=String(v??'').trim().toLowerCase();return STATES.has(s)?s:null}
function clean(v:any,max:number){return typeof v==='string'?v.trim().slice(0,max):''}
