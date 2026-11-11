/** ALL-251 / ALL-237: shoe model lifespan recommendation contract.
 * Manufacturer-brand guidance is not presented as model-specific testing.
 * A future verified product research endpoint can supply exact models using
 * the same vetted evidence contract; this pure module makes no network calls.
 */
export type ShoeMileageRecommendation={
 minKm:number;maxKm:number;recommendedAlertKm:number;
 scope:'manufacturer_general'|'model_specific'|'industry_general';
 sourceName:string;sourceUrl:string|null;modelMatch:string|null;
};
const MI_TO_KM=1.609344;
const milesToKm=(n:number)=>Math.round(n*MI_TO_KM*1000)/1000;
const valid=(s:unknown,max=200)=>typeof s==='string'&&s.trim().length>0&&s.length<=max;
const finite=(n:number)=>Number.isFinite(n)&&n>=0&&n<=100000;
const BROOKS_SOURCE='https://support.brooksrunning.com/hc/en-us/articles/10043139042843-When-is-it-time-to-replace-my-shoes';
export const BROOKS_GENERAL_RECOMMENDATION:ShoeMileageRecommendation={
 minKm:milesToKm(300),maxKm:milesToKm(500),recommendedAlertKm:milesToKm(500),
 scope:'manufacturer_general',sourceName:'Brooks Running — When is it time to replace my shoes?',
 sourceUrl:BROOKS_SOURCE,modelMatch:null,
};
/** Research a typed shoe name against an allowlisted, actually verified
 * manufacturer guidance. This is an offline baseline, not live product search.
 */
export function lookupVerifiedShoeMileage(modelName:string):ShoeMileageRecommendation|null{
 const name=modelName.trim().toLowerCase();
 if(!name)return null;
 if(/\bbrooks\b/.test(name)||/\badrenaline\s*gts\b/.test(name))
  return {...BROOKS_GENERAL_RECOMMENDATION};
 return null;
}
/** Validate future verified model/provider output before saving in Profile. */
export function validateShoeMileageRecommendation(x:ShoeMileageRecommendation):ShoeMileageRecommendation{
 if(!finite(x.minKm)||!finite(x.maxKm)||!finite(x.recommendedAlertKm)||
 x.minKm<=0||x.minKm>x.maxKm||x.recommendedAlertKm<x.minKm||
 x.recommendedAlertKm>x.maxKm||!valid(x.sourceName,200)||
 !['manufacturer_general','model_specific','industry_general'].includes(x.scope)||
 (x.sourceUrl!==null&&(!/^https:\/\//.test(x.sourceUrl)||x.sourceUrl.length>500))||
 (x.modelMatch!==null&&!valid(x.modelMatch,160))||
 (x.scope==='model_specific'&&(!x.modelMatch||!x.sourceUrl)))
  throw new Error('Unverified or invalid shoe mileage recommendation.');
 return {...x};
}
export function replacementMileageStatus(
 currentDistanceKm:number,alertKm:number|null,
):'unavailable'|'below_target'|'target_reached'{
 if(!finite(currentDistanceKm)||alertKm===null||!finite(alertKm)||alertKm<=0)return 'unavailable';
 return currentDistanceKm>=alertKm?'target_reached':'below_target';
}
