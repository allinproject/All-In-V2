'use strict';
// ALL-225 / ALL-228: join source normalization, source-identity evidence and
// founder-approved alias/form policy. An admission PASS is not a writer grant.
const {validateFdcNutrients,ENERGY_POLICY_VERSION,REQUIRED_SET_VERSION}=require('./check-v2-usda-nutrient-policy.cjs');
const {reviewSourceBindings,reviewAliasAndPreparationAcceptance}=require('./review-v2-ingredient-identities.cjs');
function reviewUsdaAdmission(input){
  const issues=[],flag=x=>{if(!issues.includes(x))issues.push(x)};
  if(!input||!input.aliasPolicy||!input.sourceBindings||!input.sourceEvidence||
      !Array.isArray(input.sourceFoods))
    return {status:'review_required',issues:['missing_source_review_context'],
      authorizedToWrite:false,calculationReady:false,publicationApproved:false};
  const sourceCheck=reviewSourceBindings(input.sourceBindings,input.sourceEvidence);
  const aliasCheck=reviewAliasAndPreparationAcceptance(input.aliasPolicy,input.sourceBindings);
  for(const r of sourceCheck.issues) flag('binding:'+r.code);
  for(const r of aliasCheck.issues) flag('alias:'+r.code);
  const aliases=new Map(input.aliasPolicy.records.map(r=>[r.source_profile_key,r]));
  const bindings=new Map(input.sourceBindings.bindings.map(r=>[r.source_profile_key,r]));
  const sourceMap=new Map(input.sourceEvidence.records.map(r=>[r.profile,r]));
  const seen=new Set();
  const stages=[];
  for(const food of input.sourceFoods){
    const key=food?.source_profile_key;
    if(!key||seen.has(key)){flag('duplicate_or_invalid_source_food');continue}
    seen.add(key);
    const binding=bindings.get(key),alias=aliases.get(key),evidence=sourceMap.get(key);
    if(!binding||!alias||!evidence){flag('unknown_source_food:'+key);continue}
    const ref=binding.reviewed_source_reference;
    const sourceReferenceMatch=food.provider==='usda_fdc'&&
      food.dataType==='Foundation'&&
      String(food.fdcId)===ref.external_record_id&&
      food.source_description===ref.source_food_description&&
      food.archive_sha256===input.sourceEvidence.archiveSha256;
    if(!sourceReferenceMatch)flag('source_provenance_mismatch:'+key);
    // Raw archive bytes are verified separately by the pinned USDA verifier.
    // This review-only join must still reject a missing or drifted per-food
    // digest. Comparing two manifest fields is not itself archive verification.
    const reviewedDigest=binding.nutrition_evidence?.source_payload_sha256_verified;
    const sourceDigestMatch=typeof food.payload_sha256==='string'&&
      /^[a-f0-9]{64}$/.test(food.payload_sha256)&&
      typeof reviewedDigest==='string'&&
      /^[a-f0-9]{64}$/.test(reviewedDigest)&&
      food.payload_sha256===reviewedDigest;
    if(!sourceDigestMatch)flag('source_digest_reference_mismatch:'+key);
    // Scope sodium to the reviewed food form rather than arbitrary caller input.
    const normalized=validateFdcNutrients({
      provider:food.provider,dataType:food.dataType,fdcId:food.fdcId,
      basis_quantity:food.basis_quantity,basis_unit:food.basis_unit,
      foodNutrients:food.foodNutrients,require_sodium:true
    });
    if(normalized.issues.length)for(const reason of normalized.issues)
      flag('nutrient:'+key+':'+reason);
    const energyMethodMatch=normalized.chosenEnergyNutrientId===
      binding.nutrition_evidence.energy_source_nutrient_id&&
      normalized.energyPolicyVersion===ENERGY_POLICY_VERSION&&
      normalized.coverage?.required_core_version===REQUIRED_SET_VERSION;
    if(!energyMethodMatch)flag('energy_method_or_version_mismatch:'+key);
    // Snapshot summary is a review check, never a substitute for full source
    // nutrients; compare stated values to detect wrong or mismatched fixture.
    const facts=normalized.facts||{};
    const sourceValueMatch=facts.energy_kcal===evidence.energy.kcal&&
      facts.protein_g===evidence.protein&&
      facts.carbohydrate_g===evidence.carbs&&
      facts.total_fat_g===evidence.fat&&
      facts.sodium_mg===evidence.sodiumMg;
    if(!sourceValueMatch)flag('source_value_mismatch:'+key);
    stages.push({
      source_profile_key:key,fdc_id:String(food.fdcId),
      proposed_display_name:alias.display_name,proposed_preparation_state:alias.preparation_state,
      source_method:normalized.chosenEnergyMethod||null,
      energy_policy_version:ENERGY_POLICY_VERSION,nutrient_set_version:REQUIRED_SET_VERSION,
      reviewed_nutrient_candidates:facts, // REVIEW-ONLY; never seed or publish
      source_preflight_pass:sourceReferenceMatch&&sourceDigestMatch&&
        energyMethodMatch&&sourceValueMatch&&normalized.issues.length===0,
      canonical_identity_id:null,profile_review_status:'needs_review',
      calculationReady:false,authorizedToWrite:false
    });
  }
  if(seen.size!==bindings.size)flag('incomplete_source_food_coverage');
  return {status:issues.length?'review_required':'review_stage_complete',
    issues,sourceRows:stages,sourceCount:seen.size,
    sourcePolicyVersion:ENERGY_POLICY_VERSION,requiredNutrientSetVersion:REQUIRED_SET_VERSION,
    sourceContractValidated:sourceCheck.structuralEvidencePassed,
    aliasContractValidated:aliasCheck.structuralScopePassed,
    authorizedToWrite:false,calculationReady:false,publicationApproved:false,
    profileWriterApprovalRequired:true};
}
module.exports={reviewUsdaAdmission};
