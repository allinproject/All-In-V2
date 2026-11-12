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


function reviewAliasAndPreparationAcceptance(aliasDocument, bindingsDocument) {
  if(!aliasDocument || !Array.isArray(aliasDocument.records) ||
     !bindingsDocument || !Array.isArray(bindingsDocument.bindings))
    throw Error('alias and source binding review records required');
  const issues=[],flag=(key,code)=>issues.push({source_profile_key:key,code});
  // Founder-approved product policy: this is NOT an identity/nutrition approval.
  // Pin allowed exact names and forbidden in-profile suggestions so a later
  // source change cannot quietly widen which nutrition profile a phrase selects.
  const approved=new Map([
    ['milk_cottage_2pct',{name:'2% Cottage Cheese — Generic',state:'prepared',
      exact:['cottage cheese, lowfat, 2% milkfat','2% milkfat cottage cheese, generic'],
      search:['cottage cheese','2% cottage cheese'],excluded:['Daisy cottage cheese']}],
    ['red_onion_raw',{name:'Red Onion — Raw',state:'raw',
      exact:['red onion, raw edible portion','onions, red, raw'],
      search:['red onion','diced red onion'],excluded:['yellow onion','cooked red onion']}],
    ['cabbage_green_raw',{name:'Green Cabbage — Raw',state:'raw',
      exact:['green cabbage, raw','cabbage, green, raw'],
      search:['green cabbage','shredded cabbage'],excluded:['cabbage, cooked','1 cup chopped green cabbage']}],
    ['black_beans_canned_drained',{name:'Black Beans — Canned, Drained & Rinsed, Sodium Added',state:'cooked_drained',
      exact:['black beans, canned, sodium added, drained and rinsed'],
      search:['black beans','canned black beans','black beans, drained'],excluded:['unsalted black beans','dry black beans']}],
    ['chickpeas_canned_drained_rinsed',{name:'Chickpeas — Canned, Drained & Rinsed, Sodium Added',state:'cooked_drained',
      exact:['chickpeas, canned, sodium added, drained and rinsed','garbanzo beans, canned, sodium added, drained and rinsed'],
      search:['chickpeas','canned chickpeas','garbanzo beans'],excluded:['dried chickpeas']}],
    ['beans_kidney_canned_drained',{name:'Kidney Beans — Dark Red, Canned, Sodium & Sugar Added, Drained & Rinsed',state:'cooked_drained',
      exact:['kidney beans, dark red, canned, sodium added, sugar added, drained and rinsed'],
      search:['kidney beans','canned kidney beans','dark red kidney beans','kidney beans, drained'],excluded:[]}],
    ['tomato_paste_canned_unsalted',{name:'Tomato Paste — Canned, No Salt Added',state:'prepared',
      exact:['tomato paste, canned, without salt added'],
      search:['tomato paste','tomato paste, unsalted'],excluded:['double concentrated tomato paste','salted tomato paste']}],
    ['tomatoes_crushed_canned',{name:'Crushed Tomatoes — Canned, Generic',state:'prepared',
      exact:['tomatoes, crushed, canned','crushed tomatoes, canned, generic'],
      search:['crushed tomatoes','canned tomatoes'],excluded:['tomato sauce','unsalted crushed tomatoes']}]
  ]);
  const refs=new Map(bindingsDocument.bindings.map(b=>[b.source_profile_key,b]));
  const seenKeys=new Set(),exactNames=new Map();
  if(aliasDocument.authoritativeSource!=='docs/evidence/ALL-228-EIGHT-REVIEWED-SOURCE-BINDINGS-2026-11-12.json' ||
     aliasDocument.canonicalIdentityApproved!==false||aliasDocument.calculationReady!==false||
     aliasDocument.publicationApproved!==false||aliasDocument.writeAuthorized!==false||
     aliasDocument.status!=='founder_approved_alias_and_preparation_policy_only'||
     aliasDocument.stage!=='founder_approved_product_policy_review_contract'||
     aliasDocument.product_policy_approval?.issue!=='ALL-228'||
     aliasDocument.product_policy_approval?.linear_comment_id!=='15ed915f-973d-4deb-84ae-cfbafe97103e')
     flag(null,'alias_document_claims_unapproved_authority');
  for(const record of aliasDocument.records) {
    if(!record || typeof record!=='object'){flag(null,'invalid_alias_record');continue;}
    const key=record.source_profile_key;
    if(typeof key!=='string'||seenKeys.has(key)){flag(key,'duplicate_or_invalid_source_key');continue;}
    seenKeys.add(key);
    const bound=refs.get(key);
    if(!bound){flag(key,'unrecognized_source_key');continue;}
    const policy=approved.get(key);
    if(!policy){flag(key,'unapproved_product_identity');continue;}
    const normalized=(items)=>items.map(x=>normalize(x)).sort().join('|');
    const actualExact=(record.exact_alias_candidates||[]).map(a=>a?.value);
    if(record.display_name!==policy.name || record.preparation_state!==policy.state ||
      record.product_policy_status!=='approved_display_name_preparation_and_alias_scope' ||
      record.preparation_state_policy_status!=='approved_product_classification_only' ||
      normalized(actualExact)!==normalized(policy.exact))
      flag(key,'approved_display_name_state_or_exact_alias_changed');
    if(record.source_fdc_id!==bound.reviewed_source_reference.external_record_id||
       record.source_description!==bound.reviewed_source_reference.source_food_description||
       record.preparation_state!==bound.proposed_preparation_state||
       record.identity_kind!==bound.proposed_identity_kind||
       record.locale!=='en'||
       record.canonical_identity_approved!==false||
       record.profile_calculation_ready!==false||
       record.approved_for_publication!==false)
      flag(key,'source_identity_or_preparation_scope_mismatch');
    if(!Array.isArray(record.exact_alias_candidates)||!record.exact_alias_candidates.length||
       !Array.isArray(record.search_only_not_exact_aliases)||!Array.isArray(record.incompatible_form_conditions)||
       !record.incompatible_form_conditions.length||typeof record.review_note!=='string')
      flag(key,'missing_alias_scope_or_form_restrictions');
    const exactSet=new Set(),searchSet=new Set();
    for(const a of record.exact_alias_candidates||[]) {
      const name=normalize(a?.value);
      if(!name || exactSet.has(name)||a.kind!=='source_scoped_exact'||
         a.preparation_state!==record.preparation_state||
         a.selection_scope!=='requires_explicit_source_form_confirmation'||
         a.status!=='founder_approved_source_scoped_alias_policy')
        flag(key,'invalid_or_duplicate_exact_alias');
      exactSet.add(name);
      const scope=JSON.stringify([name,record.locale,record.preparation_state]);
      const previous=exactNames.get(scope);
      if(previous&&previous!==key) flag(key,'cross_source_exact_alias_collision');
      exactNames.set(scope,key);
    }
    if(normalized((record.search_only_not_exact_aliases||[]).map(a=>a?.value))!==normalized(policy.search))
      flag(key,'approved_search_only_scope_changed');
    const excluded=(record.excluded_incompatible_queries||[]);
    if(!Array.isArray(record.excluded_incompatible_queries) ||
      normalized(excluded.map(x=>x?.value))!==normalized(policy.excluded))
      flag(key,'incompatible_form_exclusion_changed');
    const excludedSet=new Set();
    for(const a of excluded) {
      const name=normalize(a?.value);
      if(!name || excludedSet.has(name) ||
         a.behavior!=='exclude_from_this_profile_targeted_search_route_to_separate_food_search')
        flag(key,'invalid_incompatible_form_exclusion');
      excludedSet.add(name);
      if(exactSet.has(name)) flag(key,'incompatible_form_used_as_exact_alias');
    }
    for(const a of record.search_only_not_exact_aliases||[]) {
      const name=normalize(a?.value);
      if(!name||searchSet.has(name)||a.behavior!=='search_only_requires_user_or_reviewer_form_selection')
        flag(key,'invalid_search_only_alias');
      searchSet.add(name);
      if(exactSet.has(name)) flag(key,'search_only_alias_promoted_to_exact');
      if(excludedSet.has(name)) flag(key,'incompatible_form_reentered_targeted_search');
    }
  }
  if(seenKeys.size!==refs.size || seenKeys.size!==approved.size)
    flag(null,'incomplete_source_alias_coverage');
  return {recordCount:aliasDocument.records.length,sourceBindingCount:refs.size,
    issues,structuralScopePassed:issues.length===0,
    canonicalIdentityApproved:false,calculationReady:false,publicationApproved:false,
    writeAuthorized:false,requiresDomainOwnerAcceptance:true};
}

// ALL-228 automatic candidate preflight reuses BOTH existing identity and
// USDA nutrition validators. It is intentionally read-only and never grants
// canonical identity, writer permission, or publication authority.
function assessAutomaticSourceEvidence(candidates,documents) {
  if(!Array.isArray(candidates)||!Array.isArray(documents))
    throw Error('identity candidates and exact source documents required');
  const {createHash}=require('node:crypto');
  const {validateFdcNutrients}=require('./check-v2-usda-nutrient-policy.cjs');
  const identity=review(candidates);
  const byKey=new Map(),duplicateKeys=new Set();
  for(const document of documents) {
    const key=document?.source_profile_key;
    if(typeof key!=='string'||!key.trim()) {duplicateKeys.add(null);continue;}
    if(byKey.has(key))duplicateKeys.add(key);
    else byKey.set(key,document);
  }
  const results=candidates.map(candidate=>{
    const key=candidate?.source_profile_key??null;
    const issues=[];
    const add=code=>{if(!issues.includes(code))issues.push(code)};
    for(const issue of identity.issues)
      if(issue.source_profile_key===key||issue.source_profile_key===null)add('identity:'+issue.code);
    for(const conflict of identity.ambiguities)
      if(conflict.sourceProfiles.includes(key))add('identity:'+conflict.kind);
    if(typeof key!=='string'||!key.trim())add('invalid_source_profile_key');
    const reference=candidate?.sources;
    if(!Array.isArray(reference)||reference.length!==1||
       reference[0]?.provider!=='usda_fdc'||reference[0]?.source_data_type!=='Foundation'||
       !/^[1-9][0-9]*$/.test(String(reference[0]?.external_record_id||'')))
      add('requires_single_foundation_source_reference');
    if(duplicateKeys.has(key))add('duplicate_source_document');
    const document=byKey.get(key);
    if(!document) add('missing_source_document');
    else if(typeof document.payload_utf8!=='string'||
            typeof document.payload_sha256!=='string'||
            !/^[a-f0-9]{64}$/i.test(document.payload_sha256))add('invalid_source_payload_evidence');
    else {
      const digest=createHash('sha256').update(document.payload_utf8,'utf8').digest('hex');
      if(digest!==document.payload_sha256.toLowerCase())add('source_payload_sha256_mismatch');
      let parsed=null;
      try{parsed=JSON.parse(document.payload_utf8)}catch{add('unparseable_source_payload')}
      if(parsed===null||typeof parsed!=='object'||Array.isArray(parsed))
        add('invalid_source_payload_object');
      else {
        if(reference?.length===1 &&
           (parsed?.provider!==reference[0].provider ||
            parsed?.dataType!==reference[0].source_data_type ||
            String(parsed?.fdcId)!==reference[0].external_record_id))
          add('source_reference_payload_mismatch');
        const nutrition=validateFdcNutrients(parsed);
        for(const issue of nutrition.issues)add('nutrition:'+issue);
      }
    }
    issues.sort();
    return {source_profile_key:key,automatedChecksPassed:issues.length===0,
      exceptionQueueRequired:issues.length>0,issues,
      canonicalIdentityApproved:false,calculationReady:false,
      publicationApproved:false,authorizedToWrite:false};
  });
  for(const key of byKey.keys())
    if(!candidates.some(candidate=>candidate?.source_profile_key===key))
      results.push({source_profile_key:key,automatedChecksPassed:false,
        exceptionQueueRequired:true,issues:['orphan_source_document'],
        canonicalIdentityApproved:false,calculationReady:false,
        publicationApproved:false,authorizedToWrite:false});
  if(duplicateKeys.has(null))results.push({source_profile_key:null,
    automatedChecksPassed:false,exceptionQueueRequired:true,
    issues:['invalid_source_document_key'],canonicalIdentityApproved:false,
    calculationReady:false,publicationApproved:false,authorizedToWrite:false});
  results.sort((a,b)=>String(a.source_profile_key).localeCompare(String(b.source_profile_key)));
  return {candidateCount:candidates.length,documentCount:documents.length,
    automaticPreflightPassed:candidates.length>0&&results.length===candidates.length&&results.every(r=>r.automatedChecksPassed),
    results,calculationReady:false,publicationApproved:false,authorizedToWrite:false};
}

module.exports={normalize,review,reviewSourceBindings,reviewAliasAndPreparationAcceptance,assessAutomaticSourceEvidence};
if(require.main===module) {
  const fs=require('node:fs'),file=process.argv[2];
  if(!file) {console.error('Usage: node scripts/review-v2-ingredient-identities.cjs candidates.json');process.exitCode=2;}
  else try {
    const result=review(JSON.parse(fs.readFileSync(file,'utf8')));
    console.log(JSON.stringify(result,null,2));
    if(!result.structuralPreflightPassed) process.exitCode=1;
  } catch(error) {console.error(error.message);process.exitCode=2;}
}
