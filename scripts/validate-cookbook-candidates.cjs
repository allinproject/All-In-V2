#!/usr/bin/env node
'use strict';
// ALL-218 staging-only candidate validator. No network/database access.
const fs = require('node:fs');
const readline = require('node:readline');
const DATASETS = ['recipes', 'selectors', 'options', 'mappings'];
const ID_FIELDS = {recipes:'source_recipe_id',selectors:'source_selector_id',options:'source_option_id',mappings:'source_mapping_id'};
const COLUMNS = {recipes:'staged_candidate_json',selectors:'staged_selector_json',options:'staged_option_json',mappings:'staged_mapping_json'};
const FORBIDDEN = new Set(['nutrition','nutrition_delta','calories','protein_g','carbs_g','fat_g','macro_totals','nutrition_json']);

const ALLOWED_FIELDS = {
  recipes:new Set(['source_recipe_id','title','category','description','source_status','source_published',
    'servings','authored_ingredients_review_only','instructions','notes','source_origin',
    'source_card_completion','source_final_qa_status','source_hero_reference_review_only',
    'source_updated_at','source_variants_review_only']),
  selectors:new Set(['source_selector_id','source_recipe_id','selector_key','label','selector_type',
    'required','default_option_key','display_order','source_active','source_verification_status','source_updated_at']),
  options:new Set(['source_option_id','source_selector_id','option_key','label',
    'ingredient_changes_review_only','method_changes_review_only','tags','recommended',
    'source_active','source_verification_status','source_updated_at']),
  mappings:new Set(['source_mapping_id','source_recipe_id','selector_key','option_key',
    'source_profile_key','quantity_g_review_only','quantity_basis','source_verified','source_updated_at'])
};
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const nonblank = x => (typeof x === 'string' || typeof x === 'number') && String(x).trim() !== '';
function scan(value, path, errors) {
  if (Array.isArray(value)) { value.forEach((v,i)=>scan(v,path+'['+i+']',errors)); return; }
  if (!object(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN.has(key.toLowerCase())) errors.push(path+'.'+key+': forbidden legacy nutrition key');
    scan(child,path+'.'+key,errors);
  }
}
function inspect(dataset, value, seen, errors) {
  if (!object(value)) { errors.push(dataset+': candidate must be an object'); return; }
  const id = value[ID_FIELDS[dataset]], label = dataset+'/'+String(id);
  if (!nonblank(id)) errors.push(dataset+': missing '+ID_FIELDS[dataset]);
  if (seen[dataset].has(String(id))) errors.push(label+': duplicate source ID');
  else seen[dataset].add(String(id));
  for (const field of Object.keys(value)) if (!ALLOWED_FIELDS[dataset].has(field))
    errors.push(label+': unexpected top-level field '+field);
  scan(value,label,errors);
  if (dataset === 'recipes') {
    if (!nonblank(value.title)) errors.push(label+': empty title');
    if (!Array.isArray(value.authored_ingredients_review_only) || !value.authored_ingredients_review_only.length) errors.push(label+': no authored ingredient array');
    if (!Array.isArray(value.instructions)) errors.push(label+': instructions not an array');
    if (!Number.isInteger(value.servings) || value.servings < 1) errors.push(label+': invalid servings');
    if (!Array.isArray(value.source_variants_review_only)) errors.push(label+': variants not an array');
    else {
      const used = new Set();
      for (const variant of value.source_variants_review_only) {
        if (!object(variant) || !nonblank(variant.id)) { errors.push(label+': version missing ID'); continue; }
        if (used.has(String(variant.id))) errors.push(label+': duplicate version ID '+variant.id);
        used.add(String(variant.id));
        // Missing variant lines are unresolved; never impute nutrition/quantities.
      }
    }
  } else if (dataset === 'selectors') {
    if (!nonblank(value.source_recipe_id) || !nonblank(value.selector_key)) errors.push(label+': missing recipe or selector key');
  } else if (dataset === 'options') {
    if (!nonblank(value.source_selector_id) || !nonblank(value.option_key)) errors.push(label+': missing selector or option key');
    const changes = value.ingredient_changes_review_only;
    if (changes !== undefined && !Array.isArray(changes) && !object(changes)) errors.push(label+': invalid ingredient changes shape');
  } else if (dataset === 'mappings') {
    for (const key of ['source_recipe_id','selector_key','option_key','source_profile_key']) if (!nonblank(value[key])) errors.push(label+': missing '+key);
  }
}
function checkReferences(records, errors) {
  // Malformed records already fail inspect(); never let them crash reference checks.
  records = Object.fromEntries(DATASETS.map(d=>[d,records[d].filter(object)]));
  const recipes = new Set(records.recipes.map(r=>String(r.source_recipe_id)));
  const selectorsById = new Map(records.selectors.map(s=>[String(s.source_selector_id),s]));
  const selectorsByKey = new Map(records.selectors.map(s=>[JSON.stringify([s.source_recipe_id,s.selector_key]),s]));
  const optionsByKey = new Set(records.options.map(o=>JSON.stringify([o.source_selector_id,o.option_key])));
  const selectorKeys = new Set(), optionKeys = new Set(), mappingKeys = new Set();
  for (const s of records.selectors) {
    const key = JSON.stringify([s.source_recipe_id,s.selector_key]);
    if (selectorKeys.has(key)) errors.push('selector/'+s.source_selector_id+': duplicate recipe/selector key');
    selectorKeys.add(key);
    if (s.source_active === true && !optionsByKey.has(JSON.stringify([s.source_selector_id,s.default_option_key])))
      errors.push('selector/'+s.source_selector_id+': active selector missing default option');
  }
  for (const o of records.options) {
    const key = JSON.stringify([o.source_selector_id,o.option_key]);
    if (optionKeys.has(key)) errors.push('option/'+o.source_option_id+': duplicate selector/option key');
    optionKeys.add(key);
  }
  for (const m of records.mappings) {
    const key = JSON.stringify([m.source_recipe_id,m.selector_key,m.option_key,m.source_profile_key]);
    if (mappingKeys.has(key)) errors.push('mapping/'+m.source_mapping_id+': duplicate recipe/selector/option/profile key');
    mappingKeys.add(key);
  }
  for (const s of records.selectors) if (!recipes.has(String(s.source_recipe_id))) errors.push('selector/'+s.source_selector_id+': missing recipe');
  for (const o of records.options) if (!selectorsById.has(String(o.source_selector_id))) errors.push('option/'+o.source_option_id+': missing selector');
  for (const m of records.mappings) {
    if (!recipes.has(String(m.source_recipe_id))) errors.push('mapping/'+m.source_mapping_id+': missing recipe');
    const selector = selectorsByKey.get(JSON.stringify([m.source_recipe_id,m.selector_key]));
    if (!selector) errors.push('mapping/'+m.source_mapping_id+': missing selector key');
    else if (!optionsByKey.has(JSON.stringify([selector.source_selector_id,m.option_key]))) errors.push('mapping/'+m.source_mapping_id+': missing option key');
  }
}
async function validate(paths) {
  const errors = [], seen = Object.fromEntries(DATASETS.map(d=>[d,new Set()]));
  const records = Object.fromEntries(DATASETS.map(d=>[d,[]]));
  for (const dataset of DATASETS) {
    if (!paths[dataset]) continue;
    let lineNo = 0;
    for await (const line of readline.createInterface({input:fs.createReadStream(paths[dataset],{encoding:'utf8'}),crlfDelay:Infinity})) {
      ++lineNo;
      if (!line.trim()) continue;
      let value;
      try { value = JSON.parse(line); } catch (e) { errors.push(dataset+':'+lineNo+': invalid JSON'); continue; }
      if (object(value) && Object.hasOwn(value,COLUMNS[dataset])) value = value[COLUMNS[dataset]];
      inspect(dataset,value,seen,errors);
      records[dataset].push(value);
    }
  }
  if (!DATASETS.every(d=>paths[d])) errors.push('missing dataset: supply all four inputs');
  else checkReferences(records,errors);
  return {ok:errors.length===0,publicationApproved:false,counts:Object.fromEntries(DATASETS.map(d=>[d,records[d].length])),errorCount:errors.length,errors:errors.slice(0,100)};
}
if (require.main === module) {
  const entries = process.argv.slice(2).map(arg=>{const at=arg.indexOf('=');return [arg.slice(0,at),arg.slice(at+1)];});
  const paths = Object.fromEntries(entries);
  if (!entries.length || entries.some(([k,v])=>!DATASETS.includes(k)||!v)) {
    console.error('Usage: node validate-cookbook-candidates.cjs recipes=recipes.ndjson selectors=selectors.ndjson options=options.ndjson mappings=mappings.ndjson');
    process.exitCode = 2;
  } else validate(paths).then(out=>{console.log(JSON.stringify(out,null,2));if(!out.ok)process.exitCode=1;}).catch(e=>{console.error(e.message);process.exitCode=2;});
}
module.exports = {inspect,checkReferences,validate};
