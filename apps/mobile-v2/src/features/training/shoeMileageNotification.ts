/** ALL-251/237: recommendation eligibility for the EXISTING notification owner.
 * Only produces a candidate. ALL-237 owns permission, quiet hours, push
 * budgets, durable decision ledger, delivery and device token registration.
 */
import type {GearItem,PersonalGear} from './personalGear.ts';
import {deriveGearMileage,type CanonicalGearAssignment} from './completedActivityGearMileage.ts';
import type {NotificationCandidate} from '../notifications/notificationPolicy.ts';
export function shoeMileageAlertCandidate(
 ownerId:string,shoe:GearItem,verifiedTotalKm:number,nowIso:string,
):NotificationCandidate|null{
 if(!ownerId.trim()||shoe.kind!=='shoes'||shoe.status!=='active'||
   shoe.reminderKm===null||!Number.isFinite(shoe.reminderKm)||shoe.reminderKm<=0||
   !Number.isFinite(verifiedTotalKm)||verifiedTotalKm<shoe.reminderKm||
   !Number.isFinite(Date.parse(nowIso))||!/(Z|[+-]\d{2}:\d{2})$/.test(nowIso))return null;
 // One decision key per shoe and selected target, not per workout or activity.
 // A new workout past the target doesn't issue another notification.
 const milestone=shoe.reminderKm.toFixed(3);
 return {ownerId,sourceId:shoe.id,category:'equipment_review',
  materialRevision:'shoe-lifespan-target-km:'+milestone,priority:'actionable',
  scheduledFor:nowIso,expiresAt:new Date(Date.parse(nowIso)+7*86400000).toISOString(),
  sourceStatus:'active',userResponse:'none',actionableNow:true};
}

/** Source-ready bridge: compute totals from the existing verified complete
 * activity ledger, then propose one notification per shoe and selected target.
 * Real push dispatch remains with the existing ALL-237 notification owner.
 */
export function shoeMileageCandidatesFromActivities(
 ownerId:string,gear:PersonalGear,assignments:readonly CanonicalGearAssignment[],
 completeHistory:boolean,nowIso:string,
):NotificationCandidate[]{
 const totals=deriveGearMileage(ownerId,gear,assignments,completeHistory);
 const totalById=new Map(totals.map(t=>[t.gearId,t.totalDistanceKm]));
 return gear.items.flatMap(item=>{
  const distance=totalById.get(item.id);
  if(distance===undefined)return [];
  const candidate=shoeMileageAlertCandidate(ownerId,item,distance,nowIso);
  return candidate?[candidate]:[];
 });
}
