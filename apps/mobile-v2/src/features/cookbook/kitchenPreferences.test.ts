import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HOME_KITCHEN_GROUPS, WORK_REHEAT_ITEMS, emptyKitchen,
  parseKitchen, setEquipmentAvailability, setKitchenCount,
  setKitchenNotes, kitchenSettingsPatch,
} from './kitchenPreferences.ts';

test('preserves Unknown rather than inferring equipment ownership',()=>{
  const profile=parseKitchen(null);
  assert.equal(profile.home.microwave,'unknown');
  assert.equal(profile.work.microwave,'unknown');
  assert.equal(profile.constraints.burner_count,null);
  assert.equal(profile.constraints.notes,null);
});
test('home and work availability are separate, with unique names and grouped equipment',()=>{
  const groups=HOME_KITCHEN_GROUPS.flatMap(x=>x.items.map(y=>y[0]));
  assert.equal(groups.length,new Set(groups).size);
  assert.ok(groups.includes('blender')&&groups.includes('skillet')&&groups.includes('thermometer'));
  assert.deepEqual(WORK_REHEAT_ITEMS.map(x=>x[0]),['microwave','toaster_oven','air_fryer']);
  const home=setEquipmentAvailability(emptyKitchen(),'home','microwave','available');
  const work=setEquipmentAvailability(home,'work','microwave','unavailable');
  assert.equal(work.home.microwave,'available');
  assert.equal(work.work.microwave,'unavailable');
  assert.throws(()=>setEquipmentAvailability(home,'work','blender','available'),/Unsupported/);
});
test('counts preserve zero, unknown, and reject invalid values',()=>{
  const zero=setKitchenCount(emptyKitchen(),'skillet_count','0');
  assert.equal(zero.constraints.skillet_count,0);
  assert.equal(setKitchenCount(zero,'skillet_count','').constraints.skillet_count,null);
  assert.equal(setKitchenCount(zero,'container_count','99').constraints.container_count,99);
  assert.throws(()=>setKitchenCount(zero,'skillet_count','100'),/whole number/);
  assert.throws(()=>setKitchenCount(zero,'skillet_count','-1'),/whole number/);
  assert.throws(()=>setKitchenCount(zero,'skillet_count','1.5'),/whole number/);
});
test('V2 nutrition settings patch does not replace allergies or preferences',()=>{
  const updated=setEquipmentAvailability(
    setKitchenNotes(setKitchenCount(emptyKitchen(),'container_count','15'),'One skillet; work lunch must microwave'),
    'work','microwave','available',
  );
  const patch=kitchenSettingsPatch(updated);
  assert.deepEqual(Object.keys(patch),['kitchen']);
  assert.equal(patch.kitchen.work.microwave,'available');
  assert.equal(patch.kitchen.constraints.container_count,15);
  assert.equal(patch.kitchen.constraints.notes,'One skillet; work lunch must microwave');
  assert.equal(JSON.stringify(patch).includes('food_safety'),false);
});
test('unknown and malformed stored equipment values normalize without throwing',()=>{
  const saved=parseKitchen({home:{microwave:'available',oven:'unexpected'},work:{microwave:'unavailable'},
    constraints:{burner_count:1,skillet_count:-3,container_count:120,notes:'  test  '}});
  assert.equal(saved.home.oven,'unknown');
  assert.equal(saved.home.microwave,'available');
  assert.equal(saved.work.microwave,'unavailable');
  assert.equal(saved.constraints.burner_count,1);
  assert.equal(saved.constraints.skillet_count,null);
  assert.equal(saved.constraints.container_count,null);
  assert.equal(saved.constraints.notes,'test');
});
