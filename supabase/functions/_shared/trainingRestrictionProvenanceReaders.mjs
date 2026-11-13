/**
 * ALL-230/251 — Observation-only provenance readers for the existing Training
 * restriction owner. No imported/legacy/restore completeness is inferred from
 * a database query returning zero rows. The caller MUST NOT promote these
 * observations into first-certification evidence without independently proven
 * source inventories and an accepted ALL-12 restoration receipt.
 */
import {readCanonicalCurrentRestrictionSource} from './trainingRestrictionSourceReader.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SELECT_LIMIT=201;
function check({client,ownerId,snapshotVersion}) {
 if(typeof client?.query!=='function'||!UUID.test(ownerId??'')
   ||typeof snapshotVersion!=='string'||!snapshotVersion.trim()
   ||snapshotVersion.length>160)
  throw Error('Pinned Training provenance owner and snapshot required');
}
async function scopedRead({client,ownerId,sql,label}) {
 const result=await client.query(sql,[ownerId]);
 if(!Array.isArray(result?.rows)||result.rows.length>=SELECT_LIMIT)
  throw Error(label+' source is unbounded or incomplete');
 if(result.rows.some(r=>r===null||typeof r!=='object'
  ||r.user_id!==ownerId||r.record===null||typeof r.record!=='object'
  ||r.record.user_id!==ownerId))
  throw Error(label+' source contains foreign or malformed owner record');
 return result.rows;
}
const result=(kind,ownerId,snapshotVersion,records,reason)=>Object.freeze({
 kind,ownerId,snapshotVersion,records,
 // These are observable subsets of the canonical V2 database, not proof
 // that every historical V1, import job or external restored file was scanned.
 exhaustive:false,nextCursor:null,
 evidenceRef:'training-observation:'+snapshotVersion+':'+kind,
 coverageBlocker:reason,
});
export async function readCanonicalHistoricalRestrictionSource(args) {
 check(args);
 const rows=await scopedRead({...args,label:'Historical restriction',
  sql:`SELECT user_id,pg_catalog.to_jsonb(r) AS record
  FROM public.v2_training_athlete_restrictions r
  WHERE r.user_id=$1 AND r.status='retired'
  ORDER BY r.id LIMIT 201`});
 return result('historical_records',args.ownerId,args.snapshotVersion,
  rows.map(r=>({user_id:r.user_id,record:r.record})),
  'Legacy and pre-V2 history completeness not independently attested');
}
/**
 * Imported revisions are ONLY revisions whose canonical source_kind marks
 * imported_template. The source_ref of an approved-plan restriction must
 * explicitly match one of the observed accepted imported revision IDs. We
 * do not guess a free-text match to template names or infer imports from Coach.
 */
export async function readCanonicalImportedTrainingSource(args) {
 check(args);
 const rows=await scopedRead({...args,label:'Imported Training',
  sql:`SELECT user_id,kind,record FROM (
   SELECT r.user_id,
    CASE WHEN r.source_kind='imported_template'
     THEN 'imported_revision'::text ELSE 'approved_revision'::text END AS kind,
    pg_catalog.to_jsonb(r) AS record
   FROM public.v2_training_plan_revisions r
   WHERE r.user_id=$1 AND r.accepted_at IS NOT NULL
    AND r.status IN ('accepted','superseded','archived')
   UNION ALL
   SELECT c.user_id,'linked_restriction'::text AS kind,
    pg_catalog.to_jsonb(c) AS record
   FROM public.v2_training_athlete_restrictions c
   WHERE c.user_id=$1 AND c.source='approved_plan'
  ) source
  ORDER BY kind,record->>'id' LIMIT 201`});
 const records=rows.map(r=>({user_id:r.user_id,kind:r.kind,record:r.record}));
 // Approved-plan rules can originate from imported OR athlete-authored
 // accepted revisions. Do not falsely classify a native approved-plan rule
 // as an orphan import. Unknown/legacy references still require review.
 const acceptedRevisions=new Map(records
  .filter(r=>r.kind==='imported_revision'||r.kind==='approved_revision')
  .map(r=>[r.record.id,r.kind]));
 const unresolved=records.filter(r=>r.kind==='linked_restriction'
  &&(!r.record.source_ref||!acceptedRevisions.has(r.record.source_ref)));
 return Object.freeze({
  ...result('imported_records',args.ownerId,args.snapshotVersion,records,
   'Import-job completeness and original mapping provenance not independently attested'),
  observedUnresolvedMappings:unresolved.map(r=>r.record.id),
 });
}
/**
 * A restore cannot be evidenced from the same database rows being restored.
 * The independent ALL-12 archive/restore acceptance still has pending-schema
 * status for restriction evidence. No fabricated zero-row restore proof.
 */
export async function readCanonicalRestoredRestrictionSource(args) {
 check(args);
 throw Error('ALL-12 independent restriction restoration proof unavailable; source cannot be attested');
}
/**
 * Review observed subsets against the current canonical owner inventory.
 * This checks the observable mapping, NOT source completeness or authority
 * to issue an initial certification.
 */
// Raw pg rows use Date while pg_catalog.to_jsonb(row) yields timestamp
// strings. Compare normalized values, not object insertion/key ordering.
const canonicalValue=(value,key='')=>{
 if(value instanceof Date){
  if(!Number.isFinite(value.getTime()))throw Error('Invalid canonical timestamp');
  return value.toISOString();
 }
 if(typeof value==='string'&&/^(?:created_at|updated_at|retired_at)$/.test(key)){
  const t=Date.parse(value);
  if(!Number.isFinite(t))throw Error('Invalid canonical timestamp');
  return new Date(t).toISOString();
 }
 if(Array.isArray(value))return value.map(x=>canonicalValue(x,key));
 if(value&&typeof value==='object')
  return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonicalValue(value[k],k)]));
 if(value===undefined)return null;
 return value;
};
const matchingRow=(a,b)=>JSON.stringify(canonicalValue(a))===JSON.stringify(canonicalValue(b));
export function reconcileObservedRestrictionSources({ownerId,currentRules,history,imports}) {
 if(!UUID.test(ownerId??'')||!Array.isArray(currentRules)
   ||history?.ownerId!==ownerId||imports?.ownerId!==ownerId
   ||!Array.isArray(history.records)||!Array.isArray(imports.records))
  throw Error('Canonical owner provenance inputs required');
 const rules=new Map();
 const reasons=[];
 for(const rule of currentRules) {
  if(rule?.user_id!==ownerId||typeof rule.id!=='string'
    ||rules.has(rule.id))reasons.push('invalid_or_duplicate_canonical_rule');
  else rules.set(rule.id,rule);
 }
 const retired=new Set();
 for(const row of history.records) {
  const rule=row?.record;
  if(row.user_id!==ownerId||rule?.user_id!==ownerId
    ||rule?.status!=='retired'||!rules.has(rule.id)
    ||!matchingRow(rule,rules.get(rule.id)))
   reasons.push('unmatched_historical_rule');
  else retired.add(rule.id);
 }
 for(const rule of rules.values())
  if(rule.status==='retired'&&!retired.has(rule.id))
   reasons.push('missing_observed_retired_rule');
 if(imports.observedUnresolvedMappings?.length)
  reasons.push('unresolved_imported_restriction_mapping');
 if(history.exhaustive!==true||imports.exhaustive!==true)
  reasons.push('independent_source_completeness_unverified');
 return {status:reasons.length?'blocked':'review_required',
  reasons:[...new Set(reasons)],recordedRules:rules.size,
  observedRetired:retired.size,
  observedImported:imports.records.filter(r=>r.kind==='imported_revision').length,
  firstCertificationAuthorized:false};
}

/**
 * Single pinned-transaction inspection of all three remaining source
 * categories, reconciled with actual canonical rules. This is NOT a writer:
 * ALL-12 restore proof is independent, so the report must always be blocked
 * until that evidence is verified and a complete legacy/import inventory
 * is accepted. Do not turn 'no observations' into 'no restrictions'.
 */
export async function inspectCanonicalRestrictionProvenance(args) {
 check(args);
 const [current,history,imports]=await Promise.all([
  readCanonicalCurrentRestrictionSource(args),
  readCanonicalHistoricalRestrictionSource(args),
  readCanonicalImportedTrainingSource(args),
 ]);
 const assessment=reconcileObservedRestrictionSources({
  ownerId:args.ownerId,currentRules:current.records,history,imports,
 });
 let restoration='unverified';
 try {
  await readCanonicalRestoredRestrictionSource(args);
 }catch(e) {
  if(!String(e?.message).includes('independent restriction restoration proof unavailable'))
   throw e;
 }
 return Object.freeze({
  ownerId:args.ownerId,snapshotVersion:args.snapshotVersion,
  canonicalRuleCount:assessment.recordedRules,
  retiredCount:assessment.observedRetired,
  observedImportedRevisions:assessment.observedImported,
  missingOrConflictingMappings:assessment.reasons,
  restoration,
  historicalComplete:false,importComplete:false,restorationComplete:false,
  status:'blocked',initialCertificationAuthorized:false,
 });
}
