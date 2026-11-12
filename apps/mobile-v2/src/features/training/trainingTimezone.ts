/** ALL-217/230: choose a real device IANA training zone explicitly.
 * Persist through the canonical profile training_preferences writer only.
 * Never infer a zone silently in the server or overwrite a saved zone on travel.
 */
export function validTrainingTimezone(value:unknown):value is string{
 if(typeof value!=='string'||value.length<3||value.length>100||
    !/^[A-Za-z0-9_+\-/]+$/.test(value))return false;
 try{
  const canonical=new Intl.DateTimeFormat('en-US',{timeZone:value})
   .resolvedOptions().timeZone;
  return typeof canonical==='string'&&canonical.length>0;
 }catch{return false}
}
export function deviceTrainingTimezone():string|null{
 try{
  const zone=Intl.DateTimeFormat().resolvedOptions().timeZone;
  return validTrainingTimezone(zone)?zone:null;
 }catch{return null}
}
export function savedTrainingTimezone(training:unknown):string|null{
 if(!training||typeof training!=='object'||Array.isArray(training))return null;
 const value=(training as Record<string,unknown>).timezone;
 return validTrainingTimezone(value)?value:null;
}
export function trainingTimezonePatch(zone:unknown):{timezone:string}|null{
 return validTrainingTimezone(zone)?{timezone:zone}:null;
}
