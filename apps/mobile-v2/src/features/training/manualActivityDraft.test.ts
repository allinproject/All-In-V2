import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareManualActivity, validAthleteLocalDate } from './manualActivityDraft.ts';

const base = {sport:'stair' as const,athleteLocalDate:'2026-11-10',athleteLocalToday:'2026-11-10',durationMinutes:'30',machineFloors:'45'};

test('separate stair climb remains an uncommitted manual activity, never a planned run',()=>{
  assert.deepEqual(prepareManualActivity(base),{valid:true,sport:'stair',athleteLocalDate:'2026-11-10',durationSeconds:1800,machineFloors:45,source:'manual',status:'uncommitted'});
});
test('manual activity can be logged for a past day without a planned workout',()=>{
  const result=prepareManualActivity({...base,athleteLocalDate:'2026-11-08',sport:'walking',machineFloors:''});
  assert.equal(result.valid,true);
  if(result.valid)assert.equal(result.machineFloors,null);
});
test('future completions are never counted as already completed',()=>{
  assert.deepEqual(prepareManualActivity({...base,athleteLocalDate:'2026-11-11'}),{valid:false,reason:'future_completion'});
});
test('local dates reject invalid calendar days and time-of-day strings',()=>{
  assert.equal(validAthleteLocalDate('2026-02-30'),false);
  assert.equal(validAthleteLocalDate('2026-11-10T12:00:00Z'),false);
  assert.equal(validAthleteLocalDate('2028-02-29'),true);
  assert.equal(prepareManualActivity({...base,athleteLocalToday:'unknown'}).valid,false);
});
test('duration cannot be empty, negative, NaN or more than one day',()=>{
  for(const durationMinutes of ['', '-3','Infinity','0','1441','30abc']){
    assert.deepEqual(prepareManualActivity({...base,durationMinutes}),{valid:false,reason:'invalid_duration'});
  }
});
test('floor metric is optional, but must be a machine-reported whole number for stair',()=>{
  assert.deepEqual(prepareManualActivity({...base,machineFloors:'3.5'}),{valid:false,reason:'invalid_floors'});
  assert.deepEqual(prepareManualActivity({...base,sport:'running',machineFloors:'45'}),{valid:false,reason:'invalid_floors'});
});
