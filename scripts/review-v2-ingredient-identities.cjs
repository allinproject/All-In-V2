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
    const aliases=[record.canonical_name,...(Array.isArray(record.aliases)?record.aliases:[])];
    for(const alias of aliases) {
      const name=normalize(alias);
      if(name) add(labels,JSON.stringify([name,record.locale||'en',record.preparation_state||null]),id);
    }
    if(Array.isArray(record.sources)) for(const source of record.sources) {
      if(!source || typeof source!=='object'||!normalize(source.provider)||!normalize(source.external_record_id)) {
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
module.exports={normalize,review};
if(require.main===module) {
  const fs=require('node:fs'),file=process.argv[2];
  if(!file) {console.error('Usage: node scripts/review-v2-ingredient-identities.cjs candidates.json');process.exitCode=2;}
  else try {
    const result=review(JSON.parse(fs.readFileSync(file,'utf8')));
    console.log(JSON.stringify(result,null,2));
    if(!result.structuralPreflightPassed) process.exitCode=1;
  } catch(error) {console.error(error.message);process.exitCode=2;}
}
