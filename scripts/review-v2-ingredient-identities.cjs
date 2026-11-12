#!/usr/bin/env node
'use strict';
// ALL-228 identity candidate preflight: in-memory validation only. No SQL, writes,
// provider requests or publishing; never creates V2 IDs from source IDs.
function normalize(value) {
  return typeof value==='string' ? value.normalize('NFKC').trim().toLocaleLowerCase('en-US').replace(/\s+/g,' ') : '';
}
const STATES=new Set(['raw','cooked','cooked_drained','dry','as_sold','prepared']);
const KINDS=new Set(['generic_food','branded_product']);
function review(candidates) {
  if (!Array.isArray(candidates)) throw Error('expected candidate array');
  const issues=[],keys=new Set(),labels=new Map(),sourceRefs=new Map();
  const flag=(id,code)=>issues.push({source_profile_key:id,code});
  const add=(map,token,id)=>{
    const set=map.get(token)||new Set();set.add(id);map.set(token,set);
  };
  for (const record of candidates) {
    if (!record || typeof record!=='object' || Array.isArray(record)) {
      flag(null,'invalid_candidate');continue;
    }
    const id=record.source_profile_key;
    if(typeof id!=='string'||!id.trim()) {flag(null,'missing_source_profile_key');continue;}
    if(keys.has(id)) flag(id,'duplicate_source_profile_key');
    keys.add(id);
    // Identity vs nutrition evidence are different stages. Never promote legacy
    // review statuses or historic numeric values into calculation_ready.
    if(!normalize(record.canonical_name)) flag(id,'missing_canonical_name');
    if(!KINDS.has(record.identity_kind)) flag(id,'identity_kind_unresolved');
    if(!STATES.has(record.preparation_state)) flag(id,'preparation_state_unresolved');
    if(record.identity_kind==='branded_product' && !normalize(record.brand_owner))
      flag(id,'branded_source_requires_brand_review');
    if(record.canonical_v2_id != null) flag(id,'v2_identity_assignment_requires_approved_writer');
    if(record.aliases != null && (!Array.isArray(record.aliases) ||
      record.aliases.some(alias=>!normalize(alias)))) flag(id,'invalid_alias_set');
    if(typeof record.locale!=='string' || !/^[a-z]{2}(?:-[A-Z]{2})?$/.test(record.locale))
      flag(id,'locale_scope_unresolved');
    const aliases=[record.canonical_name,...(Array.isArray(record.aliases)?record.aliases:[])];
    for(const alias of aliases) {
      const name=normalize(alias);
      if(name) add(labels,JSON.stringify([name,record.locale||'en',record.preparation_state||null]),id);
    }
    if(Array.isArray(record.sources)) for(const source of record.sources) {
      if(!source || typeof source!=='object'||!normalize(source.provider)||
         !normalize(source.source_data_type)||!normalize(source.external_record_id)) {
        flag(id,'invalid_source_reference');continue;
      }
      const ref=JSON.stringify([source.provider,source.source_data_type,source.external_record_id]);
      add(sourceRefs,ref,id);
      if(source.gtin != null && (typeof source.gtin!=='string'||!/^[0-9]{8,14}$/.test(source.gtin)))
        flag(id,'invalid_gtin_preserve_exact_text');
    }
    if(record.review_status==='calculation_ready') flag(id,'candidate_must_not_self_attest_calculation_ready');
  }
  const ambiguities=[];
  for(const [token,profiles] of labels) if(profiles.size>1)
    ambiguities.push({token,sourceProfiles:[...profiles].sort(),kind:'alias_scope_conflict'});
  for(const [token,profiles] of sourceRefs) if(profiles.size>1)
    ambiguities.push({token,sourceProfiles:[...profiles].sort(),kind:'source_reference_conflict'});
  ambiguities.sort((a,b)=>a.kind.localeCompare(b.kind)||a.token.localeCompare(b.token));
  return {candidateCount:candidates.length,validForAutomaticMerge:false,
    calculationReady:false,publicationApproved:false,issues,ambiguities,
    requiresReviewer:true,structuralPreflightPassed:issues.length===0 && ambiguities.length===0};
}

function reviewSourceBindings(bindingDocument, sourceEvidence) {
  const issues=[], flag=(key,code)=>issues.push({source_profile_key:key,code});
  if(!bindingDocument || !Array.isArray(bindingDocument.bindings) ||
     !sourceEvidence || !Array.isArray(sourceEvidence.records))
    throw Error('source bindings and evidence records required');
  const sourceByKey=new Map(sourceEvidence.records.map(r=>[r.profile,r]));
  const usedKeys=new Set(),usedSourceIds=new Set();
  if(bindingDocument.sourceEvidenceArchiveSha256!==sourceEvidence.archiveSha256)
    flag(null,'archive_hash_mismatch');
  if(bindingDocument.calculationReady!==false ||
     bindingDocument.approvedForPublication!==false ||
     bindingDocument.authorizedToWrite!==false ||
     bindingDocument.reviewState!=='needs_review')
    flag(null,'source_review_must_remain_unapproved');
  for(const binding of bindingDocument.bindings) {
    if(!binding || typeof binding!=='object') {flag(null,'invalid_binding');continue;}
    const key=binding.source_profile_key,source=sourceByKey.get(key);
    if(typeof key!=='string'||usedKeys.has(key)) {flag(key,'duplicate_or_missing_source_profile_key');continue;}
    usedKeys.add(key);
    if(!source) {flag(key,'missing_reviewed_source_record');continue;}
    const ref=binding.reviewed_source_reference||{};
    if(ref.provider!=='usda_fdc'||ref.source_data_type!=='Foundation'||
       ref.external_record_id!==String(source.fdcId)||
       ref.source_url!=='https://fdc.nal.usda.gov/food-details/'+source.fdcId+'/nutrients'||
       ref.source_food_description!==source.source)
      flag(key,'source_reference_mismatch');
    if(usedSourceIds.has(ref.external_record_id)) flag(key,'duplicate_fdc_binding');
    usedSourceIds.add(ref.external_record_id);
    const nutrients=binding.nutrition_evidence||{};
    if(nutrients.basis_quantity!==100||nutrients.basis_unit!=='g'||
       nutrients.energy_source_nutrient_id!==Number(source.energy.code)||
       nutrients.alternative_energy_source_nutrient_id!==(source.energy.alternative?Number(source.energy.alternative.code):null)||
       nutrients.energy_selection_status!=='pending_ALL-225_energy_policy'||
       nutrients.nutrient_values_review_status!=='source_transcribed_not_calculation_ready')
      flag(key,'nutrient_basis_or_energy_provenance_mismatch');
    if(binding.proposed_identity_kind!=='generic_food' ||
       !STATES.has(binding.proposed_preparation_state) ||
       !Array.isArray(binding.source_form_qualifiers)||!binding.source_form_qualifiers.length||
       typeof binding.alias_scope_review!=='string'||!binding.alias_scope_review ||
       binding.identity_approval!=='pending_reviewer'||binding.profile_approval!=='pending_reviewer'||
       binding.canonical_v2_id!==null || binding.source_identity_verified_for_review!==true)
      flag(key,'unreviewed_identity_or_alias_scope');
    const conv=binding.conversion_review;
    if(!conv || conv.household_and_purchase_yields_approved!==false ||
       JSON.stringify(conv.source_food_portion_evidence)!==JSON.stringify(source.portionEvidence))
      flag(key,'measurement_evidence_or_yield_override');
    if(!Array.isArray(binding.review_caveats) || !binding.review_caveats.length)
      flag(key,'missing_restriction_review');
  }
  if(usedKeys.size!==sourceByKey.size)
    flag(null,'reviewed_source_coverage_mismatch');
  return {bindingCount:bindingDocument.bindings.length,reviewedSourceCount:sourceByKey.size,
    issues,structuralEvidencePassed:issues.length===0,identityApproved:false,
    calculationReady:false,publicationApproved:false,authorizedToWrite:false};
}

module.exports={normalize,review,reviewSourceBindings};
if(require.main===module) {
  const fs=require('node:fs'),file=process.argv[2];
  if(!file) {console.error('Usage: node scripts/review-v2-ingredient-identities.cjs candidates.json');process.exitCode=2;}
  else try {
    const result=review(JSON.parse(fs.readFileSync(file,'utf8')));
    console.log(JSON.stringify(result,null,2));
    if(!result.structuralPreflightPassed) process.exitCode=1;
  } catch(error) {console.error(error.message);process.exitCode=2;}
}
