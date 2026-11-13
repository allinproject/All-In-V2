import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {canonicalSql,quarantineCron,validateInventory} from './all12-replay-applied-v2-migrations-offline.mjs';
const dir=resolve(dirname(fileURLToPath(import.meta.url)),'../supabase/migrations');
const read=n=>readFileSync(join(dir,n),'utf8');
test('all 18 canonical applied migrations pass immutable digest provenance',()=>{
 const r=validateInventory(readdirSync(dir),read);
 assert.equal(r.length,18);
 assert.equal(r[6].name,'20261110124420_v2_provider_cache_cron_schedule.sql');
});
test('cron migration quarantines scheduling but retains its canonical pair of helper functions',()=>{
 const original=read('20261110124420_v2_provider_cache_cron_schedule.sql');
 const safe=quarantineCron(original);
 assert.match(safe,/create or replace function allin_private\.v2_provider_cache_prune_expired/i);
 assert.match(safe,/create or replace function public\.v2_provider_cache_prune_expired/i);
 assert.doesNotMatch(safe,/cron\.schedule|create extension|pg_net|vault\./i);
});
test('migration ledger rejects changes, absent migrations and unknown historical files',()=>{
 const names=readdirSync(dir);
 assert.throws(()=>validateInventory(names,n=>n===names.find(x=>x.startsWith('20261110021548'))?read(n)+'\n-- drift':read(n)));
 assert.throws(()=>validateInventory(names.filter(n=>!n.startsWith('20261110021548')),read));
 assert.throws(()=>validateInventory([...names,'20261111120000_unreviewed.sql'],read));
});
test('cron quarantine refuses changed scheduler structure',()=>{
 const original=read('20261110124420_v2_provider_cache_cron_schedule.sql');
 assert.throws(()=>quarantineCron(original.replace('select cron.schedule(', 'select pg_catalog.now(')));
});

test('Windows CRLF checkout normalizes to immutable canonical LF hashes without accepting SQL drift',()=>{
 const names=readdirSync(dir);
 const onWindows=n=>read(n).replace(/\r?\n/g,'\r\n');
 assert.equal(validateInventory(names,onWindows).length,18);
 assert.equal(canonicalSql('a\r\nb\r\n'),'a\nb\n');
 assert.throws(()=>validateInventory(names,n=>onWindows(n)+(n===names.find(x=>x.startsWith('20261110021548'))?'-- malicious edit':''))
 );
 assert.throws(()=>canonicalSql('bad\rending'));
});
