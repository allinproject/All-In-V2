#!/usr/bin/env node
'use strict';
// ALL-228: read-only deterministic lexical reconciliation aid, NOT identity
// assignment, nutrition approval, external request, seed or database writer.
const fs=require('node:fs');
const COMMON=new Set(['and','or','with','without','the','a','an','for','of','in','on',
  'only','added','commercial','regular','plain','fresh','raw','cooked','prepared',
  'dry','dried','unheated','heated','boiled','roasted','steamed','grilled','fried',
  'baked','broiled','drained','frozen','sliced','diced','chopped','minced',
  'whole','pack','as','sold','uncooked']);
function normalize(s){
  return typeof s==='string'?s.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' '):'';
}
function stem(t){
  if(t.endsWith('ies')&&t.length>4)return t.slice(0,-3)+'y';
  if(t.endsWith('oes')&&t.length>4)return t.slice(0,-2);
  if(t.endsWith('s')&&!t.endsWith('ss')&&t.length>4)return t.slice(0,-1);
  return t;
}
function tokens(s){
  const n=normalize(s);
  // "without salt" and "salt added" describe a food's processing,
  // not the core ingredient "salt". Do not suggest table salt for soup.
  const seasoning=/\\b(?:without|with)\\s+salt\\b|\\bsalt\\s+added\\b/.test(n);
  const words=n.split(' ').map(stem).filter(t=>t&&!COMMON.has(t));
  return [...new Set(seasoning&&words.some(t=>t!=='salt')
    ? words.filter(t=>t!=='salt') : words)].sort();
}
function prep(s){
  const t=normalize(s);
  const has=v=>(' '+t+' ').includes(' '+v+' ');
  if(has('raw')||has('uncooked')||has('unheated'))return 'raw_hint';
  if(has('cooked')||has('boiled')||has('roasted')||has('grilled')||has('steamed')||has('fried')||has('heated'))return 'cooked_hint';
  if(has('dry')||has('dried'))return 'dry_hint';
  if(has('prepared'))return 'prepared_hint';
  return 'unspecified';
}
function compare(a,b){
  const x=tokens(a),y=tokens(b);
  if(!x.length||!y.length)return 0;
  const common=x.filter(t=>y.includes(t)).length;
  if(!common)return 0;
  const contained=common/Math.min(x.length,y.length);
  const precision=common/Math.max(x.length,y.length);
  return Math.round((0.55*precision+0.45*contained)*1000)/1000;
}
function reconcile(foods,profiles){
  if(!Array.isArray(foods)||!Array.isArray(profiles))throw Error('both datasets must be arrays');
  const keys=new Set(),foodIds=new Set(),profileNames=[];
  for(const p of profiles){
    if(!p||typeof p.profile_key!=='string'||!p.profile_key.trim()||keys.has(p.profile_key))throw Error('missing/duplicate V1 profile key');
    keys.add(p.profile_key);
    const names=[p.label,...(Array.isArray(p.aliases)?p.aliases:[])].filter(v=>typeof v==='string'&&v.trim());
    profileNames.push({key:p.profile_key,names});
  }
  const records=[],suggestedKeys=new Set();
  for(const f of foods){
    if(!f||!Number.isSafeInteger(f.fdcId)||!f.description||foodIds.has(f.fdcId))throw Error('missing/duplicate USDA FDC ID or description');
    foodIds.add(f.fdcId);
    const exact=[],ranked=[];
    for(const p of profileNames){
      if(p.names.some(n=>normalize(n)===normalize(f.description))){exact.push(p.key);suggestedKeys.add(p.key);continue;}
      const variants=p.names.map(n=>({label:n,score:compare(n,f.description)})).sort((x,y)=>y.score-x.score);
      if(variants.length&&variants[0].score>=0.62){
        ranked.push({sourceProfileKey:p.key,sourceName:variants[0].label,lexicalScore:variants[0].score,
          usdaPreparationHint:prep(f.description),v1PreparationHint:prep(variants[0].label)});
      }
    }
    ranked.sort((a,b)=>b.lexicalScore-a.lexicalScore||a.sourceProfileKey.localeCompare(b.sourceProfileKey));
    const suggestions=ranked.slice(0,5).map(row=>({
      ...row,
      preparationConflict:row.usdaPreparationHint!=='unspecified' &&
        row.v1PreparationHint!=='unspecified' &&
        row.usdaPreparationHint!==row.v1PreparationHint,
      status:'unreviewed_lexical_hint'
    }));
    suggestions.forEach(s=>suggestedKeys.add(s.sourceProfileKey));
    records.push({fdcId:f.fdcId,usdaDescription:f.description,
      usdaCategory:f.category||null,
      status:exact.length>1?'conflicting_exact_names':exact.length===1?'exact_name_review_only':
        suggestions.length?'lexical_candidates_review_only':'no_lexical_candidate',
      exactProfileKeys:exact.sort(),suggestions,
      requiresIdentityReview:true,requiresPreparationReview:true,nutritionApproved:false,
      canonicalV2Id:null});
  }
  records.sort((a,b)=>a.fdcId-b.fdcId);
  const counts={};for(const r of records)counts[r.status]=(counts[r.status]||0)+1;
  return {sourceArchiveSha256:'dd414cc9f1a132626bad354ef6655972c78b44aff14f16114dc899708663c579',
    sourceFoodCount:foods.length,v1ProfileCount:profiles.length,statusCounts:counts,
    sourceProfilesWithAnyCandidate:suggestedKeys.size,sourceProfilesWithoutCandidate:profiles.length-suggestedKeys.size,
    approvalGranted:false,importAuthorized:false,records};
}
module.exports={normalize,tokens,prep,compare,reconcile};
if(require.main===module){
  const [usdaFile,v1File]=process.argv.slice(2);
  if(!usdaFile||!v1File){console.error('Usage: node scripts/reconcile-v2-usda-foundation-candidates.cjs foundation-foods.json v1-profile-names.json');process.exitCode=2;}
  else try{
    const result=reconcile(JSON.parse(fs.readFileSync(usdaFile,'utf8')),JSON.parse(fs.readFileSync(v1File,'utf8')));
    console.log(JSON.stringify(result,null,2));
  }catch(e){console.error(e.message);process.exitCode=2;}
}
