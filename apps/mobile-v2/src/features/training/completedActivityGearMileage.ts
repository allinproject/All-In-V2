/** ALL-243/251: derived gear mileage from canonical completed activity assignments.
 * This is a READ MODEL only: no second mileage store, workout mutation or
 * client-authored confirmation. The future ALL-243 writer owns assignment rows.
 * Existing profile PersonalGear.distanceKm is the manually entered pre-sync
 * baseline until a reviewed versioned migration offers a separate baseline.
 */
import type {PersonalGear,GearItem} from './personalGear.ts';

export type CanonicalGearAssignment={
 ownerId:string;activityId:string;activityVersion:number;
 gearId:string|null;
 /** One activity may have one selected shoe or bicycle (or no gear). */
 distanceKm:number|null;
 sport:'running'|'walking'|'hiking'|'rucking'|'cycling'|'other';
 /** Only a canonical owner-attested post-workout assignment credits mileage. */
 confirmed:boolean;
};
export type GearMileageRead={
 gearId:string;manualBaselineKm:number;completedDistanceKm:number;
 totalDistanceKm:number;activityCount:number;status:GearItem['status'];
};
const allowed=(gear:GearItem,assignment:CanonicalGearAssignment)=>{
 if(gear.kind==='shoes')return ['running','walking','hiking','rucking'].includes(assignment.sport);
 if(gear.kind==='bikes')return assignment.sport==='cycling';
 return false;
};
const roundKm=(n:number)=>Number(n.toFixed(6));
/** Expects a complete, server-owner-certified activity assignment snapshot.
 * No silent pagination / partial history: the caller must certify completeness.
 * Latest activity assignment replaces the old assignment; never feed historical
 * versions here as separate rows. Replays of one activity ID must be identical.
 */
export function deriveGearMileage(
 ownerId:string,gear:PersonalGear,assignments:readonly CanonicalGearAssignment[],
 completeHistory:boolean,
):GearMileageRead[]{
 if(!ownerId.trim()||!completeHistory)throw new Error('Complete owner-verified activity history required to compute gear mileage.');
 if(assignments.length>100000)throw new Error('Gear mileage activity snapshot exceeds limit.');
 const gearById=new Map(gear.items.map(x=>[x.id,x]));
 if(gearById.size!==gear.items.length)throw new Error('Duplicate personal gear IDs.');
 const unique=new Map<string,CanonicalGearAssignment>();
 for(const a of assignments){
  if(a.ownerId!==ownerId||!a.activityId.trim()||!Number.isSafeInteger(a.activityVersion)||a.activityVersion<1)
   throw new Error('Invalid activity owner or identity in gear mileage.');
  if(a.distanceKm!==null&&(!Number.isFinite(a.distanceKm)||a.distanceKm<0||a.distanceKm>100000))
   throw new Error('Invalid sourced activity distance.');
  if(a.gearId!==null&&(!gearById.has(a.gearId)||!allowed(gearById.get(a.gearId)!,a)))
   throw new Error('Unrecognized or incompatible activity gear assignment.');
  if(a.gearId!==null&&(!a.confirmed||a.distanceKm===null))
   throw new Error('Unconfirmed or incomplete gear activity assignment.');
  const prior=unique.get(a.activityId);
  if(prior&&JSON.stringify(prior)!==JSON.stringify(a))
   throw new Error('Conflicting activity assignments require canonical reconciliation.');
  unique.set(a.activityId,a);
 }
 const totals=new Map<string,{distance:number;count:number}>();
 for(const a of unique.values()){
  if(a.gearId===null)continue;
  const current=totals.get(a.gearId)??{distance:0,count:0};
  current.distance+=a.distanceKm!;
  current.count++;
  totals.set(a.gearId,current);
 }
 return gear.items.map(g=>{
  if(!Number.isFinite(g.distanceKm)||g.distanceKm<0)throw new Error('Invalid manual gear baseline.');
  const recorded=totals.get(g.id)??{distance:0,count:0};
  return {gearId:g.id,manualBaselineKm:g.distanceKm,completedDistanceKm:roundKm(recorded.distance),
   totalDistanceKm:roundKm(g.distanceKm+recorded.distance),activityCount:recorded.count,status:g.status};
 });
}
