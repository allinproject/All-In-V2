import test from 'node:test';
import assert from 'node:assert/strict';
import {buildMultiEventSeasonPlan} from './multiEventSeasonPlan.ts';
import {reviewMultiEventCourseEvidence} from './multiEventCourseEvidence.ts';
import type {RaceCourseEvidence} from './raceCourseEvidence.ts';

const events=[
 {id:'trail',date:'2027-05-01',name:'Trail race',sport:'running',
  priority:'B' as const,demand:'endurance' as const},
 {id:'road',date:'2027-09-18',name:'Road marathon',sport:'running',
  priority:'A' as const,demand:'endurance' as const}
];
const season=()=>buildMultiEventSeasonPlan({startDate:'2027-02-01',events});
const field=<T,>(value:T|null)=>({
 value,source:value===null?null:'official_race_website' as const,
 sourceUrl:value===null?null:'https://race.example/verified-course',
 retrievedAt:value===null?null:'2027-01-15T10:00:00Z',confirmedByUser:false
});
const course=(raceId:string,eventDate:string):RaceCourseEvidence=>({
 version:1,raceId,eventDate,courseVersion:'official-2027',routeId:'route-v1',
 sourceUrls:['https://race.example/verified-course'],routeFile:null,
 distance:field(42195),elevationGain:field(350),elevationLoss:field(350),
 surface:field<'road'|'trail'>('trail'),technicality:field<'low'|'moderate'>('moderate'),
 aidStationStatus:field<'none'>('none'),aidStations:[],
 completeness:'unverified',missingFields:[],warnings:[]
});
test('course-required events use distinct exact event/date/course identity',()=>{
 const r=reviewMultiEventCourseEvidence({season:season(),
  courseRequiredEventIds:['trail','road'],
  courseEvidence:[course('trail','2027-05-01'),course('road','2027-09-18')]});
 assert.equal(r.status,'ready_for_course_planning');
 assert.deepEqual(r.courses.map(c=>c.eventId),['trail','road']);
 assert.equal(r.noInventedCourseFacts,true);
});
test('missing course evidence blocks claims of race-specific course readiness',()=>{
 const r=reviewMultiEventCourseEvidence({season:season(),
  courseRequiredEventIds:['trail','road'],courseEvidence:[course('trail','2027-05-01')]});
 assert.equal(r.status,'review_required');
 assert.ok(r.issues.some(i=>i.code==='MISSING_COURSE'&&i.eventId==='road'));
});
test('a previous or later event course cannot be attached by matching race ID alone',()=>{
 const r=reviewMultiEventCourseEvidence({season:season(),courseRequiredEventIds:['trail'],
  courseEvidence:[course('trail','2027-09-18')]});
 assert.ok(r.issues.some(i=>i.code==='EVENT_IDENTITY_MISMATCH'));
});
test('unknown elevation, technicality or aid facts stay missing, not hallucinated',()=>{
 const incomplete=course('trail','2027-05-01');
 incomplete.elevationGain=field<number>(null);
 incomplete.technicality=field<'low'|'moderate'>(null);
 incomplete.aidStationStatus=field<'none'>(null);
 const r=reviewMultiEventCourseEvidence({season:season(),
  courseRequiredEventIds:['trail'],courseEvidence:[incomplete]});
 assert.equal(r.status,'review_required');
 const issue=r.issues.find(i=>i.code==='COURSE_FACTS_INCOMPLETE');
 assert.ok(issue?.missingFields.includes('aid_stations'));
 assert.ok(issue?.missingFields.includes('elevation_gain'));
 assert.ok(issue?.missingFields.includes('technicality'));
});
test('malformed provenance and duplicate versions never become verified facts',()=>{
 const malformed=course('trail','2027-05-01');
 malformed.sourceUrls=['http://race.example/not-secure'];
 const invalid=reviewMultiEventCourseEvidence({season:season(),courseRequiredEventIds:['trail'],
  courseEvidence:[malformed]});
 assert.ok(invalid.issues.some(i=>i.code==='COURSE_FACTS_INCOMPLETE'));
 const duplicate=reviewMultiEventCourseEvidence({season:season(),courseRequiredEventIds:['trail'],
  courseEvidence:[course('trail','2027-05-01'),course('trail','2027-05-01')]});
 assert.ok(duplicate.issues.some(i=>i.code==='DUPLICATE_COURSE'));
});
test('non-course events never require invented route data',()=>{
 const r=reviewMultiEventCourseEvidence({season:season(),courseRequiredEventIds:[],courseEvidence:[]});
 assert.equal(r.status,'ready_for_course_planning');
 assert.deepEqual(r.courses,[]);
});
