import {foodDayForToday,type CanonicalFuelFoodDay,type FuelOwnerFoodRow} from './fuelOwnerFoodRead.ts';
import type {ManualFoodReplacement} from './fuelOwnerFoodWrite.ts';
import {validAthleteLocalDate} from '../training/manualActivityDraft.ts';

/** Extended canonical read model for writing complete replacements.
 * V2 never edits from the four-field Today preview.
 */
export type EditableFoodRow=FuelOwnerFoodRow & {
 timezone_name:string;
 quantity:number;unit:ManualFoodReplacement['unit'];
 kcal:number|null;nutrition_source:ManualFoodReplacement['nutritionSource'];
};
export type EditableFoodDay=Omit<CanonicalFuelFoodDay,'entries'> & {
 entries:readonly EditableFoodRow[];
};
const slots=new Set(['breakfast','lunch','dinner','snack','other']);
const units=new Set(['g','ml','oz','fl_oz','serving','each']);
const finite=(value:unknown):value is number=>
 typeof value==='number'&&Number.isFinite(value);

/** If ANY row is not a complete canonical snapshot, do not allow edits.
 * Missing nutrition fields never default to 0 or an assumed serving size.
 */
export function editableFoodDay(
 payload:CanonicalFuelFoodDay|null,ownerId:string,date:string,
):EditableFoodDay|null{
 if(!payload||foodDayForToday(payload,ownerId,date).status!=='ready')return null;
 for(const row of payload.entries){
  const e=row as Partial<EditableFoodRow>;
  if(typeof e.timezone_name!=='string'||!e.timezone_name.trim()
   ||e.timezone_name.length>80||!slots.has(e.meal_slot??'')
   ||!finite(e.quantity)||e.quantity<=0||e.quantity>1000000
   ||!units.has(e.unit??'')
   ||!['user_entered','unknown'].includes(e.nutrition_source??'')
   ||(e.nutrition_source==='unknown'&&e.kcal!==null)
   ||(e.nutrition_source==='user_entered'
      &&(!finite(e.kcal)||e.kcal<0)))return null;
 }
 return payload as EditableFoodDay;
}

export type FoodFormInput={
 day:string;clock:string;timezoneName:string;
 mealSlot:ManualFoodReplacement['mealSlot'];label:string;
 quantity:string;unit:ManualFoodReplacement['unit'];calories:string;
};
/** Requires an explicit selected clock time and a current matching device
 * IANA timezone. No arbitrary noon timestamp or fabricated calorie amount.
 */
export function prepareFoodReplacement(input:FoodFormInput):ManualFoodReplacement|null{
 if(!validAthleteLocalDate(input.day)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.clock)
  ||!slots.has(input.mealSlot)||!units.has(input.unit)
  ||!input.label.trim()||input.label.trim().length>200
  ||input.timezoneName!==Intl.DateTimeFormat().resolvedOptions().timeZone)return null;
 const quantityText=input.quantity.trim();
 if(!/^\d+(?:\.\d{1,4})?$/.test(quantityText))return null;
 const quantity=Number(quantityText);
 if(!Number.isFinite(quantity)||quantity<=0||quantity>1000000)return null;
 const calorieText=input.calories.trim();
 let kcal:number|null=null;
 if(calorieText){
  if(!/^\d+(?:\.\d{1,4})?$/.test(calorieText))return null;
  kcal=Number(calorieText);
  if(!Number.isFinite(kcal)||kcal>1000000)return null;
 }
 const [year,month,day]=input.day.split('-').map(Number);
 const [hour,minute]=input.clock.split(':').map(Number);
 const local=new Date(year,month-1,day,hour,minute,0,0);
 if(local.getFullYear()!==year||local.getMonth()!==month-1
  ||local.getDate()!==day||local.getHours()!==hour||local.getMinutes()!==minute)return null;
 return {
  consumedAt:local.toISOString(),localDate:input.day,timezoneName:input.timezoneName,
  mealSlot:input.mealSlot,label:input.label.trim(),quantity,unit:input.unit,
  kcal,nutritionSource:kcal===null?'unknown':'user_entered',
 };
}

/** Secure action and entry identifiers for idempotent owner mutations.
 * Fail closed if device entropy is unavailable; Math.random is never used.
 */
export function newFoodActionId():string|null{
 const crypt=globalThis.crypto;
 if(!crypt||typeof crypt.getRandomValues!=='function')return null;
 try{
  const bytes=crypt.getRandomValues(new Uint8Array(16));
  bytes[6]=(bytes[6]&15)|64;
  bytes[8]=(bytes[8]&63)|128;
  const hex=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
  return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-');
 }catch{return null;}
}
