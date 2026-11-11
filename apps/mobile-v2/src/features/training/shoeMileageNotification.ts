/** ALL-251/237: recommendation eligibility for the EXISTING notification owner.
 * Only produces a candidate. ALL-237 owns permission, quiet hours, push
 * budgets, durable decision ledger, delivery and device token registration.
 */
import type {GearItem} from './personalGear.ts';
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
