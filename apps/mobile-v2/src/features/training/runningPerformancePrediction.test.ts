import test from 'node:test';
import assert from 'node:assert/strict';
import {predictRunningPerformances,predictionChange} from './runningPerformancePrediction.ts';
const now=new Date('2026-10-21T12:00:00Z');
test('five standard road distances, no ultra estimate',()=>{const rows=predictRunningPerformances([{distanceMeters:5000,durationSeconds:1200,observedAt:'2026-10-01',source:'race',evidenceId:'race-5k'}],now);assert.equal(rows.length,5);assert.ok(rows.some(x=>x.key==='marathon'));assert.equal(rows.find(x=>x.key==='5k')?.predictedSeconds,1200);assert.ok(!rows.some(x=>(x as any).key==='50k'))});
test('high confidence requires nearby recent race or PR evidence',()=>{const rows=predictRunningPerformances([{distanceMeters:10000,durationSeconds:3000,observedAt:'2026-10-01',source:'race',evidenceId:'fresh'}],now);assert.equal(rows.find(x=>x.key==='10k')?.confidence,'high')});
test('ultra and future-dated evidence are rejected',()=>{assert.deepEqual(predictRunningPerformances([{distanceMeters:50000,durationSeconds:20000,observedAt:'2026-10-01',source:'race',evidenceId:'ultra'}],now),[]);assert.deepEqual(predictRunningPerformances([{distanceMeters:5000,durationSeconds:1200,observedAt:'2027-01-01',source:'race',evidenceId:'future'}],now),[])});
test('prediction change is positive for improvement',()=>{assert.equal(predictionChange(10800,10680),120);assert.equal(predictionChange(null,100),null)});
