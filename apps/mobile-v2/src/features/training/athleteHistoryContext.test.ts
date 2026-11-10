import test from 'node:test';
import assert from 'node:assert/strict';
import {buildAthleteHistoryReadModel,type AthleteHistoryEvent,type AthleteHistoryCoverage} from './athleteHistoryContext.ts';
const event=(patch:Partial<AthleteHistoryEvent>={}):AthleteHistoryEvent=>({id:'run-1',kind:'completed_session',sport:'running',occurredAt:'2026-11-01T07:00:00Z',recordedAt:'2026-11-01T08:00:00Z',source:'canonical_training',sourceRef:'source-1',canonicalRef:'workout-1',planId:'plan-1',planRevision:3,summary:'Long run',metrics:{distanceMiles:18,durationMinutes:210},confidence:'high',...patch});
const coverage=(sport:'running'|'cycling',status:AthleteHistoryCoverage['status']='complete'):AthleteHistoryCoverage=>({sport,fromDate:'2026-10-01',throughDate:'2026-11-09',status,lastSyncAt:'2026-11-09T12:00:00Z',missingIntervals:[]});
test('complete coverage requires every requested sport and full date scope',()=>{const r=buildAthleteHistoryReadModel({generatedAt:'2026-11-09T15:00:00Z',fromDate:'2026-10-01',throughDate:'2026-11-09',sports:['running','cycling'],currentPlan:{id:'p',revision:3,weekStart:'2026-11-09',status:'accepted'},restrictions:[],coverage:[coverage('running'),coverage('cycling')],events:[event()]});assert.equal(r.completeness,'complete_for_requested_scope')});
test('missing bike coverage is partial, never zero bike history',()=>{const r=buildAthleteHistoryReadModel({generatedAt:'2026-11-09T15:00:00Z',fromDate:'2026-10-01',throughDate:'2026-11-09',sports:['running','cycling'],currentPlan:null,restrictions:[],coverage:[coverage('running')],events:[event()]});assert.equal(r.completeness,'partial');assert.ok(r.warnings.some(x=>x.includes('missing records as zero activity')))});
test('active restrictions remain in context even if older than event window',()=>{const r=buildAthleteHistoryReadModel({generatedAt:'2026-11-09T15:00:00Z',fromDate:'2026-10-01',throughDate:'2026-11-09',sports:['running'],currentPlan:null,restrictions:[{id:'no-curl',category:'exercise',subject:'lying_leg_curl',status:'active',source:'explicit_user',updatedAt:'2026-01-01T00:00:00Z',reason:'Not able to do this exercise'}],coverage:[coverage('running')],events:[event()]});assert.equal(r.restrictions[0].subject,'lying_leg_curl')});
test('event records preserve source and sort by occurred time',()=>{const older=event({id:'old',occurredAt:'2026-10-05T07:00:00Z'}),newer=event({id:'new',occurredAt:'2026-11-03T07:00:00Z'});const r=buildAthleteHistoryReadModel({generatedAt:'2026-11-09T15:00:00Z',fromDate:'2026-10-01',throughDate:'2026-11-09',sports:['running'],currentPlan:null,restrictions:[],coverage:[coverage('running')],events:[older,newer]});assert.equal(r.events[0].id,'new');assert.equal(r.events[0].source,'canonical_training')});
test('invalid query range is rejected',()=>{assert.throws(()=>buildAthleteHistoryReadModel({generatedAt:'bad',fromDate:'2026-11-10',throughDate:'2026-11-01',sports:['running'],currentPlan:null,restrictions:[],coverage:[],events:[]}))});

test('malformed history events are excluded without crashing the context builder',()=>{const r=buildAthleteHistoryReadModel({generatedAt:'2026-11-09T15:00:00Z',fromDate:'2026-10-01',throughDate:'2026-11-09',sports:['running'],currentPlan:null,restrictions:[],coverage:[coverage('running')],events:[event({id:'bad',occurredAt:'not-a-date'}),event({id:'good'})]});assert.deepEqual(r.events.map(x=>x.id),['good'])});
test('no requested provider coverage is unavailable, not proof of no exercise',()=>{const r=buildAthleteHistoryReadModel({generatedAt:'2026-11-09T15:00:00Z',fromDate:'2026-10-01',throughDate:'2026-11-09',sports:['cycling'],currentPlan:null,restrictions:[],coverage:[],events:[]});assert.equal(r.completeness,'unavailable');assert.ok(r.warnings.some(x=>x.includes('missing records as zero activity')))});

test('impossible calendar dates cannot count as complete athlete history coverage',()=>{
 const valid={generatedAt:'2026-11-09T15:00:00Z',fromDate:'2026-10-01',throughDate:'2026-11-09',sports:['running' as const],currentPlan:null,restrictions:[],coverage:[coverage('running')],events:[event()]};
 assert.throws(()=>buildAthleteHistoryReadModel({...valid,fromDate:'2026-02-30'}),/Valid athlete-history scope/);
 const badCoverage={...coverage('running'),fromDate:'2026-02-30'};
 const result=buildAthleteHistoryReadModel({...valid,coverage:[badCoverage]});
 assert.equal(result.completeness,'unavailable');
});

test('invalid context event limits must fail closed rather than silently suppressing history',()=>{
 const valid={generatedAt:'2026-11-09T15:00:00Z',fromDate:'2026-10-01',throughDate:'2026-11-09',sports:['running' as const],currentPlan:null,restrictions:[],coverage:[coverage('running')],events:[event()]};
 assert.throws(()=>buildAthleteHistoryReadModel({...valid,maxEvents:Number.NaN}),/Valid athlete-history scope/);
 assert.throws(()=>buildAthleteHistoryReadModel({...valid,maxEvents:0}),/Valid athlete-history scope/);
 assert.equal(buildAthleteHistoryReadModel({...valid,maxEvents:1}).events.length,1);
});
