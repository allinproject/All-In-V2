'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {assertConfig,query,PROJECT,LOGIN}=require('./check-v2-ingredient-hosted-workload-connection.cjs');
test('accept only the exact staging project, private pgpass and verified TLS',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'all228-'));
 try {
   const pass=path.join(dir,'pgpass'),ca=path.join(dir,'ca.crt');
   fs.writeFileSync(pass,'placeholder-not-a-credential',{mode:0o600});
   fs.writeFileSync(ca,'placeholder');
   const env={ALL228_ALLOW_HOSTED_INGEST_SMOKE:'1',ALL228_TEMP_STAGING_PROJECT_REF:PROJECT,
     PGHOST:'db.'+PROJECT+'.supabase.co',PGPORT:'5432',PGDATABASE:'postgres',PGUSER:LOGIN,
     PGSSLMODE:'verify-full',PGSSLROOTCERT:ca,PGPASSFILE:pass};
   assert.equal(assertConfig(env).login,LOGIN);
   for(const [key,value] of [
     ['ALL228_ALLOW_HOSTED_INGEST_SMOKE','0'],['PGUSER','postgres'],
     ['PGHOST','db.xarhuczrtzuiljmtdaeu.supabase.co'],['PGPORT','6543'],
     ['PGSSLMODE','require'],['PGPASSWORD','any'],['PGHOSTADDR','127.0.0.1'],
     ['PGOPTIONS','-c role=postgres'],['DATABASE_URL','postgresql://test'],
     ['ALL228_TEMP_STAGING_PROJECT_REF','xarhuczrtzuiljmtdaeu']
   ])assert.throws(()=>assertConfig({...env,[key]:value}));
   fs.chmodSync(pass,0o644);
   assert.throws(()=>assertConfig(env),/0600/);
 } finally {fs.rmSync(dir,{recursive:true,force:true})}
});
test('hosted proof remains a read-only, scoped ROLE session',()=>{
 const q=query();
 assert.match(q,/BEGIN READ ONLY/);
 assert.match(q,/SET LOCAL ROLE allin_v2_ingredient_reviewer/);
 assert.match(q,/row_to_json/);
 assert.match(q,/ROLLBACK/);
 assert.doesNotMatch(q,/CREATE ROLE|INSERT INTO|DELETE FROM|UPDATE public/);
});
