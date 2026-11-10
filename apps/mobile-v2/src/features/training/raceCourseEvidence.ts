/**
 * V2 race-course evidence intake contract.
 * Facts are field-level provenance; no aid station/course detail is invented.
 */
export type RaceCourseFieldSource='official_race_website'|'organizer_gpx'|'user_uploaded_gpx'|'user_confirmed_manual'|'verified_routing_provider';
export type RaceCourseField<T>={value:T|null;source:RaceCourseFieldSource|null;sourceUrl:string|null;retrievedAt:string|null;confirmedByUser:boolean};
export type RaceAidStation={
 id:string;distanceMeters:number;name:string|null;services:string[];
 source:RaceCourseFieldSource;sourceUrl:string|null;retrievedAt:string|null;confirmedByUser:boolean;
};
export type RaceCourseEvidence={
 version:1;
 raceId:string;
 eventDate:string;
 sourceUrls:string[];
 routeFile:{kind:'gpx'|'fit'|'tcx'|'geojson';fileRef:string;source:RaceCourseFieldSource}|null;
 distance:RaceCourseField<number>;
 elevationGain:RaceCourseField<number>;
 elevationLoss:RaceCourseField<number>;
 surface:RaceCourseField<'road'|'trail'|'mixed'|'track'|'open_water'|'other'>;
 technicality:RaceCourseField<'low'|'moderate'|'high'|'unknown'>;
 aidStations:RaceAidStation[];
 courseVersion:string;
 completeness:'verified'|'partial'|'unverified';
 missingFields:string[];
 warnings:string[];
};
function validDate(v:string):boolean{return /^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T12:00:00Z'))&&new Date(v+'T12:00:00Z').toISOString().slice(0,10)===v}
function validSource(v:unknown):v is RaceCourseFieldSource{return ['official_race_website','organizer_gpx','user_uploaded_gpx','user_confirmed_manual','verified_routing_provider'].includes(String(v))}
function validUrl(v:string|null):boolean{if(v===null)return true;try{const u=new URL(v);return u.protocol==='https:';}catch{return false}}
function validField<T>(field:RaceCourseField<T>,valid:(v:T)=>boolean):boolean{
 return Boolean(field&&((field.value===null&&field.source===null)||(field.value!==null&&valid(field.value)&&validSource(field.source)))&&validUrl(field.sourceUrl)&&
 (field.retrievedAt===null||Number.isFinite(Date.parse(field.retrievedAt)))&&typeof field.confirmedByUser==='boolean');
}
/** Fail closed when field provenance is absent, aid stations are outside course, or identity is malformed. */
export function validateRaceCourseEvidence(raw:RaceCourseEvidence):RaceCourseEvidence{
 if(!raw||raw.version!==1||!raw.raceId||!validDate(raw.eventDate)||!raw.courseVersion||!Array.isArray(raw.sourceUrls)||!Array.isArray(raw.aidStations))throw new Error('Race identity, event date, source URLs and course version are required.');
 if(!raw.sourceUrls.every(validUrl)||raw.sourceUrls.some(x=>x===null))throw new Error('Race source URLs must be HTTPS.');
 if(!validField(raw.distance,(n)=>Number.isFinite(n)&&n>0&&n<=1000000))throw new Error('Course distance needs a value and source provenance.');
 if(!validField(raw.elevationGain,(n)=>Number.isFinite(n)&&n>=0&&n<=100000))throw new Error('Elevation gain needs a valid sourced value or explicit unknown.');
 if(!validField(raw.elevationLoss,(n)=>Number.isFinite(n)&&n>=0&&n<=100000))throw new Error('Elevation loss needs a valid sourced value or explicit unknown.');
 if(!validField(raw.surface,(v)=>['road','trail','mixed','track','open_water','other'].includes(v)))throw new Error('Surface value or provenance is invalid.');
 if(!validField(raw.technicality,(v)=>['low','moderate','high','unknown'].includes(v)))throw new Error('Technicality value or provenance is invalid.');
 if(!validField(raw.aidStationStatus,(v)=>['available','none','unknown'].includes(v)))throw new Error('Aid-station availability needs sourced or confirmed status.');
 if(raw.aidStationStatus.value==='none'&&raw.aidStations.length>0)throw new Error('A course confirmed to have no aid stations cannot contain aid station entries.');
 const distance=raw.distance.value;
 const ids=new Set<string>();
 const stations=raw.aidStations.map(s=>{
  if(!s||!s.id||ids.has(s.id)||!Number.isFinite(s.distanceMeters)||s.distanceMeters<0||distance===null||s.distanceMeters>distance||
    !validSource(s.source)||!validUrl(s.sourceUrl)||(s.retrievedAt!==null&&!Number.isFinite(Date.parse(s.retrievedAt)))||
    !Array.isArray(s.services)||!s.services.every(x=>typeof x==='string'))throw new Error('Aid station identity, distance, source or course bounds are invalid.');
  ids.add(s.id);
  if(!s.confirmedByUser&&s.source==='user_confirmed_manual')throw new Error('Manually entered aid stations must be confirmed by the user.');
  return{...s,services:[...new Set(s.services)]};
 }).sort((a,b)=>a.distanceMeters-b.distanceMeters);
 const missing:string[]=[];
 if(raw.distance.value===null)missing.push('distance');
 if(raw.elevationGain.value===null)missing.push('elevation_gain');
 if(raw.surface.value===null)missing.push('surface');
 if(raw.technicality.value===null)missing.push('technicality');
 if(raw.aidStationStatus.value===null||raw.aidStationStatus.value==='unknown'||(raw.aidStationStatus.value==='available'&&raw.aidStations.length===0))missing.push('aid_stations');
 const warnings=[...raw.warnings];
 if(stations.some(s=>!s.confirmedByUser&&s.source!=='official_race_website'&&s.source!=='organizer_gpx'&&s.source!=='verified_routing_provider'))warnings.push('One or more aid stations are user-provided but not user-confirmed.');
 if(stations.some(s=>!s.sourceUrl&&s.source!=='user_confirmed_manual'&&s.source!=='user_uploaded_gpx'))warnings.push('One or more course/aid facts do not have a retrievable source URL; retain provenance and review.');
 return{...raw,aidStations:stations,missingFields:missing,warnings:[...new Set(warnings)],completeness:missing.length===0?'verified':raw.distance.value!==null?'partial':'unverified'};
}
