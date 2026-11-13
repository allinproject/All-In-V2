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
    sourceContractValidated:result.sourceContractValidated,
    aliasContractValidated:result.aliasContractValidated,
    canonicalIdsAssigned:false,
    writerAuthorized:false,
    calculationReady:false,
    publicationApproved:false
  });
}
module.exports={previewSourceFoods};
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
      const result=previewSourceFoods(parsed.sourceFoods);
      console.log(JSON.stringify(result));
      if(result.status!=='review_stage_complete'||result.passedPreflight!==8)process.exitCode=1;
    }catch(error){
      console.error('Verified USDA review-only admission failed');
      process.exitCode=1;
    }
  });
}
