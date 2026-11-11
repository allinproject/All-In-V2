import test from 'node:test';
import assert from 'node:assert/strict';
import { previewV2AccountExport, removeV2ExportFile, type V2ExportFile } from './accountExportFile.ts';

function fixture(failure?: 'write' | 'preview') {
  let exists = false;
  const events: string[] = [];
  const file: V2ExportFile = {
    uri: 'file:///app/cache/allin365-private-export.json',
    get exists() { return exists; },
    create() { events.push('create'); exists = true; },
    async write(content) {
      events.push('write:' + content);
      if (failure === 'write') throw new Error('write failed');
    },
    async preview({title}) {
      events.push('preview:' + title);
      if (failure === 'preview') throw new Error('preview failed');
    },
    delete() { events.push('delete'); exists = false; },
  };
  return { file, events };
}
test('writes and previews a real file, retaining it for the viewer', async () => {
  const f = fixture();
  await previewV2AccountExport('{"export":true}', f.file, async () => { f.events.push('verify'); return true; });
  assert.deepEqual(f.events.slice(0,3), ['create','write:{"export":true}','verify']);
  assert.match(f.events[3], /^preview:/);
  assert.equal(f.file.exists,true);
  removeV2ExportFile(f.file);
  assert.equal(f.file.exists,false);
});
test('aborts and removes file when owner changes after write', async () => {
  const f = fixture();
  await assert.rejects(previewV2AccountExport('{}', f.file, async () => false),/account changed/);
  assert.equal(f.events.some(event => event.startsWith('preview:')),false);
  assert.equal(f.file.exists,false);
});
test('write failure cleans up partial sensitive file', async () => {
  const f = fixture('write');
  await assert.rejects(previewV2AccountExport('{}', f.file,async()=>true),/write failed/);
  assert.equal(f.file.exists,false);
});
test('native preview failure cleans up sensitive file', async () => {
  const f = fixture('preview');
  await assert.rejects(previewV2AccountExport('{}', f.file,async()=>true),/preview failed/);
  assert.equal(f.file.exists,false);
});
test('clean up old file before overwriting temporary export', async () => {
  const f = fixture();
  f.file.create();
  await previewV2AccountExport('{}', f.file,async()=>true);
  assert.deepEqual(f.events.slice(0,3), ['create','delete','create']);
});
test('rejects malformed URI without writing', async () => {
  const f = fixture();
  const file = { ...f.file, uri: 'https://example.com/a.json' };
  await assert.rejects(previewV2AccountExport('{}',file,async()=>true),/unavailable/);
  assert.deepEqual(f.events,[]);
});
