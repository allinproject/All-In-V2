'use strict';
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');

function runPython(code) {
  const output=spawnSync('python3',['-c',code],{cwd:path.join(__dirname,'..'),encoding:'utf8',timeout:15000});
  assert.equal(output.status,0,output.stderr||output.stdout);
  return JSON.parse(output.stdout.trim());
}
test('source candidate matching is not approval and does not force one-to-one maps',()=>{
  const code=`import importlib.util,json
p='scripts/reconcile-usda-foundation-identities.py'
s=importlib.util.spec_from_file_location('usda_reconcile',p)
m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
foods=[{'fdcId':11,'description':'Chicken breast, cooked','dataType':'Foundation'},
       {'fdcId':12,'description':'Chicken breast, roasted','dataType':'Foundation'},
       {'fdcId':13,'description':'Chicken breast','dataType':'Foundation'}]
profiles=[{'source_profile_key':'cooked','source_label':'Chicken breast, cooked','source_aliases':[]},
          {'source_profile_key':'raw','source_label':'Chicken breast, raw','source_aliases':['Chicken breast']}]
r=m.reconcile(foods,profiles,3,2)
print(json.dumps({'states':[x['status'] for x in r['rows']],'exact':r['summary']['exactNameCandidatePairs'],
  'approved':r['publicationApproved'],'ready':r['calculationReady']}))`;
  const result=runPython(code);
  assert.equal(result.exact,2);
  assert.equal(result.approved,false);
  assert.equal(result.ready,false);
  assert.deepEqual(result.states,['exact_name_review','similar_name_review','exact_name_review']);
});
test('incorrect source counts fail closed',()=>{
  const code=`import importlib.util,json
s=importlib.util.spec_from_file_location('usda_reconcile','scripts/reconcile-usda-foundation-identities.py')
m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
try:m.reconcile([],[],424,408)
except ValueError:print(json.dumps({'blocked':True}))
else:print(json.dumps({'blocked':False}))`;
  assert.equal(runPython(code).blocked,true);
});
test('normalized labels compare without inferring preparation-state equivalence',()=>{
  const code=`import importlib.util,json
s=importlib.util.spec_from_file_location('usda_reconcile','scripts/reconcile-usda-foundation-identities.py')
m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
print(json.dumps({'normalized':m.normalize('  CHICKEN   Breast  '),'score':m.similarity('Chicken breast, raw','Chicken breast, cooked')}))`;
  const result=runPython(code);
  assert.equal(result.normalized,'chicken breast');
  assert(result.score<1);
});

test('source FDC URLs are recorded as review evidence, never automatic approval',()=>{
  const code=`import importlib.util,json
s=importlib.util.spec_from_file_location('usda_reconcile','scripts/reconcile-usda-foundation-identities.py')
m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
foods=[{'fdcId':2644285,'description':'Beans, black, canned, sodium added, drained and rinsed','dataType':'Foundation'},
       {'fdcId':42,'description':'Unrelated food','dataType':'Foundation'}]
profiles=[{'source_profile_key':'beans','source_label':'Black beans','source_aliases':[],
  'source_fdc_id':None,'source_url':'https://fdc.nal.usda.gov/food-details/2644285/nutrients'},
 {'source_profile_key':'unrelated','source_label':'Other','source_aliases':[],
  'source_fdc_id':None,'source_url':'https://fdc.nal.usda.gov/food-details/9999/nutrients'}]
r=m.reconcile(foods,profiles,2,2)
print(json.dumps({'refs':r['rows'][1]['direct_fdc_source_profile_keys'],
 'count':r['summary']['directFdcSourceReferencePairs'],
 'status':r['rows'][1]['status'],
 'approval':r['reconciliationApproved'],'ready':r['calculationReady']}))`;
  const r=runPython(code);
  assert.deepEqual(r.refs,['beans']);
  assert.equal(r.count,1);
  assert.equal(r.status,'source_fdc_reference_review');
  assert.equal(r.approval,false);
  assert.equal(r.ready,false);
});
