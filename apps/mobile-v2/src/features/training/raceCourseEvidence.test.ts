import test from 'node:test';
import assert from 'node:assert/strict';
import {validateRaceCourseEvidence,type RaceCourseEvidence} from './raceCourseEvidence.ts';
const field=<T,>(value:T,source:'official_race_website'|'organizer_gpx'|'user_confirmed_manual'='official_race_website')=>({value,source,sourceUrl:source==='user_confirmed_manual'?null:'https://race.example/course',retrievedAt:'2026-11-09T12:00:00Z',confirmedByUser:source==='user_confirmed_manual'});
const sample=():RaceCourseEvidence=>({version:1,raceId:'race-1',eventDate:'2027-09-18',sourceUrls:['https://race.example'],routeFile:{kind:'gpx',fileRef:'user-upload-1',source:'organizer_gpx'},distance:field(80467),elevationGain:field(1200),elevationLoss:field(1100),surface:field('trail'),technicality:field('moderate'),aidStationStatus:field('available'),aidStations:[{id:'aid-1',distanceMeters:16000,name:'Aid 1',services:['water','fuel'],source:'official_race_website',sourceUrl:'https://race.example/aid',retrievedAt:'2026-11-09T12:00:00Z',confirmedByUser:false}],courseVersion:'race-course-v1',completeness:'partial',missingFields:[],warnings:[]});
test('accepts sourced course facts and retains ordered aid stations',()=>{const c=sample();c.aidStations.push({id:'aid-2',distanceMeters:40000,name:'Aid 2',services:['water'],source:'official_race_website',sourceUrl:'https://race.example/aid',retrievedAt:'2026-11-09T12:00:00Z',confirmedByUser:false});const v=validateRaceCourseEvidence(c);assert.equal(v.completeness,'verified');assert.deepEqual(v.aidStations.map(x=>x.id),['aid-1','aid-2'])});
test('missing elevation or aid station info leaves the course partial, not invented',()=>{const c=sample();c.elevationGain={value:null,source:null,sourceUrl:null,retrievedAt:null,confirmedByUser:false};c.aidStations=[];const v=validateRaceCourseEvidence(c);assert.equal(v.completeness,'partial');assert.ok(v.missingFields.includes('elevation_gain'));assert.ok(v.missingFields.includes('aid_stations'))});
test('rejects aid stations beyond course length and unsourced manual entries',()=>{const c=sample();c.aidStations[0].distanceMeters=90000;assert.throws(()=>validateRaceCourseEvidence(c));const d=sample();d.aidStations[0].source='user_confirmed_manual';d.aidStations[0].sourceUrl=null;d.aidStations[0].confirmedByUser=false;assert.throws(()=>validateRaceCourseEvidence(d))});
test('rejects unsafe source URL and invalid date',()=>{const c=sample();c.sourceUrls=['http://race.example'];assert.throws(()=>validateRaceCourseEvidence(c));const d=sample();d.eventDate='2027-02-30';assert.throws(()=>validateRaceCourseEvidence(d))});

test('distinguishes confirmed no aid stations from missing aid station information',()=>{const c=sample();c.aidStationStatus=field('none');c.aidStations=[];const v=validateRaceCourseEvidence(c);assert.equal(v.completeness,'verified');assert.ok(!v.missingFields.includes('aid_stations'))});
test('rejects an aid station list when official course status says none',()=>{const c=sample();c.aidStationStatus=field('none');assert.throws(()=>validateRaceCourseEvidence(c))});

test('race evidence rejects malformed lists and route-file metadata before use',()=>{
 const badWarnings=sample();(badWarnings as any).warnings=null;
 assert.throws(()=>validateRaceCourseEvidence(badWarnings),/warnings and missing fields/);
 const badRoute=sample();(badRoute.routeFile as any).kind='unknown';
 assert.throws(()=>validateRaceCourseEvidence(badRoute),/route file metadata/);
 const missingFile=sample();(missingFile.routeFile as any).fileRef=' ';
 assert.throws(()=>validateRaceCourseEvidence(missingFile),/route file metadata/);
});

test('Coach rejects aid stations when availability is unknown or has no evidence',()=>{
 const unknown=sample();unknown.aidStationStatus=field('unknown');
 assert.throws(()=>validateRaceCourseEvidence(unknown),/sourced available status/);
 const missing=sample();missing.aidStationStatus={value:null,source:null,sourceUrl:null,retrievedAt:null,confirmedByUser:false};
 assert.throws(()=>validateRaceCourseEvidence(missing),/sourced available status/);
});

test('aid stations need nonempty IDs and explicit confirmation flag',()=>{
 const emptyId=sample();emptyId.aidStations[0].id=' ';
 assert.throws(()=>validateRaceCourseEvidence(emptyId),/Aid station identity/);
 const noConfirmation=sample();(noConfirmation.aidStations[0] as any).confirmedByUser=undefined;
 assert.throws(()=>validateRaceCourseEvidence(noConfirmation),/Aid station identity/);
});
