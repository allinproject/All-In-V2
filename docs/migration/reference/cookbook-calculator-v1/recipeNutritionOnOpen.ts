import type {SupabaseClient} from '@supabase/supabase-js';
import {searchExternalGenericIngredients,type NativeRecipeDetail,type NativeGenericIngredientCandidate} from './recipeClient';
import {
 calculateValidatedRecipeIngredientNutrition,
 type RecipeIngredientNutritionLine,
 type RecipeIngredientNutritionProfile,
} from '../lib/recipeAdaptationNutritionEvidence';

type CatalogProfile={
 profile_key:string;label:string;basis_g:number|string|null;
 calories:number|string|null;protein_g:number|string|null;
 carbs_g:number|string|null;fat_g:number|string|null;
 metadata:Record<string,unknown>|null;
};
export type OpenRecipeNutrition={
 status:'estimated'|'partial'|'unavailable';
 recipeId:string;coveredCount:number;ingredientCount:number;
 missing:string[];excluded:string[];assumed:string[];
 perServing:{calories:number;proteinG:number;carbsG:number;fatG:number}|null;
};
/** Read-only public reference catalog, shared by all recipes. Never stores user information. */
let catalog:CatalogProfile[]|null=null;
let catalogPromise:Promise<CatalogProfile[]>|null=null;
export async function loadRecipeNutritionCatalog(client:SupabaseClient):Promise<CatalogProfile[]>{
 if(catalog)return catalog;
 if(!catalogPromise){
  catalogPromise=(async()=>{
   const {data,error}=await client.from('allin_ingredient_profiles')
    .select('profile_key,label,basis_g,calories,protein_g,carbs_g,fat_g,metadata')
    .order('profile_key').limit(1000);
   if(error)throw error;
   if(!Array.isArray(data)||data.length===0||data.length>=1000)throw new Error('Ingredient reference catalog is unavailable or incomplete.');
   const profiles=data as CatalogProfile[];
   catalog=profiles;
   return profiles;
  })().catch(error=>{catalogPromise=null;throw error;});
 }
 return catalogPromise;
}
const text=(value:unknown)=>typeof value==='string'?value.trim():'';
const normalized=(value:string)=>value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim();
/** Recipe imports may store quantities as strings rather than item/amount fields. */
function authoredParts(item:any):{name:string;amount:string}{
 if(typeof item==='string'){
  const raw=item.trim();
  const match=/^((?:\d+(?:\.\d+)?|\.\d+|\d+\/\d+)\s*(?:g|grams?|kg|oz|ounces?|lbs?|pounds?|ml|milliliters?|tsp|teaspoons?|tbsp|tablespoons?|each|pieces?|tortillas?|slices?))\s+(.+)$/i.exec(raw);
  return match?{name:match[2].trim(),amount:match[1].trim()}:{name:raw,amount:''};
 }
 return {name:text(item?.item??item?.ingredient??item?.name),
  amount:text(item?.amount??item?.qty)};
}
function recipeNutritionParts(item:any):{name:string;amount:string}{
 const authored=authoredParts(item);
 const target=/\(\s*target\s+(about\s+)?((?:\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?|\.\d+))\s*(g|grams?|kg|oz|ounces?|lbs?|pounds?)\s+(cooked|prepared)\s*\)/i.exec(authored.amount);
 if(!target)return authored;
 const purchasePrefix=authored.amount.slice(0,target.index);
 const purchaseState=/\b(dry)\b/i.test(purchasePrefix)?'dry':/\b(raw|uncooked)\b/i.test(purchasePrefix)?'raw':null;
 if(!purchaseState)return authored;
 let cookedName=authored.name
  .replace(/,\s*(?:purchase\s+)?(?:raw|uncooked|dry)\b/ig,'')
  .replace(/\(\s*(?:raw|uncooked|dry)\s*\)/ig,'')
  .replace(/^\s*(?:raw|uncooked|dry)\s+/i,'')
  .replace(/\s*,\s*,\s*/g,', ')
  .replace(/\s+/g,' ').trim().replace(/^,|,$/g,'').trim();
 cookedName=purchaseState==='dry'
  ?'Cooked '+cookedName
  :cookedName+', cooked';
 const amount=(target[1]?'about ':'')+target[2]+' '+target[3]+' '+target[4].toLowerCase();
 return {name:cookedName,amount};
}
function numericAmount(raw:string):number{
 const value=raw.trim();
 const mixed=/^(\d+)\s+(\d+)\/(\d+)$/.exec(value);
 if(mixed){const denominator=Number(mixed[3]);return denominator?Number(mixed[1])+Number(mixed[2])/denominator:NaN}
 const fraction=/^(\d+)\/(\d+)$/.exec(value);
 if(fraction){const denominator=Number(fraction[2]);return denominator?Number(fraction[1])/denominator:NaN}
 return Number(value);
}
const nutrient=(value:unknown)=>value!==null&&value!==undefined&&value!==''&&
 Number.isFinite(Number(value))&&Number(value)>=0?Number(value):null;
// Approximate household-measure conversion for cookbook estimates only.
// These are not ingredient identities, label serving sizes or verified Pantry weights.
const APPROX_GRAMS_PER_TSP:Readonly<Record<string,number>>={
 'baking powder':4,'garlic powder':3.1,'salt':6,'black pepper':2.3,
 'italian seasoning':1,'cumin':2.1,'ground cumin':2.1,'chili powder':2.7,
 'ranch seasoning':2.5,'seasoned salt':6,'smoked paprika':2.3,
 'thick pizza sauce':5.2,'pizza sauce':5.2,'buffalo sauce':5.1,'buffalo wing sauce':5.1,
 'bbq sauce':5.5,'thick salsa':5.1,'salsa':5.1,'diced green chiles, drained':4.8,
 'jalapeños, drained and chopped':4.5,'jalapeños':4.5,'reduced-fat mexican-blend cheese':2.3,
};
function quantity(amount:string,profile:CatalogProfile,ingredientName:string):{grams?:number;each?:number;assumption?:string}|null{
 const clean=amount.trim().replace(/^(?:about|approx(?:imately|\.)?)\s+/i,'').trim();
 const calculationAmount=clean;
 // Typical USDA edible portion weights for generic cookbook estimates.
 // These convert authored household portions to the existing per-gram
 // nutrient profile; they do NOT change stored recipes or verified Food Log.
 const wholeEgg=/^(?:large eggs?|eggs?)(?:,?\s+softly scrambled)?$/i.test(ingredientName);
 const eggWhite=/^(?:egg whites?|liquid egg whites?)(?:,?\s+softly scrambled)?$/i.test(ingredientName);
 if(wholeEgg&&/^([1-9]\d*)\s*(?:eggs?|each)?$/i.test(clean)){
  const match=/^([1-9]\d*)/.exec(clean);
  return match?{grams:Number(match[1])*50.3,assumption:'1 large egg ≈ 50.3 g edible (USDA household weight)'}:null;
 }
 if(eggWhite&&/^([1-9]\d*)\s*(?:egg whites?|each)$/i.test(clean)){
  const match=/^([1-9]\d*)/.exec(clean);
  return match?{grams:Number(match[1])*33,assumption:'1 large egg white ≈ 33 g edible (USDA household weight)'}:null;
 }
 const volume=/^(\d+(?:\s+\d+\/\d+)?|\d+\/\d+|\.\d+)\s*(tsp|teaspoons?|tbsp|tablespoons?|cup|cups)\s*(?:,\s*or to taste)?$/i.exec(clean);
 if(volume){
  const parts=volume[1].split(/\s+/);
  const frac=(v:string)=>v.includes('/')?Number(v.split('/')[0])/Number(v.split('/')[1]):Number(v);
  const n=parts.reduce((sum,v)=>sum+frac(v),0);
  const density=APPROX_GRAMS_PER_TSP[normalized(ingredientName)];
  if(eggWhite&&Number.isFinite(n)&&n>0){
   const teaspoons=/^(tsp|teaspoons?)$/i.test(volume[2]);
   const cups=/^(cup|cups)$/i.test(volume[2]);
   return {grams:n*(teaspoons?15.2/3:cups?15.2*16:15.2),
    assumption:'Liquid egg white ≈ 15.2 g per tablespoon (USDA household weight)'};
  }
  if(density&&Number.isFinite(n)&&n>0){
   const factor=/^(tbsp|tablespoons?)$/i.test(volume[2])?3:/^(cup|cups)$/i.test(volume[2])?48:1;
   return {grams:n*factor*density,
    assumption:'Approximate '+ingredientName+' density: '+density+' g per teaspoon'};
  }
 }
 const volumeMl=/^(\d+(?:\.\d+)?|\.\d+)\s*(ml|milliliters?)\s*$/i.exec(clean);
 if(volumeMl&&/^(unsweetened (?:plain )?almond milk|water|warm water)$/i.test(ingredientName)){
  const n=Number(volumeMl[1]);
  return n>0?{grams:n}:null; // approximate 1 g/ml for these water-based liquids
 }
 const range=/^((?:\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?|\.\d+))\s*[–-]\s*((?:\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?|\.\d+))\s*(g|grams?|kg|oz|ounces?|lb|lbs|pounds?)\s+(raw|uncooked|dry|cooked|drained|softened|total)$/i.exec(calculationAmount);
 const sourceState=[profile.label,typeof profile.metadata?.form==='string'?profile.metadata.form:''].join(' ').toLowerCase();
 const gramsFor=(n:number,unit:string)=>n*(unit==='kg'?1000:unit==='oz'||unit.startsWith('ounce')?28.349523125:unit==='lb'||unit==='lbs'||unit.startsWith('pound')?453.59237:1);
 if(range){
  const low=numericAmount(range[1]),high=numericAmount(range[2]),unit=range[3].toLowerCase(),state=range[4].toLowerCase();
  if(!(low>0)||!(high>=low))return null;
  if(((state==='raw'||state==='uncooked'||state==='dry')&&/\bcooked\b/.test(sourceState))||
     (state==='cooked'&&/\b(raw|uncooked|dry)\b/.test(sourceState)))return null;
  const midpoint=(low+high)/2;
  return {grams:gramsFor(midpoint,unit),
   assumption:'Nutrition estimate uses the midpoint of the authored '+range[1]+'–'+range[2]+' '+range[3]+' '+state+' range ('+midpoint+' '+range[3]+').'};
 }
 const annotated=/^(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?|\.\d+)\s*(g|grams?|kg|oz|ounces?|lb|lbs|pounds?)\s+(raw|uncooked|dry|cooked|drained|softened|total)$/i.exec(calculationAmount);
 if(annotated){
  const state=annotated[3].toLowerCase();
  if(((state==='raw'||state==='uncooked'||state==='dry')&&/\bcooked\b/.test(sourceState))||
     (state==='cooked'&&/\b(raw|uncooked|dry)\b/.test(sourceState)))return null;
  const n=numericAmount(annotated[1]);
  if(!(n>0))return null;
  return {grams:gramsFor(n,annotated[2].toLowerCase())};
 }
 const mass=/^(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?|\.\d+)\s*(g|grams?|kg|oz|ounces?|lb|lbs|pounds?)\s*$/i.exec(calculationAmount);
 if(mass){
  const n=numericAmount(mass[1]);if(!(n>0))return null;
  return {grams:gramsFor(n,mass[2].toLowerCase())};
 }
 // The catalog may explicitly state a nutritional basis per one counted item.
 // Do not infer the weight of an arbitrary large tortilla, egg or slice.
 const count=/^([1-9]\d*)(?:\s+(?:each|pieces?|tortillas?|slices?|wraps?))?$/i.exec(clean);
 if(count&&Number(profile.basis_g)===1&&
    typeof profile.metadata?.basis==='string'&&/^one\s+(representative\s+)?/i.test(profile.metadata.basis))
  return {each:Number(count[1])};
 return null;
}
/** Approximate cookbook nutrition ONLY, using the same canonical arithmetic
 * as reviewed food calculations. Temporary arithmetic inputs are never treated
 * as evidence for Food Log, Pantry, Prepared Meals, or persisted nutrition.
 */
export function estimateOpenedRecipeNutrition(
 detail:Pick<NativeRecipeDetail,'id'|'servings'|'ingredients'>,
 profiles:readonly CatalogProfile[],
):OpenRecipeNutrition{
 const aliases=new Map<string,CatalogProfile[]>();
 for(const profile of profiles){
  const candidateNames=[profile.label,...(Array.isArray(profile.metadata?.aliases)?profile.metadata.aliases:[])];
  for(const entry of candidateNames){
   if(typeof entry!=='string'||!entry.trim())continue;
   const key=normalized(entry),found=aliases.get(key)??[];
   if(!found.some(p=>p.profile_key===profile.profile_key))found.push(profile);
   aliases.set(key,found);
  }
 }
 const missing:string[]=[],excluded:string[]=[],assumed:string[]=[],inputs:RecipeIngredientNutritionLine[]=[];
 for(const [index,item] of detail.ingredients.entries()){
  const {name,amount}=recipeNutritionParts(item);
  // These explicitly optional, unmeasured additions are omitted from the
  // approximate display instead of pretending they contribute exactly zero.
  const isTinyOptional=(/^(to taste|as desired)$/i.test(amount)&&
    /^(salt|black pepper|crushed red pepper|chili flakes|garlic powder|italian seasoning)$/i.test(name))||
   (/^1\s+light\s+spray$/i.test(amount)&&/^(nonstick cooking spray|cooking spray)$/i.test(name));
  const negligibleMineral=/^sodium citrate$/i.test(name)&&/^(?:0?\.\d+|1(?:\.0+)?)\s*g$/i.test(amount);
  const optionalSeasoning=/^italian seasoning$/i.test(name)&&/^(?:1\/8|1\/4)\s*tsp$/i.test(amount);
  if(isTinyOptional||negligibleMineral||optionalSeasoning){excluded.push(name);continue}
  const matches=(lookup:string)=>(aliases.get(normalized(lookup))??[]).filter(p=>
   nutrient(p.calories)!==null&&nutrient(p.protein_g)!==null&&
   nutrient(p.carbs_g)!==null&&nutrient(p.fat_g)!==null&&Number(p.basis_g)>0);
  let ready=matches(name),assumedName='';
  // Same distinctive ingredient words in a different order are the same
  // catalog identity, e.g. "cooked turkey breakfast sausage, crumbled".
  // Require exact normalized token sets and one unique nutrient profile.
  if(ready.length===0){
   const wanted=new Set(tokens(name));
   if(wanted.size>=2){
    const reordered=profiles.filter(profile=>
     nutrient(profile.calories)!==null&&nutrient(profile.protein_g)!==null&&
     nutrient(profile.carbs_g)!==null&&nutrient(profile.fat_g)!==null&&Number(profile.basis_g)>0&&
     [profile.label,...(Array.isArray(profile.metadata?.aliases)?profile.metadata.aliases:[])]
      .some(alias=>{
       if(typeof alias!=='string')return false;
       const candidate=new Set(tokens(alias));
       return candidate.size===wanted.size&&[...wanted].every(word=>candidate.has(word));
      }));
    if(reordered.length===1){ready=reordered;assumedName=reordered[0].label}
   }
  }
  // Recipe authors may list substitute choices. Display a default estimate
  // for the FIRST named option and disclose it; user-selected substitutions
  // or package labels supersede this assumption.
  if(ready.length===0&&/\s+or\s+/i.test(name)){
   const choices=name.split(/\s+or\s+/i),first=choices[0]?.trim()??'';
   if(choices.length===2&&first){
    let candidateMatches=matches(first),selected=first;
    if(candidateMatches.length!==1&&first.split(' ').length===1){
     const suffix=choices[1].trim().split(/\s+/).at(-1)??'';
     if(suffix){selected=first+' '+suffix;candidateMatches=matches(selected)}
    }
    if(candidateMatches.length===1){ready=candidateMatches;assumedName=selected}
   }
  }
  const chosen=ready.length===1?ready[0]:null;
  const portion=chosen?quantity(amount,chosen,name):null;
  if(!chosen||!portion){missing.push(name||`Ingredient ${index+1}`);continue}
  if(assumedName)assumed.push(`${name} → ${assumedName}`);
  if(portion.assumption)assumed.push(`${name}: ${portion.assumption}`);
  const nutritionStatus=String(chosen.metadata?.nutrition_status??'');
  if(/legacy|pending|proxy|estimated/i.test(nutritionStatus)){
   const reviewNote=String(chosen.metadata?.source_review_note??chosen.metadata?.review_note??chosen.metadata?.warning??'').trim();
   assumed.push(reviewNote? `${name}: ${reviewNote}` : `${name}: ${chosen.label} is a provisional catalog reference; source/form review is pending.`);
  }
  const count=portion.each!==undefined;
  const basis=Number(chosen.basis_g);
  const profile:RecipeIngredientNutritionProfile={
   profile_key:chosen.profile_key,preparation_state:'as_authored',
   basis_g:count?null:basis,basis_unit:count?'each':'g',
   ...(count?{basis_quantity:1,serving_name:'item'}:{}),
   calories_kcal:Number(chosen.calories),protein_g:Number(chosen.protein_g),
   carbs_g:Number(chosen.carbs_g),fat_g:Number(chosen.fat_g),
   // 'validated' is transient ONLY so the existing pure arithmetic kernel can
   // sum numeric reference values. This method never returns validated evidence.
   status:'validated',provenance:{kind:'catalog_estimate_not_verified',profile_key:chosen.profile_key},
  };
  inputs.push({ingredient_id:String(index),profile_key:profile.profile_key,
   preparation_state:profile.preparation_state,
   ...(count?{quantity_each:portion.each}:{quantity_g:portion.grams}),profile});
 }
 const base={status:'unavailable' as const,recipeId:detail.id,coveredCount:inputs.length,
  ingredientCount:detail.ingredients.length,missing,excluded,assumed,perServing:null};
 if(inputs.length===0||!Number.isSafeInteger(Number(detail.servings))||Number(detail.servings)<1)return base;
 const calc=calculateValidatedRecipeIngredientNutrition({
  recipe_id:detail.id,recipe_state_version:'catalog-estimate',servings:Number(detail.servings),ingredients:inputs,
 });
 if(calc.status!=='validated')return base;
 return {status:missing.length?'partial':'estimated',recipeId:detail.id,
  coveredCount:inputs.length,ingredientCount:detail.ingredients.length,missing,excluded,assumed,
  perServing:{calories:calc.calories_kcal,proteinG:calc.protein_g,carbsG:calc.carbs_g,fatG:calc.fat_g}};
}

/** The existing USDA generic search may supplement missing catalog identities.
 * This is an estimated display ONLY; no result is promoted into a verified
 * ingredient record or saved nutrition, and no hidden model is involved.
 */
const providerCache=new Map<string,Promise<NativeGenericIngredientCandidate|null>>();
const PROVIDER_QUERY_LIMIT=5;
/** Discard any prior account's ingredient lookup names at session boundaries. */
export function clearRecipeNutritionLookupCache(){providerCache.clear()}

const ignored=new Set(['thick','fresh','crumbled','chopped','diced','sliced','shredded','drained','and','seasoning','prepared','ready','serve','plain','large','small','finely','minced']);
const tokens=(value:string)=>normalized(value).replace(/[^a-z0-9]+/g,' ').split(' ')
 .filter(token=>token.length>2&&!ignored.has(token))
 .map(token=>token==='bell'?'sweet':token==='bbq'?'barbecue':token==='chile'?'chili':/ies$/.test(token)&&token.length>5?
    token.slice(0,-3)+'y':/(ches|shes|sses)$/.test(token)&&token.length>5?
    token.slice(0,-2):token.endsWith('s')&&!token.endsWith('ss')&&token.length>4?
    token.slice(0,-1):token);
const COOKING_METHOD_TOKENS=new Set([
 'roasted','grilled','baked','fried','broiled','steamed','boiled','sauteed',
 'braised','poached','stewed','smoked','seared','toasted','cooked',
]);
function comparableUsdaGroupKey(value:NativeGenericIngredientCandidate|string):string|null{
 const description=typeof value==='string'?value:value.description;
 const identity=new Set(tokens(description));
 // USDA records frequently imply cooked state through a method word rather
 // than repeating "cooked". Normalize state, but preserve every other
 // identity qualifier (species, cut, lean grade, skin, form, brand).
 const methodCooked=/\b(roasted|grilled|baked|fried|broiled|steamed|boiled|sauteed|braised|poached|stewed|smoked|seared)\b/i.test(description);
 if(methodCooked)identity.add('cooked');
 const state=/\b(raw|uncooked)\b/i.test(description)?'raw':
  /\b(cooked|roasted|grilled|baked|fried|broiled|steamed|boiled|sauteed|braised|poached|stewed|smoked|seared)\b/i.test(description)?'cooked':'unspecified';
 for(const method of COOKING_METHOD_TOKENS)identity.delete(method);
 return identity.size?[...identity].sort().join('|')+'|state:'+state:null;
}
function specificCookingMethods(value:string){return tokens(value).filter(token=>COOKING_METHOD_TOKENS.has(token)&&token!=='cooked'&&token!=='toasted')}
function meanCandidateValues(rows:NativeGenericIngredientCandidate[],key:'calories'|'proteinG'|'carbsG'|'fatG'|'fiberG'|'saturatedFatG'|'sodiumMg'):number|null{
 const values=rows.map(row=>row[key]);
 const numericValues=values.filter((value):value is number=>value!==null&&Number.isFinite(value));
 if(numericValues.length!==values.length)return null;
 return numericValues.reduce((sum,value)=>sum+value,0)/numericValues.length;
}
export function closestEstimatedUsdaIngredient(
 ingredient:string,candidates:readonly NativeGenericIngredientCandidate[],
):NativeGenericIngredientCandidate|null{
 if(/\bor\b/i.test(ingredient))return null;
 const wanted=tokens(ingredient);
 if(wanted.length===0)return null;
 const ingredientIsRaw=/\braw\b/i.test(ingredient),ingredientIsCooked=/\b(cooked|grilled|baked|roasted|fried|broiled|steamed|boiled)\b/i.test(ingredient);
 const scored:Array<{candidate:NativeGenericIngredientCandidate;score:number;groupKey:string|null}>=[];
 for(const candidate of candidates){
  if(!candidate.usable||candidate.source!=='usda_fdc'||candidate.basisG!==100||
    candidate.calories===null||candidate.proteinG===null||candidate.carbsG===null||candidate.fatG===null)continue;
  const description=candidate.description;
  const candidateIsRaw=/\b(raw|uncooked)\b/i.test(description);
  const candidateIsCooked=/\b(cooked|grilled|roasted|baked|fried|broiled|steamed|boiled|sauteed|braised|poached|stewed|smoked|seared)\b/i.test(description);
  if(ingredientIsRaw&&!candidateIsRaw)continue;
  if(ingredientIsCooked&&!candidateIsCooked)continue;
  if(candidateIsRaw&&candidateIsCooked)continue;
  const found=new Set(tokens(description));
  if(/\b(roasted|grilled|baked|fried|broiled|steamed|boiled|sauteed|braised|poached|stewed|smoked|seared)\b/i.test(description))found.add('cooked');
  // Do not cross food species, cut, lean grade, preparation or product qualifiers.
  const protectedWords=['turkey','chicken','pork','beef','lamb','fish','shrimp',
   'lean','skim','reduced','unsweetened','nonfat','pepperoni','pizza','ranch',
   'breast','thigh','tenderloin','shoulder','loin','sirloin','bacon','sausage',
   'skinless','boneless','ground','with','skin','bone','part','skim'];
  if(protectedWords.some(word=>wanted.includes(word)&&!found.has(word)))continue;
  const animalProteins=['turkey','chicken','pork','beef','lamb','fish','shrimp'];
  if(animalProteins.some(word=>found.has(word)&&!wanted.includes(word)))continue;
  const matched=wanted.filter(token=>found.has(token)).length;
  const score=matched/wanted.length;
  if(score>=0.75)scored.push({candidate,score,groupKey:comparableUsdaGroupKey(candidate)});
 }
 if(!scored.length)return null;
 const bestScore=Math.max(...scored.map(row=>row.score));
 const best=scored.filter(row=>row.score===bestScore);
 const requestedGroupKey=comparableUsdaGroupKey(ingredient);
 const requestedMethods=specificCookingMethods(ingredient);
 // Perfect token coverage alone is not a 1:1 match: the candidate may contain
 // an extra cut/form or a cooking method the recipe never specified.
 if(best.length===1){
  const candidateMethods=specificCookingMethods(best[0].candidate.description);
  if(bestScore!==1||!requestedGroupKey||best[0].groupKey!==requestedGroupKey)return null;
  if((requestedMethods.length&&!requestedMethods.some(method=>candidateMethods.includes(method)))||(!requestedMethods.length&&candidateMethods.length))return null;
  return {...best[0].candidate,matchKind:'single_record'};
 }
 if(bestScore<1||!requestedGroupKey||best.some(row=>row.groupKey!==requestedGroupKey)||
   !best[0].groupKey||best.some(row=>row.groupKey!==best[0].groupKey))return null;
 const group=best.map(row=>row.candidate);
 const averageGroup=group.map(({sourceId,description,dataType})=>({sourceId,description,dataType}));
 const ids=averageGroup.map(row=>row.sourceId);
 return {
  ...group[0],
  sourceId:'group-average:'+ids.join(','),
  description:`Arithmetic mean of ${group.length} comparable USDA FDC records: ${averageGroup.map(row=>row.description).join(' | ')}`,
  calories:meanCandidateValues(group,'calories'),
  proteinG:meanCandidateValues(group,'proteinG'),
  carbsG:meanCandidateValues(group,'carbsG'),
  fatG:meanCandidateValues(group,'fatG'),
  fiberG:meanCandidateValues(group,'fiberG'),
  saturatedFatG:meanCandidateValues(group,'saturatedFatG'),
  sodiumMg:meanCandidateValues(group,'sodiumMg'),
  matchKind:'group_average',
  averageGroup,
 };
}
async function findEstimatedUsdaSource(client:SupabaseClient,ingredient:string){
 const key=normalized(ingredient);
 let promise=providerCache.get(key);
 if(!promise){
  promise=(async()=>{
   const query=ingredient.replace(/[,;].*$/,'').trim().slice(0,80);
   const data=await searchExternalGenericIngredients(client,query);
   const found=closestEstimatedUsdaIngredient(ingredient,data.results);
   if(!found)providerCache.delete(key);
   return found;
  })().catch(()=>{providerCache.delete(key);return null});
  providerCache.set(key,promise);
  if(providerCache.size>200)providerCache.delete(providerCache.keys().next().value!);
 }
 return promise;
}
export function hasSupportedNutritionVolume(ingredient:string,amount:string):boolean{
 const name=normalized(ingredient),clean=amount.trim();
 const volume=/^(?:about\s+)?(?:\d+\s+)?(?:\d+\/\d+|\d+(?:\.\d+)?|\.\d+)\s*(?:tsp|teaspoons?|tbsp|tablespoons?|cups?)$/i.test(clean);
 return volume&&(Object.prototype.hasOwnProperty.call(APPROX_GRAMS_PER_TSP,name)||
  /^(egg whites?|liquid egg whites?)$/i.test(name));
}
export function hasMeasuredNutritionMass(amount:string):boolean{
 const purchaseAmount=amount.trim().split(/\(\s*target\b/i)[0].trim();
 const range=/^\s*(?:about\s+|approx(?:imately|\.)?\s+)?(?:\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?|\.\d+)\s*[–-]\s*(?:\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?|\.\d+)\s*(?:g|grams?|kg|oz|ounces?|lbs?|pounds?)\b(?:\s+(?:raw|uncooked|dry|cooked|drained|softened|total))?\s*$/i;
 if(range.test(purchaseAmount))return true;
 const single=/^\s*(?:about\s+|approx(?:imately|\.)?\s+)?(?:\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?|\.\d+)\s*(?:g|grams?|kg|oz|ounces?|lbs?|pounds?)\b(?:\s+(?:raw|uncooked|dry|cooked|drained|softened|total|peeled and deveined|cut into [\w\s-]+))?(?:,\s*(?:cut into [\w\s-]+|skin removed if preferred))?\s*$/i;
 return single.test(purchaseAmount);
}
export async function supplementOpenedRecipeNutrition(
 client:SupabaseClient,
 detail:Pick<NativeRecipeDetail,'id'|'servings'|'ingredients'>,
 profiles:readonly CatalogProfile[],
 initial:OpenRecipeNutrition,
):Promise<OpenRecipeNutrition>{
 if(initial.status==='estimated'||initial.missing.length===0)return initial;
 const names=[...new Set(initial.missing)].filter(name=>{
  const row=detail.ingredients.map(recipeNutritionParts).find(item=>item.name===name);
  const amount=row?.amount??'';
  return name.length>=3&&name.length<=80&&!/\bor\b/i.test(name)&&(hasMeasuredNutritionMass(amount)||hasSupportedNutritionVolume(name,amount));
 }).slice(0,PROVIDER_QUERY_LIMIT);
 if(!names.length)return initial;
 const resolved=await Promise.all(names.map(async name=>({name,candidate:await findEstimatedUsdaSource(client,name)})));
 const supplemental:CatalogProfile[]=resolved.filter(v=>v.candidate).map(v=>({
  profile_key:'usda_fdc:'+v.candidate!.sourceId,
  label:v.candidate!.description,
  basis_g:100,calories:v.candidate!.calories,protein_g:v.candidate!.proteinG,
  carbs_g:v.candidate!.carbsG,fat_g:v.candidate!.fatG,
  metadata:{aliases:[v.name],source:'USDA FoodData Central',retrieved_at:v.candidate!.retrievedAt,...(v.candidate!.matchKind==='group_average'?{fdc_ids:v.candidate!.averageGroup?.map(record=>record.sourceId),fdc_average_group:v.candidate!.averageGroup,group_count:v.candidate!.averageGroup?.length,nutrition_resolution:'arithmetic_mean_comparable_group'}:{fdc_id:v.candidate!.sourceId,nutrition_resolution:'single_record'}),estimate_only:true},
 }));
 if(!supplemental.length)return initial;
 const estimated=estimateOpenedRecipeNutrition(detail,[...profiles,...supplemental]);
 const matchedAssumptions=resolved.filter(row=>row.candidate&&!estimated.missing.includes(row.name))
  .map(row=>row.candidate?.matchKind==='group_average'?`${row.name}: estimated using the arithmetic mean of ${row.candidate.averageGroup?.length??0} comparable USDA FoodData Central records (FDC ${row.candidate.averageGroup?.map(record=>record.sourceId).join(', ')??'IDs unavailable'}): ${row.candidate.averageGroup?.map(record=>record.description).join(' | ')??row.candidate.description}`:`${row.name}: generic USDA estimate from ${row.candidate?.description??'USDA record'}`);
 return {...estimated,assumed:[...estimated.assumed,...matchedAssumptions]};

}
