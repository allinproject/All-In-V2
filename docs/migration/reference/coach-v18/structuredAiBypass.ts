import {resolveSavedRecipeBypass} from "./recipeBypass.ts";
import {resolveShoeGearBypassFromGear,shoeGearLookupIntent} from "./shoeGearBypass.ts";

export type StructuredAiBypassResult={answer:string;routeKey:string};

type MileageIntent={sport:"run"|"ride";period:"today"|"week"|"month"};

const normalize=(value:string)=>value.toLowerCase().replace(/\s+/g," ").trim();
const numeric=(value:unknown):number|null=>{const n=Number(value);return value===null||value===undefined||!Number.isFinite(n)?null:n;};
const NUTRITION_ADVISORY_RE=/\b(should|enough|too much|too little|recommend|target|goal|eat next|what should)\b/;
const ANALYTIC_ADVISORY_RE=/\b(should|good|bad|enough|too much|too little|increase|decrease|recommend|why|compare|interpret|mean|on track)\b/;

const todayTrainingLookupIntent=(message:string)=>{
  const m=normalize(message);
  const simple=/^(what(?:'s| is) my (?:training|workout) today|what am i (?:doing|training) today|what do i have (?:for )?(?:training|a workout) today|today'?s (?:training|workout))\??$/.test(m);
  const advisory=/\b(why|should|change|adjust|move|skip|replace|recommend|instead|too much|too hard|modify)\b/.test(m);
  return simple&&!advisory;
};

const foodTotalsLookupIntent=(message:string):"calories"|"macros"|null=>{
  const m=normalize(message);
  if(NUTRITION_ADVISORY_RE.test(m)||/\b(left|remaining)\b/.test(m))return null;
  if(/^(how many|what).*calories?.*(today|eaten|consumed|so far)|^calories?.*(today|so far)\??$/.test(m))return"calories";
  if(/^(what(?:'s| are)?|how much).*\b(macros?|protein|carbs?|fat)\b.*(today|consumed|eaten|so far)|^(macros?|protein|carbs?|fat).*(today|so far)\??$/.test(m))return"macros";
  return null;
};

const mileageLookupIntent=(message:string):MileageIntent|null=>{
  const m=normalize(message);
  if(ANALYTIC_ADVISORY_RE.test(m)||!/\b(miles?|mileage|distance)\b/.test(m))return null;
  const sport=/\b(run|running|ran)\b/.test(m)?"run":/\b(ride|riding|rode|ridden|bike|biking|cycling|cycled)\b/.test(m)?"ride":null;
  const period=/\btoday\b/.test(m)?"today":/\bthis week\b/.test(m)?"week":/\bthis month\b/.test(m)?"month":null;
  if(!sport||!period)return null;
  return{sport,period};
};

export const allowLegacyDeterministicRoute=(message:string)=>!NUTRITION_ADVISORY_RE.test(normalize(message));

const explicitDate=(value:any)=>{
  if(!value||typeof value!=="object"||Array.isArray(value))return null;
  const candidate=String(value.local_date??value.date??"").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(candidate)?candidate:null;
};

const sessionLabel=(value:any):string|null=>{
  if(typeof value==="string")return value.trim()||null;
  if(!value||typeof value!=="object"||Array.isArray(value))return null;
  if(value.rest===true||value.is_rest_day===true)return"Rest day";
  for(const key of ["title","name","label","workout_name","session_name","type","sport"]){
    const candidate=typeof value[key]==="string"?value[key].trim():"";
    if(candidate)return candidate.slice(0,180);
  }
  return null;
};

export const trainingForLocalDate=(days:any,localDate:string):string|null=>{
  if(Array.isArray(days)){
    const matches=days.filter(item=>explicitDate(item)===localDate);
    if(matches.length!==1)return null;
    return sessionLabel(matches[0]);
  }
  if(!days||typeof days!=="object")return null;
  if(Object.prototype.hasOwnProperty.call(days,localDate))return sessionLabel(days[localDate]);
  if(explicitDate(days)===localDate)return sessionLabel(days);
  return null;
};

export const resolveTodayTrainingBypassFromPlan=({message,localDate,days}: {message:string;localDate:string;days:any}):StructuredAiBypassResult|null=>{
  if(!todayTrainingLookupIntent(message))return null;
  const label=trainingForLocalDate(days,localDate);
  return label?{answer:`Today's training: ${label}.`,routeKey:"training_today"}:null;
};

export const resolveFoodTotalsBypass=({message,todayFood}: {message:string;todayFood:any}):StructuredAiBypassResult|null=>{
  const intent=foodTotalsLookupIntent(message);
  if(!intent||!todayFood||typeof todayFood!=="object")return null;
  if(intent==="calories"){
    const calories=numeric(todayFood.calories);
    return calories===null?null:{answer:`You have logged about ${Math.round(calories)} calories today.`,routeKey:"nutrition_calories_eaten"};
  }
  const protein=numeric(todayFood.protein_g),carbs=numeric(todayFood.carbs_g),fat=numeric(todayFood.fat_g);
  if(protein===null||carbs===null||fat===null)return null;
  return{answer:`Today you have logged about ${Math.round(protein)} g protein, ${Math.round(carbs)} g carbs, and ${Math.round(fat)} g fat.`,routeKey:"nutrition_macros_today"};
};

const workoutSport=(row:any):"run"|"ride"|null=>{
  const text=normalize([row?.kind,row?.title,row?.data?.activity_type,row?.data?.activityType,row?.data?.sport].filter(Boolean).join(" "));
  if(/\b(run|running|treadmill)\b/.test(text))return"run";
  if(/\b(ride|cycling|bike|biking|indoor cycling|indoor bike)\b/.test(text))return"ride";
  return null;
};

export const workoutDistanceMiles=(data:any):number|null=>{
  if(!data||typeof data!=="object")return null;
  for(const key of ["distance_miles","distanceMiles","distance_mi","distanceMi"]){const value=numeric(data[key]);if(value!==null&&value>=0)return value;}
  for(const key of ["distance_meters","distanceMeters"]){const value=numeric(data[key]);if(value!==null&&value>=0)return value/1609.344;}
  const value=numeric(data.distance),unit=String(data.distance_unit??data.distanceUnit??"").toLowerCase();
  if(value===null||value<0)return null;
  if(unit==="miles"||unit==="mi")return value;
  if(unit==="km")return value/1.609344;
  if(unit==="m")return value/1609.344;
  return null;
};

export const sumMileageRows=(rows:any[],sport:"run"|"ride"):number|null=>{
  let total=0;
  for(const row of rows){if(workoutSport(row)!==sport)continue;const miles=workoutDistanceMiles(row?.data);if(miles===null)return null;total+=miles;}
  return total;
};

const periodStart=(localDate:string,period:MileageIntent["period"])=>{
  const [year,month,day]=localDate.split("-").map(Number),date=new Date(Date.UTC(year,month-1,day));
  if(period==="today")return localDate;
  if(period==="month")return `${year.toString().padStart(4,"0")}-${month.toString().padStart(2,"0")}-01`;
  const weekday=date.getUTCDay(),daysSinceMonday=(weekday+6)%7;date.setUTCDate(date.getUTCDate()-daysSinceMonday);return date.toISOString().slice(0,10);
};

export const coachDistanceUnit=(rawContext:any):"mi"|"km"=>rawContext?.profile_settings?.units?.distance==="km"?"km":"mi";

export const resolveMileageBypassFromRows=({message,localDate,rows,unit="mi"}: {message:string;localDate:string;rows:any[];unit?:"mi"|"km"}):StructuredAiBypassResult|null=>{
  const intent=mileageLookupIntent(message);if(!intent)return null;
  const total=sumMileageRows(rows,intent.sport);if(total===null)return null;
  const periodLabel=intent.period==="today"?"today":intent.period==="week"?"this week":"this month";
  const sportLabel=intent.sport==="run"?"running":"riding";
  // Canonical totals are summed in miles; the single app-wide preference only changes presentation.
  const shown=unit==="km"?total*1.609344:total,noun=unit==="km"?"kilometers":"miles";
  return{answer:`You have ${shown.toFixed(shown<10?2:1).replace(/\.0$/,"")} ${noun} of ${sportLabel} ${periodLabel}.`,routeKey:`${intent.sport}_mileage_${intent.period}`};
};

export async function resolveStructuredAiBypass({client,userId,message,localDate,rawContext}: {client:any;userId:string;message:string;localDate:string;rawContext?:any}):Promise<StructuredAiBypassResult|null>{
  const food=resolveFoodTotalsBypass({message,todayFood:rawContext?.today_food});
  if(food)return food;
  const recipe=await resolveSavedRecipeBypass({client,message});
  if(recipe)return recipe;
  if(shoeGearLookupIntent(message)){
    const {data,error}=await client.rpc("allin_my_gear");
    if(error)return null;
    const gear=resolveShoeGearBypassFromGear({message,gear:data});
    if(gear)return gear;
  }
  const mileageIntent=mileageLookupIntent(message);
  if(mileageIntent){
    const {data,error}=await client.from("allin_coaching_records").select("record_date,kind,title,data").eq("user_id",userId).gte("record_date",periodStart(localDate,mileageIntent.period)).lte("record_date",localDate);
    if(error)return null;
    return resolveMileageBypassFromRows({message,localDate,rows:data??[],unit:coachDistanceUnit(rawContext)});
  }
  if(!todayTrainingLookupIntent(message))return null;
  const {data,error}=await client.from("allin_training_plan_versions")
    .select("days,accepted_at")
    .eq("user_id",userId)
    .not("accepted_at","is",null)
    .order("accepted_at",{ascending:false})
    .limit(1)
    .maybeSingle();
  if(error||!data)return null;
  return resolveTodayTrainingBypassFromPlan({message,localDate,days:data.days});
}
