#!/usr/bin/env node
'use strict';
// ALL-218. Offline source-review triage ONLY. Never approves or publishes a recipe.
// This is NOT an ingredient normalizer, rights adjudicator, or canonical V2 writer.
const fs = require('node:fs');
const readline = require('node:readline');

function isObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function hasText(value) { return typeof value === 'string' && value.trim().length > 0; }
function inspectRecipe(candidate) {
  if (!isObject(candidate) || !hasText(candidate.source_recipe_id)) throw new Error('invalid source recipe candidate');
  const reasons = [];
  const flag = (id, condition) => { if (condition) reasons.push(id); };
  const ingredients = candidate.authored_ingredients_review_only;
  const versions = candidate.source_variants_review_only;
  const kit = candidate.source_freezer_kit_review_only;
  const isKit = isObject(kit);
  flag('source_not_published',candidate.source_published !== true);
  flag('source_not_tested',candidate.source_status !== 'tested');
  flag('source_origin_missing',!hasText(candidate.source_origin));
  // Legacy merges and imported-source identities need explicit content ownership
  // and duplicate resolution; these are review signals, not definitive labels.
  flag('legacy_merge_identity_review',typeof candidate.title==='string' && /^\[Merged\]/i.test(candidate.title.trim()));
  flag('external_import_provenance_review',/^recipe-import-/i.test(candidate.source_recipe_id));
  flag('ingredients_missing',!Array.isArray(ingredients) || ingredients.length === 0);
  flag('free_text_ingredient_lines',Array.isArray(ingredients) && ingredients.some(line=>typeof line === 'string'));
  flag('ingredient_item_or_amount_missing',Array.isArray(ingredients) && ingredients.some(line=>isObject(line) && (!hasText(line.item) || !hasText(line.amount))));
  flag('sparse_version_needs_inheritance_review',Array.isArray(versions) && versions.some(v=>!isObject(v) ||
    !Array.isArray(v.authored_ingredients_review_only) || v.authored_ingredients_review_only.length===0 ||
    !Array.isArray(v.instructions) || v.instructions.length===0 ||
    !Number.isInteger(v.servings) || v.servings<=0));
  flag('source_versions_missing',!Array.isArray(versions));
  flag('image_rights_review',true);
  flag('ingredient_identity_and_preparation_review',true);
  flag('quantity_unit_and_cooked_target_review',!isKit);
  flag('freezer_kit_raw_lifecycle_review',isKit);
  flag('nutrition_and_yield_evidence_review',true);
  // Priority is for human work allocation only; never readiness or release eligibility.
  // Explicit source ownership/identity conflicts outrank content-normalization work.
  const sourceIdentity = reasons.some(r=>['source_origin_missing','legacy_merge_identity_review','external_import_provenance_review'].includes(r));
  const structure = reasons.some(r=>['ingredients_missing','free_text_ingredient_lines',
    'ingredient_item_or_amount_missing','sparse_version_needs_inheritance_review',
    'source_versions_missing'].includes(r));
  const reviewLane = sourceIdentity ? 'source_identity_and_rights'
    : structure ? 'ingredient_and_variant_structure'
    : isKit ? 'freezer_kit_method'
    : 'standard_recipe_measurements';
  return {source_recipe_id:candidate.source_recipe_id,title:candidate.title || null,
    reviewLane,freezerKitCandidate:isKit,reviewRequired:true,publicationApproved:false,reasons};
}

async function triageJsonl(file, {expectedRecipes=907}={}) {
  const items=[], seen=new Set(), flags={},errors=[];
  let lineNumber=0;
  const rows=readline.createInterface({input:fs.createReadStream(file,{encoding:'utf8'}),crlfDelay:Infinity});
  for await (const line of rows) {
    ++lineNumber;
    if (!line.trim()) continue;
    try {
      const raw=JSON.parse(line);
      const value=isObject(raw) && Object.hasOwn(raw,'staged_candidate_json') ? raw.staged_candidate_json : raw;
      const item=inspectRecipe(value);
      if (seen.has(String(item.source_recipe_id))) throw new Error('duplicate source recipe ID');
      seen.add(String(item.source_recipe_id));
      items.push(item);
      for (const reason of item.reasons) flags[reason]=(flags[reason]||0)+1;
    } catch (error) { errors.push('line '+lineNumber+': '+error.message); }
  }
  if (!Number.isSafeInteger(expectedRecipes) || expectedRecipes<1) errors.push('invalid expectedRecipes');
  else if (items.length!==expectedRecipes) errors.push('expected '+expectedRecipes+' recipes; read '+items.length);
  return {ok:errors.length===0,publicationApproved:false,
    candidateCount:items.length,freezerKitCandidates:items.filter(i=>i.freezerKitCandidate).length,
    reviewFlagCounts:flags,
    reviewLaneCounts:items.reduce((out,item)=>{
      out[item.reviewLane]=(out[item.reviewLane]||0)+1;return out;
    },{}),errors,
    items:items.sort((a,b)=>a.reviewLane.localeCompare(b.reviewLane)
      || String(a.source_recipe_id).localeCompare(String(b.source_recipe_id)))};
}

if(require.main===module) {
  const [file, expected]=process.argv.slice(2);
  if(!file) {console.error('Usage: node scripts/cookbook-review-triage.cjs recipes.ndjson [expectedRecipeCount]');process.exitCode=2;}
  else triageJsonl(file,{expectedRecipes:expected===undefined?907:Number(expected)})
    .then(result=>{console.log(JSON.stringify(result,null,2));if(!result.ok)process.exitCode=1;})
    .catch(error=>{console.error(error.message);process.exitCode=2;});
}
module.exports={inspectRecipe,triageJsonl};
