/** ALL-243: pre-ingest device measurement contract for the canonical writer.
 * This is NOT a device certification service or a network writer. The caller
 * must be a server-side authenticated provider adapter; mobile clients cannot
 * confer trusted quality or call the private PostgreSQL function directly.
 */
export type DeviceQuality='trusted'|'partial'|'unverified'|'low_quality'|'rejected';
export type DeviceMeasurementKind='source_measured'|'provider_derived';
export type DeviceMetricObservation={
 metricCode:string;definitionVersion:number;measurementKind:DeviceMeasurementKind;
 valueNumeric:number|null;valueText:string|null;valueBoolean:boolean|null;
 sampleQuality:DeviceQuality;sourcePayloadHash:string;
};
export type CertifiedDeviceSource={
 activityId:string;ownerId:string;sourceId:string;sourceQuality:DeviceQuality;
 provider:'apple_healthkit'|'apple_watch'|'supported_equipment';
 /** Provider authentication and record ownership MUST be verified upstream. */
 certifiedByServer:true;
};
export type CanonicalMetricAppend={
 activityId:string;ownerId:string;sourceId:string;metricCode:string;
 definitionVersion:number;measurementKind:DeviceMeasurementKind;
 valueNumeric:number|null;valueText:string|null;valueBoolean:boolean|null;
 sourcePayloadHash:string;measurementQuality:DeviceQuality;
};
const qualityRank:Record<DeviceQuality,number>={
 rejected:0,low_quality:1,unverified:2,partial:3,trusted:4,
};
const token=(s:string)=>/^[a-z][a-z0-9_]{0,99}$/.test(s);
const sha=(s:string)=>/^[0-9a-f]{64}$/.test(s);
const id=(s:string)=>typeof s==='string'&&s.length>0&&s.length<=150;
/** Reject rather than promote poor sensor samples. Do not infer sample
 * certification from the provider name or the parent source quality. */
export function prepareCertifiedDeviceMetric(
 source:CertifiedDeviceSource,observation:DeviceMetricObservation,
):CanonicalMetricAppend{
 if(source.certifiedByServer!==true||!id(source.activityId)||!id(source.ownerId)||
  !id(source.sourceId)||!['apple_healthkit','apple_watch','supported_equipment'].includes(source.provider)||
  !Object.hasOwn(qualityRank,source.sourceQuality))
  throw new Error('Device source is not server certified.');
 if(!token(observation.metricCode)||!Number.isSafeInteger(observation.definitionVersion)||
  observation.definitionVersion<1||
  !['source_measured','provider_derived'].includes(observation.measurementKind)||
  !Object.hasOwn(qualityRank,observation.sampleQuality)||!sha(observation.sourcePayloadHash))
  throw new Error('Device metric evidence is invalid.');
 const values=[observation.valueNumeric,observation.valueText,observation.valueBoolean];
 if(values.filter(x=>x!==null).length!==1||
  (observation.valueNumeric!==null&&!Number.isFinite(observation.valueNumeric))||
  (observation.valueText!==null&&
    (typeof observation.valueText!=='string'||observation.valueText.length>300))||
  (observation.valueBoolean!==null&&typeof observation.valueBoolean!=='boolean'))
  throw new Error('Exactly one finite typed device measurement is required.');
 if(qualityRank[observation.sampleQuality]>qualityRank[source.sourceQuality])
  throw new Error('Device sample confidence exceeds its certified source.');
 return {activityId:source.activityId,ownerId:source.ownerId,sourceId:source.sourceId,
  metricCode:observation.metricCode,definitionVersion:observation.definitionVersion,
  measurementKind:observation.measurementKind,valueNumeric:observation.valueNumeric,
  valueText:observation.valueText,valueBoolean:observation.valueBoolean,
  sourcePayloadHash:observation.sourcePayloadHash,
  measurementQuality:observation.sampleQuality};
}
