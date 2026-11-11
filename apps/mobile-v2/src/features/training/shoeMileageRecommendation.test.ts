import test from 'node:test';
import assert from 'node:assert/strict';
import {BROOKS_GENERAL_RECOMMENDATION,lookupVerifiedShoeMileage,
 validateShoeMileageRecommendation,replacementMileageStatus} from './shoeMileageRecommendation.ts';
import {addPersonalGear,emptyPersonalGear,parsePersonalGear,personalGearPatch,
 setShoeMileageRecommendation} from './personalGear.ts';
import {shoeMileageAlertCandidate} from './shoeMileageNotification.ts';
import {notificationDecisionKey,evaluateNotification,type NotificationPreferences} from '../notifications/notificationPolicy.ts';

test('Adrenaline uses verified Brooks brand guidance, not invented model-specific lifespan',()=>{
 const x=lookupVerifiedShoeMileage('Brooks Adrenaline GTS 25');
 assert.deepEqual(x,BROOKS_GENERAL_RECOMMENDATION);
 assert.equal(x?.scope,'manufacturer_general');
 assert.equal(Math.round(x!.maxKm/1.609344),500);
 assert.equal(lookupVerifiedShoeMileage('unverified other brand'),null);
});
test('save recommendation and independently editable alert in canonical training preferences',()=>{
 const rec=lookupVerifiedShoeMileage('Brooks Adrenaline GTS 25')!;
 const shoe={id:'shoe-1',name:'Brooks Adrenaline GTS 25',kind:'shoes' as const,
  use:'road' as const,status:'active' as const,distanceKm:100,reminderKm:rec.recommendedAlertKm,recommendation:rec};
 const gear=addPersonalGear(emptyPersonalGear(),shoe);
 const parsed=parsePersonalGear({training_preferences:personalGearPatch(gear)});
 assert.deepEqual(parsed,gear);
 const changed=setShoeMileageRecommendation(parsed,'shoe-1',rec,400*1.609344);
 assert.equal(Math.round(changed.items[0].reminderKm!/1.609344),400);
 assert.equal(Math.round(changed.items[0].recommendation!.maxKm/1.609344),500);
});
test('legacy gear remains intact, invalid research does not become a specific model claim',()=>{
 const shoe={id:'legacy-shoe',name:'Old shoe',kind:'shoes' as const,use:'road' as const,
  status:'active' as const,distanceKm:15,reminderKm:null};
 const gear=addPersonalGear(emptyPersonalGear(),shoe);
 assert.deepEqual(parsePersonalGear({training_preferences:personalGearPatch(gear)}),gear);
 assert.throws(()=>validateShoeMileageRecommendation({
  ...BROOKS_GENERAL_RECOMMENDATION,scope:'model_specific',modelMatch:null,
 }),/invalid shoe mileage/);
});
test('one notification key per shoe and selected target, not per subsequent activity',()=>{
 const rec=lookupVerifiedShoeMileage('Brooks Adrenaline GTS')!;
 const shoe={id:'shoe-1',name:'Brooks Adrenaline GTS',kind:'shoes' as const,
 use:'road' as const,status:'active' as const,distanceKm:0,reminderKm:rec.recommendedAlertKm,recommendation:rec};
 const date='2026-11-11T17:00:00Z';
 assert.equal(shoeMileageAlertCandidate('owner-A',shoe,rec.recommendedAlertKm-1,date),null);
 const first=shoeMileageAlertCandidate('owner-A',shoe,rec.recommendedAlertKm,date)!;
 const second=shoeMileageAlertCandidate('owner-A',shoe,rec.recommendedAlertKm+200,date)!;
 assert.equal(notificationDecisionKey(first),notificationDecisionKey(second));
 const prefs:NotificationPreferences={
  pushPermission:true,pushEnabled:true,enabledCategories:{equipment_review:true},localMinuteOfDay:600,
  quietStartMinute:1320,quietEndMinute:420,remainingPushBudget:3,safetyPushEnabled:false,
  deliveredDecisionKeys:new Set([notificationDecisionKey(first)]),
 };
 assert.equal(evaluateNotification(second,prefs,date).reason,'already_delivered');
 assert.equal(shoeMileageAlertCandidate('owner-A',{...shoe,status:'retired'},rec.recommendedAlertKm,date),null);
 assert.equal(replacementMileageStatus(rec.recommendedAlertKm,rec.recommendedAlertKm),'target_reached');
});
