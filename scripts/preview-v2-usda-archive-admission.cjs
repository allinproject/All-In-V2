'use strict';
// ALL-228 review-only transport for the existing USDA source-admission gate.
// Caller MUST independently verify full raw ZIP bytes and per-food SHA-256;
// this process cannot grant database rights, canonical IDs or publication.
const fs=require('node:fs');
const path=require('node:path');
const {reviewUsdaAdmission}=require('./review-v2-usda-source-admission.cjs');
const base=path.join(__dirname,'../docs/evidence');
const load=name=>JSON.parse(fs.readFileSync(path.join(base,name),'utf8'));
const bindings=load('ALL-228-EIGHT-REVIEWED-SOURCE-BINDINGS-2026-11-12.json');
const aliasPolicy=load('ALL-228-EIGHT-ALIAS-AND-PREPARATION-ACCEPTANCE-CANDIDATES-2026-11-12.json');
const sourceEvidence=load('ALL-228-EIGHT-DIRECT-FDC-FOOD-FORM-NUTRIENT-BASIS-2026-11-12.json');
function previewSourceFoods(sourceFoods){
  if(!Array.isArray(sourceFoods)||sourceFoods.length!==8)
    throw Error('Exactly eight pinned source foods required');
  const result=reviewUsdaAdmission({sourceFoods,sourceEvidence,sourceBindings:bindings,aliasPolicy});
  return Object.freeze({
    status:result.status,
    sourceCount:result.sourceCount,
    passedPreflight:result.sourceRows.filter(row=>row.source_preflight_pass).length,
    issues:result.issues.slice(0,24),
    automaticQualificationCount:result.automaticQualificationCount,
    exceptionReviewCount:result.exceptionReviewCount,
    qualificationQueue:result.qualificationQueue,
    individualFounderApprovalRequired:false,
    sourceContractValidated:result.sourceContractValidated,
    aliasContractValidated:result.aliasContractValidated,
    canonicalIdsAssigned:false,
    writerAuthorized:false,
    calculationReady:false,
    publicationApproved:false
  });
}

/**
 * The canonical previewIngredientSeed() owns reconciliation. Never create
 * another source-to-ingredient mapping or infer an approved canonical ID.
 * The baseline is read-only caller-supplied existing source inventory.
 */
async function previewVerifiedSeedPlan(sourceFoods,{existing=[]}={}){
  const review=previewSourceFoods(sourceFoods);
  if(review.status!=='review_stage_complete'||review.passedPreflight!==8||
     !review.sourceContractValidated||!review.aliasContractValidated)
    return {...review,seedPlanStatus:'blocked_by_source_review',seedCounts:null,
      dryRunOnly:true,canonicalIdsAssigned:false,writerAuthorized:false};
  const {previewIngredientSeed}=await import('../apps/mobile-v2/src/features/cookbook/ingredientSeedPreview.ts');
  const candidates=sourceFoods.map(food=>({
    provider:'usda_fdc',source_data_type:'Foundation',
    external_record_id:String(food.fdcId),payload_sha256:food.payload_sha256,
    description:food.source_description
  }));
  const seed=previewIngredientSeed({
    snapshot_id:'usda-foundation-2026-10-29:'+sourceEvidence.archiveSha256,
    importer_version:'all228-verified-foundation-dry-run-v1',
    candidates,existing
  });
  return {...review,seedPlanStatus:seed.counts.conflict?'review_required':'dry_run_only',
    seedCounts:seed.counts,seedActions:seed.actions,
    dryRunOnly:true,canonicalIdsAssigned:false,writerAuthorized:false,
    calculationReady:false,publicationApproved:false};
}
module.exports={previewSourceFoods,previewVerifiedSeedPlan};
if(require.main===module){
  let input='';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data',chunk=>{
    input+=chunk;
    if(input.length>100000){
      console.error('Verified USDA review input exceeds limit');process.exit(1);
    }
  });
  process.stdin.on('end',()=>{
    try{
      const parsed=JSON.parse(input);
      previewVerifiedSeedPlan(parsed.sourceFoods).then(result=>{
        console.log(JSON.stringify(result));
        if(result.status!=='review_stage_complete'||result.seedPlanStatus!=='dry_run_only')process.exitCode=1;
      }).catch(()=>{console.error('Verified USDA dry-run seed preview failed');process.exitCode=1;});
    }catch(error){
      console.error('Verified USDA review-only admission failed');
      process.exitCode=1;
    }
  });
}
