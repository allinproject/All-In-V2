// ALL-12: disposable-only populated Auth pg_dump/delete/pg_restore.
// Exercises two real GoTrue password accounts, identities and sessions.
// Does not restore hosted JWT secrets, external IdPs or provider snapshots.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
assert.equal(process.env.CI,'1');
const env=Object.fromEntries(execFileSync('supabase',['status','-o','env'],{encoding:'utf8'})
 .split(/\r?\n/).map(s=>s.match(/^(?:export )?([A-Z_]+)=(.*)$/)).filter(Boolean)
 .map(m=>[m[1],m[2].replace(/^["']|["']$/g,'')]));
const url=new URL(env.API_URL);
assert.equal(url.protocol,'http:');
assert.ok(['localhost','127.0.0.1'].includes(url.hostname)&&url.port==='54321');
const admin=env.SERVICE_ROLE_KEY,anon=env.ANON_KEY;
assert.ok(admin&&anon);
const db=execFileSync('docker',['ps','--filter','name=supabase_db_','--format','{{.ID}}'],{encoding:'utf8'}).trim().split('\n')[0];
assert.match(db,/^[a-f0-9]{12,64}$/);
const docker=args=>execFileSync('docker',['exec',db,...args],{encoding:'utf8',timeout:120000});
const sql=s=>docker(['psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-c',s]).trim();
const nonce=randomBytes(8).toString('hex'),accounts=[];
const file='/tmp/all12-populated-auth.dump';
async function req(method,path,key,body){
 const r=await fetch(url.origin+path,{method,headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});
 return {status:r.status,data:await r.json().catch(()=>null)};
}
const fingerprint=()=>sql(`SELECT coalesce(md5(string_agg(to_jsonb(x)::text,E'\\n' ORDER BY x.kind,x.row_id)),'') FROM (
 SELECT 'user' kind,id::text row_id,to_jsonb(u) AS record FROM auth.users u WHERE id IN ('${accounts[0].id}'::uuid,'${accounts[1].id}'::uuid)
 UNION ALL SELECT 'identity',id::text,to_jsonb(i) FROM auth.identities i WHERE user_id IN ('${accounts[0].id}'::uuid,'${accounts[1].id}'::uuid)
 UNION ALL SELECT 'session',id::text,to_jsonb(s) FROM auth.sessions s WHERE user_id IN ('${accounts[0].id}'::uuid,'${accounts[1].id}'::uuid)
 UNION ALL SELECT 'refresh',id::text,to_jsonb(t) FROM auth.refresh_tokens t WHERE user_id IN ('${accounts[0].id}'::uuid,'${accounts[1].id}'::uuid)
 ) x`);
try {
 for(const who of ['a','b']){
  const email=`all12-restore-${who}-${nonce}@invalid.example`,password='A!'+randomBytes(24).toString('hex');
  const created=await req('POST','/auth/v1/admin/users',admin,{email,password,email_confirm:true});
  assert.ok([200,201].includes(created.status),'create synthetic account: '+created.status);
  const id=created.data.id;accounts.push({id,email,password});
  const login=await req('POST','/auth/v1/token?grant_type=password',anon,{email,password});
  assert.equal(login.status,200,'real synthetic password login');
  assert.ok(login.data.access_token&&login.data.refresh_token);
 }
 const ids=accounts.map(a=>`'${a.id}'::uuid`).join(',');
 assert.equal(Number(sql(`SELECT count(*) FROM auth.users WHERE id IN (${ids})`)),2);
 assert.equal(Number(sql(`SELECT count(*) FROM auth.identities WHERE user_id IN (${ids})`)),2);
 assert.ok(Number(sql(`SELECT count(*) FROM auth.sessions WHERE user_id IN (${ids})`))>=2);
 const before=fingerprint();
 // Ensure the disposable Auth tables contain only the two synthetic users.
 assert.equal(Number(sql('SELECT count(*) FROM auth.users')),2,'refuse to dump unrelated Auth accounts');
 docker(['pg_dump','-U','postgres','-d','postgres','-Fc','--data-only',
  '-t','auth.users','-t','auth.identities','-t','auth.sessions','-t','auth.refresh_tokens','-f',file]);
 // Delete via real Auth API, preserving referential cleanup behavior.
 for(const a of accounts){
  const deleted=await req('DELETE','/auth/v1/admin/users/'+a.id,admin);
  assert.ok([200,204].includes(deleted.status),'synthetic Auth delete: '+deleted.status);
 }
 assert.equal(Number(sql(`SELECT count(*) FROM auth.users WHERE id IN (${ids})`)),0);
 docker(['pg_restore','-U','postgres','-d','postgres','--data-only','--exit-on-error',file]);
 assert.equal(fingerprint(),before,'full-row Auth owner/identity/session/refresh fingerprint mismatch');
 for(const a of accounts){
  const login=await req('POST','/auth/v1/token?grant_type=password',anon,{email:a.email,password:a.password});
  assert.equal(login.status,200,'restored Auth password sign-in');
  const user=await fetch(url.origin+'/auth/v1/user',{headers:{apikey:anon,Authorization:'Bearer '+login.data.access_token}});
  assert.equal(user.status,200);
  assert.equal((await user.json()).id,a.id,'restored Auth owner binding');
 }
 console.log('PASS ALL-12: two real populated Auth owners, identities, sessions and refresh rows restored with full-row fingerprint and real login');
}finally{
 try{docker(['rm','-f',file]);}catch{}
 for(const a of accounts.reverse())try{await req('DELETE','/auth/v1/admin/users/'+a.id,admin);}catch{}
}
