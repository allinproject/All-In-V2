'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {validateFdcNutrients,ENERGY_POLICY_VERSION,REQUIRED_SET_VERSION}=require('./check-v2-usda-nutrient-policy.cjs');
const nutrient=(id,amount,unitName='g')=>({nutrient:{id,unitName},amount});
const sample=(energy=[])=>({provider:'usda_fdc',dataType:'Foundation',fdcId:2644285,
  basis_quantity:100,basis_unit:'g',require_sodium:true,
  foodNutrients:[...energy,nutrient(1003,6.91),nutrient(1005,19.8),
    nutrient(1004,1.27),nutrient(1093,218,'mg')]});
test('specific-factor energy wins and general energy retained as separate source fact',()=>{
 const r=validateFdcNutrients(sample([nutrient(2048,115,'kcal'),nutrient(2047,118,'kcal')]));
 assert.equal(r.status,'source_core_present_review_only');
 assert.equal(r.chosenEnergyNutrientId,2048);
 assert.equal(r.facts.energy_kcal,115);
 assert.equal(r.energyMethods.atwater_general.kcal,118);
 assert.equal(r.coverage.missing_core.length,0);
 assert.equal(r.calculationReady,false);
 assert.equal(r.publicationApproved,false);
 assert.equal(r.energyPolicyVersion,ENERGY_POLICY_VERSION);
 assert.equal(r.coverage.required_core_version,REQUIRED_SET_VERSION);
});
test('legacy 1008 allowed when specific factors missing, general alone never silently substituted',()=>{
 const legacy=validateFdcNutrients(sample([nutrient(1008,84,'kcal')]));
 assert.equal(legacy.chosenEnergyMethod,'legacy_energy');
 assert.equal(legacy.status,'source_core_present_review_only');
 const general=validateFdcNutrients(sample([nutrient(2047,118,'kcal')]));
 assert(general.issues.includes('no_permitted_energy_method'));
 assert.equal(general.facts.energy_kcal,null);
 assert.deepEqual(general.coverage.missing_core,['energy_kcal']);
});
test('source does not invent missing macros, units or optional micronutrients',()=>{
 const noProtein=sample([nutrient(2048,115,'kcal')]);noProtein.foodNutrients=noProtein.foodNutrients.filter(x=>x.nutrient.id!==1003);
 const r=validateFdcNutrients(noProtein);
 assert(r.issues.includes('missing_protein_g'));
 assert.equal(r.facts.protein_g,null);
 assert(r.coverage.missing_core.includes('protein_g'));
 const wrong=sample([nutrient(2048,115,'kJ')]);
 assert(wrong.issues.includes('incorrect_nutrient_unit:2048'));
 assert(wrong.issues.includes('no_permitted_energy_method'));
 const optional=sample([nutrient(2048,115,'kcal')]);optional.require_sodium=false;
 optional.foodNutrients=optional.foodNutrients.filter(x=>x.nutrient.id!==1093);
 const o=validateFdcNutrients(optional);
 assert.equal(o.facts.sodium_mg,null);
 assert.equal(o.status,'source_core_present_review_only');
 assert.equal(o.coverage.optional_nutrients_not_reported_as_zero,true);
});
test('explicit sodium qualification requires actual source sodium, not zero fallback',()=>{
 const input=sample([nutrient(2048,115,'kcal')]);input.foodNutrients=input.foodNutrients.filter(x=>x.nutrient.id!==1093);
 const r=validateFdcNutrients(input);
 assert(r.issues.includes('missing_sodium_mg'));
 assert.deepEqual(r.coverage.missing_conditional,['sodium_mg']);
 assert.equal(r.facts.sodium_mg,null);
});
test('rejects duplicate nutrients, negative values, and mismatched basis',()=>{
 const dup=sample([nutrient(2048,115,'kcal'),nutrient(2048,118,'kcal')]);
 assert(validateFdcNutrients(dup).issues.includes('duplicate_nutrient_id:2048'));
 const negative=sample([nutrient(2048,-115,'kcal')]);
 assert(validateFdcNutrients(negative).issues.includes('invalid_nutrient_value:2048'));
 const ml=sample([nutrient(2048,115,'kcal')]);ml.basis_unit='ml';
 assert.deepEqual(validateFdcNutrients(ml).issues,['invalid_source_identity_or_basis']);
});
test('never self-promotes Foundation source even with complete nutrient values',()=>{
 const input=sample([nutrient(2048,115,'kcal')]);
 input.calculationReady=true;input.publicationApproved=true;
 const result=validateFdcNutrients(input);
 assert.equal(result.calculationReady,false);
 assert.equal(result.canonicalIdentityApproved,false);
 assert.equal(result.publicationApproved,false);
});
