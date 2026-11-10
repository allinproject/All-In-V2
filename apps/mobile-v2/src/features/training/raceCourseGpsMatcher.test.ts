import test from 'node:test';
import assert from 'node:assert/strict';
import {readRaceGpx} from './raceCourseGpxReader.ts';
import {matchRaceCourseGpsPosition,type RaceCourseGpsMatchState} from './raceCourseGpsMatcher.ts';
import type {RaceCourseEvidence} from './raceCourseEvidence.ts';

const evidence=():Pick<RaceCourseEvidence,'raceId'|'courseVersion'|'routeFile'|'routeId'>=>({
 raceId:'race-2027',routeId:'route-2027',courseVersion:'official-final-v2',
 routeFile:{kind:'gpx',fileRef:'private-upload-ref',source:'organizer_gpx'},
});
const gpx=(points:Array<[number,number,number]>)=>`<gpx><trk><trkseg>${points.map(([lat,lon,ele])=>`<trkpt lat="${lat}" lon="${lon}"><ele>${ele}</ele></trkpt>`).join('')}</trkseg></trk></gpx>`;
const course=(points:Array<[number,number,number]>)=>readRaceGpx(gpx(points),evidence());
const fix=(patch:Partial<{latitude:number;longitude:number;horizontalAccuracyMeters:number;capturedAtMs:number}>={})=>({
 latitude:44.9505,longitude:-93.1,horizontalAccuracyMeters:5,capturedAtMs:100000,...patch,
});

test('projects a close accurate GPS fix onto a versioned route segment',()=>{
 const route=course([[44.95,-93.1,250],[44.951,-93.1,260],[44.952,-93.1,270]]);
 const result=matchRaceCourseGpsPosition(route,fix(),null);
 assert.equal(result.status,'trusted',result.status==='untrusted'?result.reason+'; cross='+result.crossTrackDistanceMeters:'');
 if(result.status!=='trusted')return;
 assert.equal(result.raceId,'race-2027');
 assert.equal(result.courseVersion,'official-final-v2');
 assert.ok(result.distanceOnCourseMeters>45&&result.distanceOnCourseMeters<70);
 assert.ok(result.crossTrackDistanceMeters<2);
 assert.equal(result.confidence,'high');
});

test('off-course, poor-accuracy and unsupported-course fixes never create a position',()=>{
 const route=course([[44.95,-93.1,250],[44.951,-93.1,260],[44.952,-93.1,270]]);
 for(const sample of [
  fix({longitude:-93.098}),
  fix({horizontalAccuracyMeters:80}),
 ]){
  const result=matchRaceCourseGpsPosition(route,sample);
  assert.equal(result.status,'untrusted');
  assert.equal(result.distanceOnCourseMeters,null);
 }
 assert.equal(matchRaceCourseGpsPosition({status:'unavailable',reason:'no route',raceId:'race-2027',courseVersion:'official-final-v2'},fix()).status,'untrusted');
});

test('parallel switchback sections without continuity evidence are ambiguous',()=>{
 const route=course([
  [44.95,-93.1,250],
  [44.951,-93.1,260],
  [44.951,-93.0999,261],
  [44.95,-93.0999,250],
 ]);
 const result=matchRaceCourseGpsPosition(route,fix({longitude:-93.09995,horizontalAccuracyMeters:15}));
 assert.equal(result.status,'untrusted',result.status==='trusted'?JSON.stringify({segmentIndex:result.segmentIndex,distance:result.distanceOnCourseMeters,crossTrack:result.crossTrackDistanceMeters}):result.reason);
 if(result.status==='untrusted')assert.match(result.reason,/ambiguous/);
});

test('prior match bounds the next search and rejects time reversal, backward progress and teleports',()=>{
 const route=course([[44.95,-93.1,250],[44.951,-93.1,260],[44.952,-93.1,270],[44.953,-93.1,280]]);
 const start=matchRaceCourseGpsPosition(route,fix({latitude:44.9503}),null);
 assert.equal(start.status,'trusted',start.status==='untrusted'?start.reason+'; cross='+start.crossTrackDistanceMeters:'');
 if(start.status!=='trusted')return;
 const previous:RaceCourseGpsMatchState=start.state;
 const backwards=matchRaceCourseGpsPosition(route,fix({latitude:44.9501,capturedAtMs:101000}),previous);
 assert.equal(backwards.status,'untrusted');
 if(backwards.status==='untrusted')assert.match(backwards.reason,/backwards/);
 const teleport=matchRaceCourseGpsPosition(route,fix({latitude:44.9525,capturedAtMs:101000}),previous);
 assert.equal(teleport.status,'untrusted');
 if(teleport.status==='untrusted')assert.match(teleport.reason,/jump/);
 const outOfOrder=matchRaceCourseGpsPosition(route,fix({latitude:44.9504,capturedAtMs:99000}),previous);
 assert.equal(outOfOrder.status,'untrusted');
});

test('course version change requires a fresh match sequence',()=>{
 const route=course([[44.95,-93.1,250],[44.951,-93.1,260]]);
 const first=matchRaceCourseGpsPosition(route,fix(),null);
 assert.equal(first.status,'trusted');
 if(first.status!=='trusted')return;
 const newCourse={...route,courseVersion:'official-final-v3'};
 const result=matchRaceCourseGpsPosition(newCourse,fix({capturedAtMs:101000}),first.state);
 assert.equal(result.status,'reset_required');
 if(result.status==='reset_required')assert.equal(result.state,null);
});

test('course geometry without canonical route identity cannot become trusted GPS progress',()=>{
 const geometry=course([[44.95,-93.1,250],[44.951,-93.1,260]]);
 const noRouteId=geometry.status==='ready'||geometry.status==='partial'
  ? {...geometry,routeId:null}
  : geometry;
 const result=matchRaceCourseGpsPosition(noRouteId,fix());
 assert.equal(result.status,'untrusted');
 if(result.status==='untrusted')assert.match(result.reason,/route identity/);
});
