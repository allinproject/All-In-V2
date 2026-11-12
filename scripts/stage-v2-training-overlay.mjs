// ALL-222: preserve real candidate SQL while making the local overlay atomic.
// Candidate DDL files can carry their own BEGIN/COMMIT for isolated PG tests.
// The full-foundation replay must stage a copy without those top-level wrappers,
// otherwise an embedded COMMIT escapes the outer rollback transaction.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,basename,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

export function stripCandidateTransactionWrappers(sql,fileName) {
  const lines=sql.split('\n');
  let depth=0,removed=0;
  let dollarQuote=null;
  const output=[];
  for (const line of lines) {
    // File-level transactions must be removed; PL/pgSQL BEGIN inside a
    // dollar-quoted function body is executable code and must be preserved.
    const directive=dollarQuote===null
      ? line.match(/^\s*(BEGIN|COMMIT|ROLLBACK)(?:\s+(?:WORK|TRANSACTION))?\s*;\s*(?:--.*)?$/i)
      : null;
    if(!directive){
      output.push(line);
      if(!/^\s*--/.test(line)){
        for(const match of line.matchAll(/\$[A-Za-z_][A-Za-z_0-9]*\$|\$\$/g)){
          if(dollarQuote===null)dollarQuote=match[0];
          else if(dollarQuote===match[0])dollarQuote=null;
        }
      }
      continue;
    }
    const kind=directive[1].toUpperCase();
    if(kind==='ROLLBACK')throw new Error(fileName+': unexpected internal ROLLBACK');
    if(kind==='BEGIN'){
      if(depth!==0)throw new Error(fileName+': nested top-level transaction');
      depth=1;
    }else{
      if(depth!==1)throw new Error(fileName+': COMMIT without matching BEGIN');
      depth=0;
    }
    removed++;
    output.push('-- local overlay stripped file-level '+kind+' (atomic outer transaction)');
  }
  if(dollarQuote!==null)throw new Error(fileName+': unterminated dollar-quoted SQL body');
  if(depth!==0)throw new Error(fileName+': unclosed file-level transaction');
  return {sql:output.join('\n'),removed};
}

export function stageOverlay(overlayText,readCandidate,writeCandidate){
  const names=[...overlayText.matchAll(/^\\i \/tmp\/allin\/docs\/architecture\/sql\/([^\n\r ]+\.sql)$/gm)]
    .map(m=>m[1]);
  if(names.length<20 || names.length!==new Set(names).size)
    throw new Error('Expected the existing unique ordered Training/Activity overlay inputs');
  let removed=0;
  for(const name of names){
    if(basename(name)!==name)throw new Error('Invalid SQL candidate path: '+name);
    const staged=stripCandidateTransactionWrappers(readCandidate(name),name);
    removed+=staged.removed;
    writeCandidate(name,staged.sql);
  }
  if(removed===0)throw new Error('Expected candidate-level transaction wrappers; refusing unverified overlay');
  return {files:names.length,removed};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
  const output=process.argv[2];
  if(!output||!output.startsWith('/tmp/'))throw new Error('Stage only to disposable /tmp path');
  mkdirSync(output,{recursive:true});
  const overlay=readFileSync(resolve(root,'scripts/test-v2-foundation-training-overlay-postgres.psql'),'utf8');
  const result=stageOverlay(overlay,
    name=>readFileSync(resolve(root,'docs/architecture/sql',name),'utf8'),
    (name,sql)=>writeFileSync(resolve(output,name),sql,'utf8'));
  console.log('PASS ALL-222: staged '+result.files+' review-only SQL files, stripped '+result.removed+' transaction wrappers for atomic rollback');
}
