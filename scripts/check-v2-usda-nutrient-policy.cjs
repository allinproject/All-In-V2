#!/usr/bin/env node
'use strict';
// ALL-225: versioned USDA source *preflight*, not an ingest writer or a
// calculation-ready determination. Never converts missing values to zero.
const ENERGY_POLICY_VERSION='usda-fdc-energy-specific-legacy-v1';
const REQUIRED_SET_VERSION='cookbook-launch-macros-v1';
const CORE=Object.freeze(['energy_kcal','protein_g','carbohydrate_g','total_fat_g']);
const ID=Object.freeze({
  energy_specific:2048, energy_general:2047, energy_legacy:1008,
  protein:1003, carbohydrate:1005, fat:1004, sodium:1093
});
const finiteNonnegative=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
function validateFdcNutrients(input) {
  const issues=[],push=x=>{if(!issues.includes(x))issues.push(x)};
  if(!input||input.provider!=='usda_fdc'||input.dataType!=='Foundation'||
     !/^[1-9][0-9]*$/.test(String(input.fdcId||''))||
     input.basis_quantity!==100||input.basis_unit!=='g'||!Array.isArray(input.foodNutrients))
    return {status:'review_required',issues:['invalid_source_identity_or_basis'],
      automatedSourceChecksPassed:false,exceptionQueueRequired:true,
      calculationReady:false,publicationApproved:false};
  const values=new Map();
  for(const row of input.foodNutrients) {
    const nutrient=row?.nutrient;
    const id=nutrient?.id,unit=nutrient?.unitName;
    if(!Number.isSafeInteger(id)||id<=0) {push('invalid_nutrient_id');continue}
    if(values.has(id)){push('duplicate_nutrient_id:'+id);continue}
    if(!finiteNonnegative(row?.amount)){push('invalid_nutrient_value:'+id);continue}
    values.set(id,{amount:row.amount,unit});
  }
  const pick=(id,unit,code)=>{
    const nutrient=values.get(id);
    if(!nutrient) {push('missing_'+code);return null}
    if(nutrient.unit!==unit) {push('incorrect_nutrient_unit:'+id);return null}
    return nutrient.amount;
  };
  // Preserve every energy method. Never sum or blend methods, and never
  // substitute general factors for specific or legacy without a policy revision.
  const methods={};
  for(const [label,id] of [['atwater_specific',ID.energy_specific],
                            ['atwater_general',ID.energy_general],
                            ['legacy_energy',ID.energy_legacy]]) {
    const entry=values.get(id);
    if(entry) {
      if(entry.unit!=='kcal')push('incorrect_nutrient_unit:'+id);
      else methods[label]={fdc_nutrient_id:id,kcal:entry.amount};
    }
  }
  const selected=methods.atwater_specific||methods.legacy_energy||null;
  if(!selected) push('no_permitted_energy_method');
  const protein=pick(ID.protein,'g','protein_g');
  const carbs=pick(ID.carbohydrate,'g','carbohydrate_g');
  const fat=pick(ID.fat,'g','total_fat_g');
  const sodiumRequired=input.require_sodium===true;
  const sodium=sodiumRequired?pick(ID.sodium,'mg','sodium_mg'):
    values.has(ID.sodium)?pick(ID.sodium,'mg','sodium_mg'):null;
  const facts={
    energy_kcal:selected?.kcal??null,protein_g:protein,
    carbohydrate_g:carbs,total_fat_g:fat,sodium_mg:sodium
  };
  const coverage={required_core_version:REQUIRED_SET_VERSION,
    core_codes:CORE,required_conditional_codes:sodiumRequired?['sodium_mg']:[],
    missing_core:CORE.filter(key=>facts[key]===null),
    missing_conditional:sodiumRequired&&sodium===null?['sodium_mg']:[],
    optional_nutrients_not_reported_as_zero:true};
  // Source preflight is automated. Human review is for exceptions, not every
  // passing USDA food. Passing still does not authorize a canonical write or
  // calculation_ready; identity mapping, source digest and writer gates remain.
  const automatedSourceChecksPassed=issues.length===0;
  return {status:issues.length?'review_required':'source_core_present_review_only',
    issues,automatedSourceChecksPassed,exceptionQueueRequired:!automatedSourceChecksPassed,
    energyPolicyVersion:ENERGY_POLICY_VERSION,energyMethods:methods,
    chosenEnergyMethod:selected?.fdc_nutrient_id===ID.energy_specific?'atwater_specific':
      selected?.fdc_nutrient_id===ID.energy_legacy?'legacy_energy':null,
    chosenEnergyNutrientId:selected?.fdc_nutrient_id??null,
    facts,coverage,sourceFdcId:String(input.fdcId),
    basis:{quantity:100,unit:'g'},sourceDataType:'Foundation',
    calculationReady:false,publicationApproved:false,canonicalIdentityApproved:false};
}
module.exports={validateFdcNutrients,ENERGY_POLICY_VERSION,REQUIRED_SET_VERSION};
if(require.main===module) {
  const fs=require('node:fs'),file=process.argv[2];
  if(!file){console.error('Usage: node scripts/check-v2-usda-nutrient-policy.cjs source-nutrient-record.json');process.exitCode=2}
  else try {
    const r=validateFdcNutrients(JSON.parse(fs.readFileSync(file,'utf8')));
    console.log(JSON.stringify(r,null,2));
    if(r.issues.length)process.exitCode=1;
  }catch(error){console.error(error.message);process.exitCode=2}
}
