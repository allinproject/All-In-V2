'use strict';
const assert = require('node:assert/strict');
const {test} = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {inspect,checkReferences,validate} = require('./validate-cookbook-candidates.cjs');
function seen() { return Object.fromEntries(['recipes','selectors','options','mappings'].map(d=>[d,new Set()])); }
function recipe() { return {source_recipe_id:'r1',title:'Chicken rice',servings:1,authored_ingredients_review_only:[{item:'Chicken',amount:'8 oz cooked'}],instructions:['Cook'],source_variants_review_only:[{id:'regular',label:'Regular'}],source_status:'draft',source_published:true}; }
test('accepts source prose without claiming publication approval',()=>{
  const errors=[];inspect('recipes',recipe(),seen(),errors);assert.deepEqual(errors,[]);
});
test('rejects nested legacy nutrition keys',()=>{
  const errors=[],r=recipe();r.source_variants_review_only[0].nutrition={calories:500};
  inspect('recipes',r,seen(),errors);assert(errors.some(e=>e.includes('nutrition: forbidden')));
});
test('rejects legacy nutrition_delta',()=>{
  const errors=[];inspect('options',{source_option_id:1,source_selector_id:2,option_key:'regular',nutrition_delta:{calories:20}},seen(),errors);
  assert(errors.some(e=>e.includes('nutrition_delta')));
});
test('detects duplicated source identifiers and variant identifiers',()=>{
  const errors=[],s=seen();inspect('recipes',recipe(),s,errors);
  const r=recipe();r.source_variants_review_only=[{id:'same'},{id:'same'}];inspect('recipes',r,s,errors);
  assert(errors.some(e=>e.includes('duplicate source ID')));
  assert(errors.some(e=>e.includes('duplicate version ID')));
});
test('preserves unresolved inherited variant content without fabricating quantities',()=>{
  const errors=[];inspect('recipes',recipe(),seen(),errors);assert.deepEqual(errors,[]);
});
test('rejects orphan selector links in component mapping',()=>{
  const records={recipes:[recipe()],selectors:[],options:[],mappings:[{source_mapping_id:4,source_recipe_id:'r1',selector_key:'wrapper',option_key:'bread'}]};
  const errors=[];checkReferences(records,errors);assert(errors.some(e=>e.includes('missing selector key')));
});
test('accepts complete linked references',()=>{
  const records={recipes:[recipe()],selectors:[{source_selector_id:2,source_recipe_id:'r1',selector_key:'wrapper'}],options:[{source_option_id:3,source_selector_id:2,option_key:'bread'}],mappings:[{source_mapping_id:4,source_recipe_id:'r1',selector_key:'wrapper',option_key:'bread'}]};
  const errors=[];checkReferences(records,errors);assert.deepEqual(errors,[]);
});
test('validates complete four-file JSONL but never approves publication',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'all218-'));
  try {
    const inputs={recipes:[recipe()],selectors:[{source_selector_id:2,source_recipe_id:'r1',selector_key:'wrapper',source_active:false}],options:[{source_option_id:3,source_selector_id:2,option_key:'bread',source_active:true,ingredient_changes_review_only:[]}],mappings:[{source_mapping_id:4,source_recipe_id:'r1',selector_key:'wrapper',option_key:'bread',source_profile_key:'chicken',source_verified:false}]};
    const paths=Object.fromEntries(Object.entries(inputs).map(([k,values])=>{const p=path.join(dir,k+'.ndjson');fs.writeFileSync(p,values.map(JSON.stringify).join('\n')+'\n');return [k,p];}));
    const result=await validate(paths);
    assert.equal(result.ok,true);assert.equal(result.publicationApproved,false);
    assert.deepEqual(result.counts,{recipes:1,selectors:1,options:1,mappings:1});
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
test('rejects malformed JSON and incomplete input sets',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'all218-'));
  try {
    const file=path.join(dir,'recipes.ndjson');fs.writeFileSync(file,'{bad-json}\n');
    const result=await validate({recipes:file});
    assert.equal(result.ok,false);assert(result.errors.some(e=>e.includes('invalid JSON')));
    assert(result.errors.some(e=>e.includes('missing dataset')));
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
