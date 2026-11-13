'use strict';
// ALL-228/225: trusted server-only orchestration of the EXISTING canonical
// catalog's private seed function. No new catalog, SQL table DML or publication.
// SourceFoods MUST originate from the pinned official USDA ZIP verifier;
// admission independently joins reviewed FDC digests, nutrient facts and forms.
const {createHash}=require('node:crypto');
const {reviewUsdaAdmission}=require('./review-v2-usda-source-admission.cjs');
const RELEASE_CORE='SELECT allin_private.v2_release_ingredient_source_core($1::text,$2::text,$3::text,$4::jsonb) AS result';
const INSERT_CANDIDATE='SELECT allin_private.v2_seed_ingredient_candidate($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text,$6::text,$7::text,$8::text,$9::text,$10::text,$11::text,$12::jsonb) AS result';
function stableId(kind,sourceKey,fdc){
 const bytes=createHash('sha256').update(JSON.stringify([
  'ALL-228 canonical USDA identity v1',kind,sourceKey,String(fdc)
 ])).digest().subarray(0,16);
 bytes[6]=(bytes[6]&15)|0x50;bytes[8]=(bytes[8]&63)|0x80;
 const h=bytes.toString('hex');
 return [h.slice(0,8),h.slice(8,12),h.slice(12,16),h.slice(16,20),h.slice(20)].join('-');
}
function planInitialUSDASeed({sourceFoods,sourceBindings,sourceEvidence,aliasPolicy}){
 const review=reviewUsdaAdmission({sourceFoods,sourceBindings,sourceEvidence,aliasPolicy});
 if(review.status!=='review_stage_complete'||!review.sourceContractValidated||
    !review.aliasContractValidated||!Array.isArray(review.qualificationQueue)||
    !review.qualificationQueue.length||review.exceptionReviewCount!==0||
    review.qualificationQueue.length!==sourceEvidence.records.length||
    review.qualificationQueue.some(r=>r.route!=='automatic_qualification'))
  throw Error('Initial canonical seed blocked by USDA source or form exception');
 const byEvidence=new Map(sourceEvidence.records.map(r=>[r.profile,r]));
 const byAlias=new Map(aliasPolicy.records.map(r=>[r.source_profile_key,r]));
 const byFood=new Map(sourceFoods.map(r=>[r.source_profile_key,r]));
 const rows=review.qualificationQueue.map(r=>{
  const e=byEvidence.get(r.source_profile_key),a=byAlias.get(r.source_profile_key),
   f=byFood.get(r.source_profile_key);
  if(!e||!a||!f||String(e.fdcId)!==String(f.fdcId)||
     a.source_fdc_id!==String(f.fdcId)||!a.display_name||!a.preparation_state)
   throw Error('Canonical source identity or food form mismatch');
  const values={energy_kcal:e.energy.kcal,protein_g:e.protein,
   carbohydrate_g:e.carbs,total_fat_g:e.fat,sodium_mg:e.sodiumMg};
  if(Object.values(values).some(n=>typeof n!=='number'||!Number.isFinite(n)||n<0))
   throw Error('Canonical source missing finite USDA nutrient');
  const digest=f.payload_sha256,archive=sourceEvidence.archiveSha256;
  if(!/^[a-f0-9]{64}$/.test(digest)||!/^[a-f0-9]{64}$/.test(archive))
   throw Error('Pinned USDA source hashes required');
  const key=r.source_profile_key,fdc=String(f.fdcId),nutrients=JSON.stringify(values);
  return Object.freeze({source_profile_key:key,fdc_id:fdc,
   sourceReleaseArgs:[fdc,digest,archive,nutrients],
   seedArgs:[stableId('request',key,fdc),stableId('ingredient',key,fdc),
    stableId('profile',key,fdc),stableId('source',key,fdc),key,
    a.display_name,a.preparation_state,fdc,e.source,digest,archive,nutrients],
   calculationReady:false,publicationApproved:false});
 }).sort((a,b)=>a.fdc_id.localeCompare(b.fdc_id));
 return Object.freeze({rows:Object.freeze(rows),status:'candidate_seed_plan',
   verifiedFoodCount:rows.length,calculationReady:false,publicationApproved:false});
}
async function executeInitialUSDASeed({sourceOfficer,seedReviewer,...input}){
 if(!sourceOfficer||typeof sourceOfficer.query!=='function'||
    !seedReviewer||typeof seedReviewer.query!=='function'||
    sourceOfficer===seedReviewer)
  throw Error('Independent trusted source-officer and canonical seed-reviewer sessions required');
 const plan=planInitialUSDASeed(input);
 const released=[],seeded=[];
 // Source release is independently actor-attributed and immutable; can safely
 // replay after an interruption. The seed function enforces source/revision/CAS
 // and stores the independently released values, not caller-supplied estimates.
 for(const row of plan.rows){
  const response=await sourceOfficer.query(RELEASE_CORE,row.sourceReleaseArgs);
  const receipt=response?.rows?.[0]?.result;
  if(!receipt||!['released','already_released'].includes(receipt.status)||
     receipt.calculation_ready!==false)
   throw Error('Canonical independent source release refused or returned invalid receipt');
  released.push(row.source_profile_key);
 }
 for(const row of plan.rows){
  const response=await seedReviewer.query(INSERT_CANDIDATE,row.seedArgs);
  const receipt=response?.rows?.[0]?.result;
  if(!receipt||!['candidate_seeded','already_seeded'].includes(receipt.status)||
     receipt.calculation_ready!==false)
   throw Error('Canonical candidate seed refused or returned invalid receipt');
  seeded.push(row.source_profile_key);
 }
 return {status:'candidate_seeded_not_published',released,seeded,
  calculationReady:false,publicationApproved:false};
}
module.exports={stableId,planInitialUSDASeed,executeInitialUSDASeed,
 RELEASE_CORE,INSERT_CANDIDATE};
