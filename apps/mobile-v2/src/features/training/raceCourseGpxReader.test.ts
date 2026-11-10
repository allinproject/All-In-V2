import test from 'node:test';
import assert from 'node:assert/strict';
import {readRaceGpx} from './raceCourseGpxReader.ts';
import type {RaceCourseEvidence} from './raceCourseEvidence.ts';

const evidence=():Pick<RaceCourseEvidence,'raceId'|'courseVersion'|'routeFile'|'routeId'>=>({
 raceId:'race-2027',routeId:'route-2027',courseVersion:'official-final-v2',
 routeFile:{kind:'gpx',fileRef:'private-upload-ref',source:'organizer_gpx'},
});
const track=(points:string[],extra='')=>`<?xml version="1.0"?>
<gpx version="1.1" creator="race organizer" xmlns="http://www.topografix.com/GPX/1/1">
<trk><name>Race course</name><trkseg>${points.join('')}</trkseg></trk>${extra}</gpx>`;
const pt=(lat:number,lon:number,ele:number|null)=>`<trkpt lat="${lat}" lon="${lon}">${ele===null?'':`<ele>${ele}</ele>`}</trkpt>`;

test('reads a versioned continuous track and calculates distance, elevation and per-leg grade',()=>{
 const result=readRaceGpx(track([pt(44.95,-93.1,250),pt(44.951,-93.1,260),pt(44.952,-93.1,250)]),evidence());
 assert.equal(result.status,'ready');
 if(result.status!=='ready')return;
 assert.equal(result.raceId,'race-2027');
 assert.equal(result.courseVersion,'official-final-v2');
 assert.equal(result.geometryKind,'track');
 assert.equal(result.points.length,3);
 assert.ok(result.totalDistanceMeters>200&&result.totalDistanceMeters<230);
 assert.equal(result.elevationGainMeters,10);
 assert.equal(result.elevationLossMeters,10);
 assert.ok((result.points[1].gradeFromPreviousPercent??0)>0);
 assert.ok((result.points[2].gradeFromPreviousPercent??0)<0);
 assert.equal(result.noAutomaticPlanWrite,true);
});

test('reads one GPX route as geometry but does not invent missing elevation',()=>{
 const xml=`<gpx><rte><rtept lat="44.95" lon="-93.1"><ele>250</ele></rtept><rtept lat="44.951" lon="-93.1"></rtept></rte></gpx>`;
 const result=readRaceGpx(xml,evidence());
 assert.equal(result.status,'partial');
 if(result.status!=='partial')return;
 assert.equal(result.geometryKind,'route');
 assert.equal(result.elevationStatus,'partial');
 assert.equal(result.elevationGainMeters,null);
 assert.equal(result.points[1].gradeFromPreviousPercent,null);
 assert.ok(result.warnings.some((warning)=>warning.includes('omit elevation')));
});

test('rejects multiple track segments and mixed route/track geometry rather than connecting a gap',()=>{
 const twoSegments=`<gpx><trk><trkseg>${pt(44.95,-93.1,1)}${pt(44.951,-93.1,2)}</trkseg><trkseg>${pt(45,-93.1,3)}${pt(45.001,-93.1,4)}</trkseg></trk></gpx>`;
 assert.equal(readRaceGpx(twoSegments,evidence()).status,'unavailable');
 const mixed=track([pt(44.95,-93.1,1),pt(44.951,-93.1,2)],'<rte><rtept lat="44.95" lon="-93.1"></rtept></rte>');
 assert.equal(readRaceGpx(mixed,evidence()).status,'unavailable');
});

test('rejects invalid coordinates, duplicate points and malformed elevation',()=>{
 for(const xml of [
  track(['<trkpt lat="91" lon="0"><ele>1</ele></trkpt>',pt(44.951,0,2)]),
  track([pt(44.95,0,1),pt(44.95,0,2)]),
  track(['<trkpt lat="44.95" lon="0"><ele>high</ele></trkpt>',pt(44.951,0,2)]),
  track(['<trkpt lat="44.95"><ele>1</ele></trkpt>',pt(44.951,0,2)]),
 ]){
  assert.equal(readRaceGpx(xml,evidence()).status,'unavailable');
 }
});

test('rejects external entity declarations and oversized documents',()=>{
 const xml=track([pt(44.95,0,1),pt(44.951,0,2)]);
 assert.equal(readRaceGpx(xml.replace('<gpx','<!DOCTYPE gpx [<!ENTITY x SYSTEM "file:///etc/passwd">]><gpx'),evidence()).status,'unavailable');
 assert.equal(readRaceGpx(' '.repeat(20*1024*1024+1),evidence()).status,'unavailable');
});

test('requires a GPX file identity and rejects empty or discontinuous course data',()=>{
 assert.equal(readRaceGpx(track([pt(44.95,0,1),pt(44.951,0,2)]),{...evidence(),routeFile:null}).status,'unavailable');
 assert.equal(readRaceGpx('<gpx></gpx>',evidence()).status,'unavailable');
 assert.equal(readRaceGpx(track([pt(44.95,0,1)]),evidence()).status,'unavailable');
});
