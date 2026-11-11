/** Canonical Profile-owned Training Locations and manual inventory.
 * Stored under training_preferences.equipment_locations via the existing versioned settings writer.
 * Coach and Training must consume this owner rather than create parallel equipment stores.
 */
export type EquipmentItem={id:string;name:string;quantity:number;weightKg:number|null};
export type TrainingLocation={id:string;name:string;equipment:EquipmentItem[]};
export type EquipmentInventory={locations:TrainingLocation[]};
const MAX_LOCATIONS=12,MAX_ITEMS=80;
export const emptyEquipmentInventory=():EquipmentInventory=>({locations:[]});
const obj=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
const clean=(v:string,max=80)=>v.trim().replace(/\s+/g,' ').slice(0,max);
export function parseEquipmentInventory(settings:unknown):EquipmentInventory {
 const training=obj(obj(settings).training_preferences),raw=obj(training.equipment_locations);
 return {locations:(Array.isArray(raw.locations)?raw.locations:[]).slice(0,MAX_LOCATIONS).map(x=>{
  const r=obj(x);
  return {id:typeof r.id==='string'?r.id:'',name:typeof r.name==='string'?clean(r.name):'',
   equipment:(Array.isArray(r.equipment)?r.equipment:[]).slice(0,MAX_ITEMS).map(v=>{
    const e=obj(v);return {id:typeof e.id==='string'?e.id:'',name:typeof e.name==='string'?clean(e.name):'',
      quantity:typeof e.quantity==='number'&&Number.isSafeInteger(e.quantity)&&e.quantity>=1&&e.quantity<=99?e.quantity:1,
      weightKg:typeof e.weightKg==='number'&&Number.isFinite(e.weightKg)&&e.weightKg>0&&e.weightKg<=2000?e.weightKg:null};
   }).filter(x=>x.id&&x.name)};
 }).filter(x=>x.id&&x.name)};
}
export function addTrainingLocation(state:EquipmentInventory,name:string,id:string):EquipmentInventory{
 const label=clean(name);
 if(!label)throw new Error('Enter a training location name.');
 if(state.locations.length>=MAX_LOCATIONS)throw new Error('Maximum training locations reached.');
 if(state.locations.some(x=>x.id===id||x.name.toLowerCase()===label.toLowerCase()))throw new Error('This training location already exists.');
 return {locations:[...state.locations,{id,name:label,equipment:[]}]};
}
export function removeTrainingLocation(state:EquipmentInventory,id:string):EquipmentInventory{
 return {locations:state.locations.filter(x=>x.id!==id)};
}
export function addEquipment(state:EquipmentInventory,locationId:string,item:EquipmentItem):EquipmentInventory{
 const name=clean(item.name);
 if(!name)throw new Error('Enter an equipment name.');
 if(!Number.isSafeInteger(item.quantity)||item.quantity<1||item.quantity>99)throw new Error('Quantity must be between 1 and 99.');
 if(item.weightKg!==null&&(!Number.isFinite(item.weightKg)||item.weightKg<=0||item.weightKg>2000))throw new Error('Enter a valid weight.');
 const loc=state.locations.find(x=>x.id===locationId);
 if(!loc)throw new Error('Select a training location.');
 if(loc.equipment.length>=MAX_ITEMS)throw new Error('Too many equipment entries.');
 if(loc.equipment.some(x=>x.id===item.id))throw new Error('Equipment entry already exists.');
 return {locations:state.locations.map(x=>x.id===locationId?{...x,equipment:[...x.equipment,{...item,name}]}:x)};
}
export function removeEquipment(state:EquipmentInventory,locationId:string,itemId:string):EquipmentInventory{
 return {locations:state.locations.map(x=>x.id===locationId?{...x,equipment:x.equipment.filter(i=>i.id!==itemId)}:x)};
}
export function equipmentInventoryPatch(state:EquipmentInventory){
 if(state.locations.length>MAX_LOCATIONS||state.locations.some(x=>x.equipment.length>MAX_ITEMS))throw new Error('Inventory limit exceeded.');
 return {equipment_locations:{locations:state.locations}};
}
