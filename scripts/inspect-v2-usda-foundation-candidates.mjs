/**
 * ALL-228 pre-import only. Reads a verified, already-extracted Foundation JSON
 * snapshot, deterministically previews source identities against the existing
 * ingredient seed classifier. Does not import, persist, or publish facts.
 */
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {previewIngredientSeed} from '../apps/mobile-v2/src/features/cookbook/ingredientSeedPreview.ts';

export const APPROVED_RELEASE_SHA256='dd414cc9f1a132626bad354ef6655972c78b44aff14f16114dc899708663c579';
const maxRecords=10000;
const idPattern=/^[1-9][0-9]{0,11}$/;
function canonicalJson(value){
 if(Array.isArray(value))return '['+value.map(canonicalJson).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.keys(value).sort()
  .map(k=>JSON.stringify(k)+':'+canonicalJson(value[k])).join(',')+'}';
 return JSON.stringify(value);
}
const digest=value=>createHash('sha256').update(canonicalJson(value)).digest('hex');

/** No actual foods are declared calculation-ready by this preview. */
export function inspectFoundationCandidateJson(root,{archiveSha256,existing=[]}={}){
 if(archiveSha256!==APPROVED_RELEASE_SHA256)
  throw Error('Unrecognized USDA archive digest; explicit source review required.');
 if(!root||typeof root!=='object'||Array.isArray(root)
    ||!Array.isArray(root.FoundationFoods)
    ||root.FoundationFoods.length===0||root.FoundationFoods.length>maxRecords)
  throw Error('Expected bounded FoundationFoods JSON collection.');
 const candidates=[];
 const report={records:root.FoundationFoods.length,source_candidates:0,
  malformed_records:0,missing_nutrients:0,duplicate_nutrient_observations:0,
  unsupported_data_type:0};
 for(const row of root.FoundationFoods){
  if(!row||typeof row!=='object'||Array.isArray(row)){
   report.malformed_records++;continue;
  }
  const id=String(row.fdcId??'');
  const description=row.description;
  const dataType=row.dataType;
  if(!idPattern.test(id)||typeof description!=='string'||!description.trim()){
   report.malformed_records++;continue;
  }
  if(dataType!=='Foundation'){
   report.unsupported_data_type++;continue;
  }
  if(!Array.isArray(row.foodNutrients))report.missing_nutrients++;
  else{
   const seen=new Set();
   for(const item of row.foodNutrients){
    const key=JSON.stringify([item?.nutrient?.id??null,item?.nutrient?.unitName??null]);
    if(seen.has(key))report.duplicate_nutrient_observations++;
    seen.add(key);
   }
  }
  candidates.push({
   provider:'usda_fdc',source_data_type:'Foundation',
   external_record_id:id,payload_sha256:digest(row),description,
  });
 }
 report.source_candidates=candidates.length;
 const preview=previewIngredientSeed({
  snapshot_id:'usda-foundation-2026-10-29:'+archiveSha256,
  importer_version:'all228-foundation-candidate-preview-v1',
  candidates,existing,
 });
 return {report,preview_counts:preview.counts,
  // Source-key identity only; no raw nutrition facts or claimed review status.
  conflicts:preview.actions.filter(x=>x.action==='conflict').map(x=>x.source_key),
  publication_allowed:false};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [file,sha]=process.argv.slice(2);
 if(!file||!sha)throw Error('Usage: node --experimental-strip-types script.mjs verified.json exact-archive-sha256');
 const bytes=readFileSync(file);
 if(bytes.length>50000000)throw Error('USDA source JSON too large');
 const output=inspectFoundationCandidateJson(JSON.parse(bytes.toString('utf8')),{archiveSha256:sha});
 process.stdout.write(JSON.stringify(output,null,2)+'\n');
}
