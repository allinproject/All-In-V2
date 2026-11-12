import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareCertifiedDeviceMetric,type CertifiedDeviceSource,type DeviceMetricObservation} from './trustedDeviceMetricBoundary.ts';
const source:CertifiedDeviceSource={activityId:'activity-a',ownerId:'owner-a',sourceId:'watch-a',
 sourceQuality:'trusted',provider:'apple_watch',certifiedByServer:true};
const sample:DeviceMetricObservation={metricCode:'heart_rate_bpm',definitionVersion:1,
 measurementKind:'source_measured',valueNumeric:0,valueText:null,valueBoolean:null,
 sampleQuality:'partial',sourcePayloadHash:'a'.repeat(64)};
test('retains a measured zero and independent worse sample confidence',()=>{
 const m=prepareCertifiedDeviceMetric(source,sample);
 assert.equal(m.valueNumeric,0);assert.equal(m.measurementQuality,'partial');
 assert.equal(m.sourceId,'watch-a');assert.equal(m.sourcePayloadHash,'a'.repeat(64));
});
test('rejects uncertified providers and samples claiming more confidence than source',()=>{
 assert.throws(()=>prepareCertifiedDeviceMetric({...source,certifiedByServer:false as true},sample),/server certified/);
 assert.throws(()=>prepareCertifiedDeviceMetric({...source,sourceQuality:'partial'},
  {...sample,sampleQuality:'trusted'}),/exceeds/);
 assert.throws(()=>prepareCertifiedDeviceMetric({...source,provider:'unknown' as 'apple_watch'},sample),/server certified/);
});
test('missing, ambiguous, nonfinite and unsupported sample evidence fails closed',()=>{
 for(const bad of [
  {...sample,valueNumeric:null},{...sample,valueText:'two'},
  {...sample,valueNumeric:Number.NaN},{...sample,valueNumeric:Infinity},
  {...sample,sourcePayloadHash:'unsigned'},{...sample,definitionVersion:0},
  {...sample,metricCode:'heart rate'}, {...sample,sampleQuality:'unknown' as 'trusted'},
 ]){
  assert.throws(()=>prepareCertifiedDeviceMetric(source,bad));
 }
});
test('a genuinely recorded false and low-quality measurement are preserved for quarantine',()=>{
 const m=prepareCertifiedDeviceMetric(source,{...sample,valueNumeric:null,valueBoolean:false,
  sampleQuality:'low_quality'});
 assert.equal(m.valueBoolean,false);assert.equal(m.measurementQuality,'low_quality');
});
