import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyEquipmentInventory,addTrainingLocation,removeTrainingLocation,addEquipment,removeEquipment,
 equipmentInventoryPatch,parseEquipmentInventory} from './equipmentInventory.ts';

test('training locations own separate equipment inventories, even with minimal home setup',()=>{
 const home=addTrainingLocation(emptyEquipmentInventory(),'Home','h');
 const both=addTrainingLocation(home,'Gym','g');
 const stored=addEquipment(both,'h',{id:'db',name:'Dumbbells',quantity:2,weightKg:11.3});
 assert.equal(stored.locations.find(x=>x.id==='g')?.equipment.length,0);
 assert.deepEqual(stored.locations.find(x=>x.id==='h')?.equipment[0],{id:'db',name:'Dumbbells',quantity:2,weightKg:11.3});
 assert.deepEqual(removeEquipment(stored,'h','db').locations[0].equipment,[]);
 assert.equal(removeTrainingLocation(stored,'g').locations.length,1);
});
test('inventory is parsed and stored in canonical training preferences only',()=>{
 const state=addEquipment(addTrainingLocation(emptyEquipmentInventory(),'Home','h'),'h',{
  id:'band',name:'Resistance bands',quantity:1,weightKg:null,
 });
 const patch=equipmentInventoryPatch(state);
 assert.equal('equipment_locations' in patch,true);
 assert.deepEqual(parseEquipmentInventory({training_preferences:patch}),state);
 assert.deepEqual(parseEquipmentInventory({}),emptyEquipmentInventory());
});
test('reject duplicate locations and invalid quantities and weights',()=>{
 const home=addTrainingLocation(emptyEquipmentInventory(),'Home','h');
 assert.throws(()=>addTrainingLocation(home,' home ','another'),/already exists/);
 assert.throws(()=>addEquipment(home,'h',{id:'x',name:'Dumbbell',quantity:0,weightKg:null}),/Quantity/);
 assert.throws(()=>addEquipment(home,'h',{id:'x',name:'Dumbbell',quantity:1,weightKg:-1}),/weight/);
 assert.throws(()=>addEquipment(home,'bad',{id:'x',name:'Dumbbell',quantity:1,weightKg:null}),/location/);
});
