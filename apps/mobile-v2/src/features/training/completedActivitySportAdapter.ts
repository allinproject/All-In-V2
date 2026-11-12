/** ALL-243/246: canonical activity sport -> V1-standard presentation policy.
 * Does not mutate sport identity or infer terrain from a route, source or shoes.
 * Unrecognized subtype must not silently relabel one sport as another.
 */
import {v1SportBaseline,type V1CompletedActivitySport} from './v1CompletedActivityBaseline.ts';

export type ActivityPresentationSport={
 sport:V1CompletedActivitySport;
 terrain:'road'|'trail'|null;
 /** A presentation fallback is NOT a claim that all sport-specific metrics exist. */
 fallback:boolean;
};
const token=(value:unknown)=>typeof value==='string'?
 value.trim().toLowerCase().replace(/[\s-]+/g,'_'):'';
const normalized=(value:unknown)=>token(value);
const validSubtypes:Record<string,readonly string[]>={
 running:['','road','trail','outdoor','treadmill','indoor','track'],
 walking:['','road','trail','outdoor','indoor','treadmill'],
 hiking:['','trail','outdoor'],
 rucking:['','road','trail','outdoor'],
 cycling:['','road','trail','outdoor','indoor','trainer','stationary','mountain','gravel'],
 swimming:['','pool','open_water','openwater','outdoor','indoor'],
 strength:['','gym','home','bodyweight'],
 rowing:['','indoor','outdoor','machine'],
 elliptical:['','indoor','machine'],
 stair:['','indoor','machine','stepper'],
 yoga:['','home','studio'],
 mobility:['','home','studio'],
 hiit:['','indoor','outdoor','gym','home'],
 multisport:['','triathlon','duathlon','brick','hybrid'],
 other:[''],
};
/** Matches the exact canonical sport vocabulary of the ALL-243 metric registry.
 * Display labels such as outdoor_run and pool_swim are not registry scopes. */
export function isCanonicalActivitySport(value:unknown):value is string{
 return typeof value==='string'&&Object.prototype.hasOwnProperty.call(validSubtypes,value);
}
export function resolveActivityPresentationSport(canonicalSport:string,subtype?:string|null):ActivityPresentationSport{
 const sport=normalized(canonicalSport),kind=normalized(subtype);
 const valid=isCanonicalActivitySport(sport)?validSubtypes[sport]:undefined;
 if(!valid||!valid.includes(kind))throw new Error('Unsupported activity sport or subtype; review the recorded identity.');
 let view:V1CompletedActivitySport;
 switch(sport){
  case 'running':view=kind==='treadmill'||kind==='indoor'?'treadmill':'outdoor_run';break;
  case 'walking':view=kind==='treadmill'?'treadmill':'walk';break;
  case 'hiking':view='hike';break;
  case 'rucking':view='ruck';break;
  case 'cycling':view=['indoor','trainer','stationary'].includes(kind)?'indoor_trainer':'outdoor_ride';break;
  case 'swimming':view=kind==='pool'||kind==='indoor'?'pool_swim':
   ['open_water','openwater','outdoor'].includes(kind)?'open_water_swim':'swim';break;
  case 'hiit':view='hiit';break;
  case 'multisport':view='hybrid';break;
  case 'strength':view='strength';break;
  case 'elliptical':view='elliptical';break;
  case 'stair':view='stairs';break;
  case 'yoga':case 'mobility':view='yoga_mobility';break;
  // Separate V2 rowing presentation was recovered from the design-approved
  // V1 metric registry; the original V1 17-sport transcription stays intact.
  case 'rowing':view='rowing';break;
  case 'other':view='other';break;
  default:throw new Error('Unsupported canonical sport.');
 }
 if(!v1SportBaseline(view))throw new Error('Missing approved sport presentation policy.');
 return {sport:view,terrain:['road','trail'].includes(kind)?kind as 'road'|'trail':null,
  fallback:sport==='other'};
}
