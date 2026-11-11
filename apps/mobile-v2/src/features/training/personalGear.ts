/** Profile-owned personal gear, distinct from location inventories.
 * Canonical path: training_preferences.personal_gear.
 * Mileage here is a manually supplied starting/adjusted total until workout reconciliation exists.
 */
export type GearKind='shoes'|'bikes'|'other';
export type ShoeUse='road'|'trail'|'mixed';
export type BikeUse='outdoor'|'indoor';
export type GearItem={
 id:string;kind:GearKind;name:string;distanceKm:number;
 status:'active'|'retired';use:ShoeUse|BikeUse|'general';
 reminderKm:number|null;
};
export type PersonalGear={items:GearItem[];defaults:{road:string|null;trail:string|null;outdoorBike:string|null;indoorBike:string|null}};
const object=(x:unknown):Record<string,unknown>=>x&&typeof x==='object'&&!Array.isArray(x)?x as Record<string,unknown>:{};
export const emptyPersonalGear=():PersonalGear=>({items:[],defaults:{road:null,trail:null,outdoorBike:null,indoorBike:null}});
const compatible=(item:GearItem,key:keyof PersonalGear['defaults'])=>{
 if(item.status!=='active')return false;
 if(key==='road')return item.kind==='shoes'&&(item.use==='road'||item.use==='mixed');
 if(key==='trail')return item.kind==='shoes'&&(item.use==='trail'||item.use==='mixed');
 if(key==='outdoorBike')return item.kind==='bikes'&&item.use==='outdoor';
 return item.kind==='bikes'&&item.use==='indoor';
};
export function parsePersonalGear(settings:unknown):PersonalGear {
 const raw=object(object(object(settings).training_preferences).personal_gear);
 const items:GearItem[]=(Array.isArray(raw.items)?raw.items:[]).slice(0,100).map(x=>{
  const r=object(x),kind=(r.kind==='shoes'||r.kind==='bikes'||r.kind==='other'?r.kind:'other') as GearKind;
  const use=typeof r.use==='string'?r.use:'general';
  return {id:typeof r.id==='string'?r.id:'',name:typeof r.name==='string'?r.name.trim().slice(0,100):'',
   kind,use:(kind==='shoes'&&['road','trail','mixed'].includes(use)?use:
     kind==='bikes'&&['outdoor','indoor'].includes(use)?use:'general') as GearItem['use'],
   distanceKm:typeof r.distanceKm==='number'&&Number.isFinite(r.distanceKm)&&r.distanceKm>=0&&r.distanceKm<=10000000?r.distanceKm:0,
   status:r.status==='retired'?'retired' as const:'active' as const,
   reminderKm:typeof r.reminderKm==='number'&&Number.isFinite(r.reminderKm)&&r.reminderKm>0&&r.reminderKm<=10000000?r.reminderKm:null};
 }).filter(x=>x.id&&x.name);
 const rawDefaults=object(raw.defaults),defaults=emptyPersonalGear().defaults;
 for(const key of Object.keys(defaults) as (keyof typeof defaults)[]){
  const id=rawDefaults[key];
  const item=items.find(x=>x.id===id);
  defaults[key]=item&&compatible(item,key)?item.id:null;
 }
 return {items,defaults};
}
export function addPersonalGear(state:PersonalGear,item:GearItem):PersonalGear{
 const name=item.name.trim().replace(/\s+/g,' ').slice(0,100);
 if(!name)throw new Error('Enter a name or model.');
 if(state.items.length>=100)throw new Error('Maximum gear entries reached.');
 if(!item.id||state.items.some(x=>x.id===item.id))throw new Error('Duplicate gear identifier.');
 if(!Number.isFinite(item.distanceKm)||item.distanceKm<0||item.distanceKm>10000000)throw new Error('Mileage must be zero or higher.');
 if(item.reminderKm!==null&&(!Number.isFinite(item.reminderKm)||item.reminderKm<=0))throw new Error('Invalid reminder distance.');
 const allowed=item.kind==='shoes'?['road','trail','mixed']:item.kind==='bikes'?['outdoor','indoor']:['general'];
 if(!allowed.includes(item.use))throw new Error('Choose a valid gear activity.');
 return {...state,items:[...state.items,{...item,name,status:'active'}]};
}
export function changeGearStatus(state:PersonalGear,id:string,status:'active'|'retired'):PersonalGear{
 if(!state.items.some(x=>x.id===id))throw new Error('Gear not found.');
 const next={...state,items:state.items.map(x=>x.id===id?{...x,status}:x)};
 if(status==='retired'){
  const defaults={...next.defaults};
  for(const key of Object.keys(defaults) as (keyof typeof defaults)[])if(defaults[key]===id)defaults[key]=null;
  return {...next,defaults};
 }
 return next;
}
export function changeGearDistance(state:PersonalGear,id:string,distanceKm:number):PersonalGear{
 if(!Number.isFinite(distanceKm)||distanceKm<0||distanceKm>10000000)throw new Error('Invalid mileage.');
 if(!state.items.some(x=>x.id===id))throw new Error('Gear not found.');
 return {...state,items:state.items.map(x=>x.id===id?{...x,distanceKm}:x)};
}
export function selectGearDefault(state:PersonalGear,key:keyof PersonalGear['defaults'],id:string|null):PersonalGear{
 if(id!==null){
  const item=state.items.find(x=>x.id===id);
  if(!item||!compatible(item,key))throw new Error('Gear is not active or suitable for this activity.');
 }
 return {...state,defaults:{...state.defaults,[key]:id}};
}
export function personalGearPatch(state:PersonalGear){
 if(state.items.length>100)throw new Error('Too many personal gear entries.');
 return {personal_gear:{items:state.items,defaults:state.defaults}};
}
