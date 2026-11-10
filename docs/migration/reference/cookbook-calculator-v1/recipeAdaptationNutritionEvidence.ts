import type {NativeProduct} from '../data/foodLogClient';
import type {NativeGenericIngredientCandidate} from '../data/recipeClient';
import {receiptPrintedGtinCandidate} from '../data/shoppingTripClient';

export type CanonicalRecipeNutritionEvidence={
 recipe_id:string;
 recipe_state_version:string|number;
 status:'validated';
 calories_kcal:number;
 protein_g:number;
 provenance:unknown;
};
export type RecipeAdaptationNutritionEvidence={
 recipe_id:string;
 recipe_state_version:string|number;
 before:CanonicalRecipeNutritionEvidence;
 after:CanonicalRecipeNutritionEvidence;
};
export type RecipeAdaptationNutritionDelta=
 |{status:'validated';recipe_id:string;recipe_state_version:string;calorie_savings_kcal:number;protein_delta_g:number;before:CanonicalRecipeNutritionEvidence;after:CanonicalRecipeNutritionEvidence}
 |{status:'insufficient_evidence';recipe_id:string;recipe_state_version:string;reasons:readonly string[]};

function cleanId(v:unknown){return typeof v==='string'?v.trim():'';}
function version(v:unknown){if(typeof v==='number'&&Number.isSafeInteger(v)&&v>=0)return String(v);if(typeof v==='string'&&v.trim())return v.trim();return'';}
function validNutrition(v:CanonicalRecipeNutritionEvidence|undefined){return Boolean(v&&v.status==='validated'&&cleanId(v.recipe_id)&&version(v.recipe_state_version)&&Number.isFinite(v.calories_kcal)&&v.calories_kcal>=0&&Number.isFinite(v.protein_g)&&v.protein_g>=0&&v.provenance!==null&&v.provenance!==undefined);}

/** Derives adaptation deltas only from two validated canonical nutrition states bound to the same exact recipe/version. */
export function deriveRecipeAdaptationNutritionDelta(input:RecipeAdaptationNutritionEvidence):RecipeAdaptationNutritionDelta{
 const recipeId=cleanId(input?.recipe_id),recipeVersion=version(input?.recipe_state_version),reasons:string[]=[];
 if(!recipeId||!recipeVersion)reasons.push('target_identity_required');
 if(!validNutrition(input?.before))reasons.push('validated_before_nutrition_required');
 if(!validNutrition(input?.after))reasons.push('validated_after_nutrition_required');
 if(validNutrition(input?.before)&&(cleanId(input.before.recipe_id)!==recipeId||version(input.before.recipe_state_version)!==recipeVersion))reasons.push('before_nutrition_target_mismatch');
 if(validNutrition(input?.after)&&(cleanId(input.after.recipe_id)!==recipeId||version(input.after.recipe_state_version)!==recipeVersion))reasons.push('after_nutrition_target_mismatch');
 if(reasons.length)return{status:'insufficient_evidence',recipe_id:recipeId,recipe_state_version:recipeVersion,reasons};
 return{status:'validated',recipe_id:recipeId,recipe_state_version:recipeVersion,calorie_savings_kcal:input.before.calories_kcal-input.after.calories_kcal,protein_delta_g:input.after.protein_g-input.before.protein_g,before:input.before,after:input.after};
}


/** Validated ingredient nutrition at an explicitly stated weight basis.
 * Caller must resolve exact food identity, preparation state and source evidence.
 * Generic estimates or an unmatched brand must not be marked validated.
 */
export type RecipeIngredientNutritionProfile={
 profile_key:string;
 preparation_state:string;
 basis_g:number|null;
 /** Exact reviewed label serving: either mass in grams or one counted item. */
 basis_unit:'g'|'each'|'count'|'serving'|'unknown';
 basis_quantity?:number;
 serving_name?:string;
 calories_kcal:number;
 protein_g:number;
 carbs_g:number;
 fat_g:number;
 status:'validated'|'estimated'|'unknown';
 provenance:unknown;
};
export type RecipeIngredientNutritionLine={
 ingredient_id:string;
 profile_key:string;
 preparation_state:string;
 quantity_g?:number;
 quantity_each?:number;
 profile:RecipeIngredientNutritionProfile|undefined;
};
export type RecipeIngredientNutritionCalculation=
 |{status:'validated';recipe_id:string;recipe_state_version:string;servings:number;calories_kcal:number;protein_g:number;carbs_g:number;fat_g:number;batch_totals:Readonly<{calories_kcal:number;protein_g:number;carbs_g:number;fat_g:number}>;measured_edible_weight_g:number|null;per_100g:Readonly<{calories_kcal:number;protein_g:number;carbs_g:number;fat_g:number}>|null;ingredient_count:number;provenance:readonly {ingredient_id:string;profile_key:string;source:unknown}[]}
 |{status:'insufficient_evidence';recipe_id:string;recipe_state_version:string;reasons:readonly string[]};

const validNonnegative=(x:unknown):x is number=>typeof x==='number'&&Number.isFinite(x)&&x>=0;
const validPositive=(x:unknown):x is number=>validNonnegative(x)&&x>0;

/** Pure, no-model, fail-closed nutrition calculation. Returns per-serving totals.
 * Consumes caller-verified ingredient profiles; does not fetch, infer, or publish them.
 * The source/basis identity of each line must already be resolved, including raw vs cooked.
 */
export function calculateValidatedRecipeIngredientNutrition(input:{
 recipe_id:string;
 recipe_state_version:string|number;
 servings:number;
 /** Optional measured edible cooked batch mass, never inferred from raw ingredient weight. */
 measured_edible_weight_g?:number|null;
 ingredients:readonly RecipeIngredientNutritionLine[];
}):RecipeIngredientNutritionCalculation{
 const recipeId=cleanId(input?.recipe_id),recipeVersion=version(input?.recipe_state_version),reasons:string[]=[];
 if(!recipeId||!recipeVersion)reasons.push('target_identity_required');
 if(!Number.isSafeInteger(input?.servings)||input.servings<1)reasons.push('valid_servings_required');
 if(!Array.isArray(input?.ingredients)||input.ingredients.length===0)reasons.push('ingredient_lines_required');
 if(input.measured_edible_weight_g!=null&&!validPositive(input.measured_edible_weight_g))reasons.push('valid_measured_edible_weight_required');
 const seen=new Set<string>();
 const totals={calories_kcal:0,protein_g:0,carbs_g:0,fat_g:0};
 const provenance:{ingredient_id:string;profile_key:string;source:unknown}[]=[];
 for(const [i,line] of (Array.isArray(input?.ingredients)?input.ingredients:[]).entries()){
  const id=cleanId(line?.ingredient_id),key=cleanId(line?.profile_key),state=cleanId(line?.preparation_state),p=line?.profile;
  if(!id||seen.has(id)){reasons.push('missing_or_duplicate_ingredient_identity:'+i);continue;}seen.add(id);
  if(!key||!state){reasons.push('invalid_ingredient_quantity_or_state:'+id);continue;}
  const isCount=p?.basis_unit==='each';
  const validMass=!isCount&&validPositive(line.quantity_g)&&line.quantity_each==null;
  const validCount=isCount&&validPositive(line.quantity_each)&&line.quantity_g==null;
  if(!validMass&&!validCount){reasons.push('invalid_ingredient_quantity_or_state:'+id);continue;}
  if(!p||p.status!=='validated'||key!==cleanId(p.profile_key)||state!==cleanId(p.preparation_state)||
     !(isCount
       ? p.basis_g==null&&p.basis_quantity===1&&Boolean(cleanId(p.serving_name))
       : validPositive(p.basis_g)&&p.basis_unit==='g')||
     !validNonnegative(p.calories_kcal)||!validNonnegative(p.protein_g)||
     !validNonnegative(p.carbs_g)||!validNonnegative(p.fat_g)||
     p.provenance===null||p.provenance===undefined||(typeof p.provenance==='string'&&!p.provenance.trim())){
   reasons.push('validated_matching_profile_required:'+id);continue;
  }
  const weight=isCount ? line.quantity_each!/p.basis_quantity! : line.quantity_g!/p.basis_g!;
  totals.calories_kcal+=p.calories_kcal*weight;
  totals.protein_g+=p.protein_g*weight;
  totals.carbs_g+=p.carbs_g*weight;
  totals.fat_g+=p.fat_g*weight;
  provenance.push({ingredient_id:id,profile_key:key,source:p.provenance});
 }
 if(Object.values(totals).some(value=>!Number.isFinite(value)))reasons.push('finite_batch_nutrition_required');
 if(reasons.length)return{status:'insufficient_evidence',recipe_id:recipeId,recipe_state_version:recipeVersion,reasons};
 const round3=(n:number)=>Math.round(n*1000)/1000;
 const round=(n:number)=>round3(n/input.servings);
 const batchTotals={calories_kcal:round3(totals.calories_kcal),protein_g:round3(totals.protein_g),carbs_g:round3(totals.carbs_g),fat_g:round3(totals.fat_g)};
 const edibleWeight=input.measured_edible_weight_g??null;
 const per100g=edibleWeight?{calories_kcal:round3(totals.calories_kcal/edibleWeight*100),protein_g:round3(totals.protein_g/edibleWeight*100),carbs_g:round3(totals.carbs_g/edibleWeight*100),fat_g:round3(totals.fat_g/edibleWeight*100)}:null;
 return{status:'validated',recipe_id:recipeId,recipe_state_version:recipeVersion,servings:input.servings,
  calories_kcal:round(totals.calories_kcal),protein_g:round(totals.protein_g),
  carbs_g:round(totals.carbs_g),fat_g:round(totals.fat_g),batch_totals:batchTotals,
  measured_edible_weight_g:edibleWeight,per_100g:per100g,
  ingredient_count:input.ingredients.length,provenance};
}

/** Computes nutrition for a measured portion of a validated cooked batch.
 * Uses the frozen batch totals and its measured edible mass; never guesses yield.
 */
export function calculateValidatedWeighedPortionNutrition(
 batch:RecipeIngredientNutritionCalculation,
 portion_weight_g:number,
):{status:'validated';calories_kcal:number;protein_g:number;carbs_g:number;fat_g:number;portion_weight_g:number}|
  {status:'insufficient_evidence';reasons:readonly string[]}{
 if(batch.status!=='validated'||!validPositive(batch.measured_edible_weight_g))
  return{status:'insufficient_evidence',reasons:['measured_validated_batch_required']};
 if(!validPositive(portion_weight_g)||portion_weight_g>batch.measured_edible_weight_g)
  return{status:'insufficient_evidence',reasons:['valid_measured_portion_weight_required']};
 const factor=portion_weight_g/batch.measured_edible_weight_g;
 const round3=(value:number)=>Math.round(value*factor*1000)/1000;
 return {status:'validated',portion_weight_g,
  calories_kcal:round3(batch.batch_totals.calories_kcal),
  protein_g:round3(batch.batch_totals.protein_g),
  carbs_g:round3(batch.batch_totals.carbs_g),
  fat_g:round3(batch.batch_totals.fat_g)};
}

/** Creates user-reviewed as-sold 100g evidence from the EXISTING branded Food
 * lookup. No external nutrition is globally promoted by this per-user review.
 * Cooking-state conversions must be independently confirmed; never reuse
 * as-sold package macros as per-100g cooked food without yield evidence.
 */
export function createReviewedPantryProductProfile(input:{
 pantryBarcode:string|null;
 product:NativeProduct;
 labelReviewed:boolean;
 preparationState:'as_sold'|'raw'|'cooked';
}):RecipeIngredientNutritionProfile|undefined{
 const product=input?.product;
 const barcode=receiptPrintedGtinCandidate(input?.pantryBarcode,true);
 const perItem=product?.nutritionBasis==='serving'
   ? /^1\s+(tortilla|wrap|slice|piece|egg|bar|bun|roll|bagel|each)(?:s)?(?=\s*(?:\(|$))/i.exec(product.portion.trim())
   : null;
 if(input?.labelReviewed!==true||input.preparationState!=='as_sold'||!barcode||
    product?.barcode!==barcode||(product.nutritionBasis!=='100g'&&!perItem)||
    !validNonnegative(product.calories)||!validNonnegative(product.proteinG)||
    !validNonnegative(product.carbsG)||!validNonnegative(product.fatG)||
    product.calories>1000||product.proteinG>110||product.carbsG>110||product.fatG>110)return undefined;
 return {
  profile_key:'barcode:'+barcode,preparation_state:'as_sold',
  basis_g:perItem?null:100,basis_unit:perItem?'each':'g',
  ...(perItem?{basis_quantity:1,serving_name:perItem[1].toLowerCase()}:{}),
  calories_kcal:product.calories,protein_g:product.proteinG,carbs_g:product.carbsG,fat_g:product.fatG,
  status:'validated',
  provenance:{kind:'user_label_reviewed',barcode,brand:product.brand??null,provider:product.source??'user_label_manual'},
 };
}

/** A reviewed USDA reference is a source-bound calculation input, not
 * a packaged GTIN and not a duplicate ingredient nutrition catalog.
 * The actual user must confirm both food identity and raw/cooked state.
 */
export function createReviewedGenericIngredientProfile(input:{
 ingredientKey:string;
 candidate:NativeGenericIngredientCandidate;
 preparationState:'raw'|'cooked';
 identityReviewed:boolean;
 preparationReviewed:boolean;
}):RecipeIngredientNutritionProfile|undefined{
 const key=cleanId(input?.ingredientKey),c=input?.candidate;
 if(!key||!c||input.identityReviewed!==true||input.preparationReviewed!==true||
    !['raw','cooked'].includes(input.preparationState)||
    c.source!=='usda_fdc'||!/^\d{1,12}$/.test(c.sourceId)||
    !['Foundation','SR Legacy'].includes(c.dataType)||
    c.basisUnit!=='g'||c.basisG!==100||c.usable!==true||
    !c.retrievedAt||!Number.isFinite(Date.parse(c.retrievedAt))||
    !c.description.trim()||c.sourceLicense!=='USDA FoodData Central / CC0 1.0'||
    (input.preparationState==='raw'&&/\b(cooked|roasted|baked|boiled|fried|grilled|steamed)\b/i.test(c.description))||
    (input.preparationState==='cooked'&&/\b(raw|uncooked)\b/i.test(c.description))||
    !validNonnegative(c.calories)||!validNonnegative(c.proteinG)||
    !validNonnegative(c.carbsG)||!validNonnegative(c.fatG)||
    c.calories>1000||c.proteinG>100||c.carbsG>100||c.fatG>100)return undefined;
 return {profile_key:'usda_fdc:'+c.sourceId+':'+input.preparationState,preparation_state:input.preparationState,
   basis_g:100,basis_unit:'g',calories_kcal:c.calories,protein_g:c.proteinG,
   carbs_g:c.carbsG,fat_g:c.fatG,status:'validated',
   provenance:{kind:'provider_reference_reviewed',provider:'usda_fdc',
     source_id:c.sourceId,description:c.description,data_type:c.dataType,
     retrieved_at:c.retrievedAt,source_license:c.sourceLicense,
     preparation_state:input.preparationState}};
}

