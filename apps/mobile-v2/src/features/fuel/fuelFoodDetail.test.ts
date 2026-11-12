import test from 'node:test';
import assert from 'node:assert/strict';
import {editableFoodDay,prepareFoodReplacement,newFoodActionId} from './fuelFoodDetail.ts';

const a='11111111-1111-4111-8111-111111111111';
const b='22222222-2222-4222-8222-222222222222';
const tz=Intl.DateTimeFormat().resolvedOptions().timeZone;
const row={
 id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',user_id:a,
 consumed_at:'2026-11-12T18:00:00Z',local_date:'2026-11-12',
 timezone_name:'America/Chicago',meal_slot:'lunch',label:'Actual food',
 quantity:1,unit:'serving',kcal:null,nutrition_source:'unknown',
 revision:1,created_at:'2026-11-12T18:00:00Z',deleted_at:null,
};
const payload={ownerId:a,localDate:'2026-11-12',sourceRevision:'fuel-food-day-v1:test',
 complete:true,entries:[row]};
const day=(p=payload,owner=a)=>editableFoodDay(p,owner,'2026-11-12');

test('only a full current owner snapshot can enter the editor',()=>{
 const accepted=day();
 assert.equal(accepted?.entries.length,1);
 assert.equal(accepted?.entries[0]?.kcal,null);
 assert.equal(day({...payload,complete:false}),null);
 assert.equal(day({...payload,ownerId:b}),null);
 assert.equal(day({...payload,entries:[{...row,user_id:b}]}),null);
 assert.equal(day({...payload,entries:[{...row,deleted_at:'2026-11-12T19:00:00Z'}]}),null);
});

test('omitted nutrition or portion fields cannot silently become defaults',()=>{
 assert.equal(day({...payload,entries:[{...row,quantity:undefined}]}),null);
 assert.equal(day({...payload,entries:[{...row,unit:undefined}]}),null);
 assert.equal(day({...payload,entries:[{...row,nutrition_source:undefined}]}),null);
 assert.equal(day({...payload,entries:[{...row,kcal:0}]}),null);
 assert.equal(day({...payload,entries:[{...row,kcal:200,nutrition_source:'user_entered'}]})?.entries[0]?.kcal,200);
});

const sample={day:'2026-11-12',clock:'12:15',timezoneName:tz,
 mealSlot:'lunch' as const,label:' My lunch ',quantity:'1',
 unit:'serving' as const,calories:''};
test('prepares explicit owner meal without inventing calories or time',()=>{
 const r=prepareFoodReplacement(sample);
 assert.equal(r?.label,'My lunch');
 assert.equal(r?.kcal,null);
 assert.equal(r?.nutritionSource,'unknown');
 assert.equal(r?.localDate,'2026-11-12');
 assert.equal(r?.timezoneName,tz);
 assert.equal(r?.consumedAt,new Date(2026,10,12,12,15).toISOString());
});

test('calories are only present when explicitly entered',()=>{
 const r=prepareFoodReplacement({...sample,calories:'350.5'});
 assert.equal(r?.kcal,350.5);
 assert.equal(r?.nutritionSource,'user_entered');
});

test('invalid date, clock, density and calorie claims fail closed',()=>{
 for(const f of [
  {...sample,day:'2026-02-30'},
  {...sample,clock:'25:10'},
  {...sample,clock:'12:99'},
  {...sample,timezoneName:'Fake/Zone'},
  {...sample,label:' '},
  {...sample,quantity:'0'},
  {...sample,quantity:'1e7'},
  {...sample,calories:'abc'},
  {...sample,calories:'-12'},
  {...sample,unit:'cups' as 'serving'},
 ])assert.equal(prepareFoodReplacement(f),null);
});

test('repeated fall-back wall-clock time is refused rather than silently resolving the wrong instant',()=>{
 const previous=process.env.TZ;
 try{
  process.env.TZ='America/Chicago';
  const repeated=prepareFoodReplacement({
   ...sample,day:'2026-11-01',clock:'01:30',timezoneName:'America/Chicago',
  });
  assert.equal(repeated,null);
  const clear=prepareFoodReplacement({
   ...sample,day:'2026-11-01',clock:'03:30',timezoneName:'America/Chicago',
  });
  assert.equal(clear?.localDate,'2026-11-01');
  const springGap=prepareFoodReplacement({
   ...sample,day:'2026-03-08',clock:'02:30',timezoneName:'America/Chicago',
  });
  assert.equal(springGap,null);
 }finally{
  if(previous===undefined)delete process.env.TZ;
  else process.env.TZ=previous;
 }
});
test('insecure or unavailable entropy fails closed and never produces an action ID',()=>{
 assert.equal(newFoodActionId(null),null);
 const throwing={
  getRandomValues(){throw new Error('Native entropy unavailable');},
 } as unknown as Pick<Crypto,'getRandomValues'>;
 assert.equal(newFoodActionId(throwing),null);
});
test('secure byte provider results have UUID version and variant bits',()=>{
 const entropy={
  getRandomValues(bytes:Uint8Array){bytes.fill(0);return bytes;},
 } as unknown as Pick<Crypto,'getRandomValues'>;
 assert.equal(newFoodActionId(entropy),'00000000-0000-4000-8000-000000000000');
});

test('secure id constructor generates RFC 4122 version 4 when available',()=>{
 const id=newFoodActionId();
 if(id===null)return; // devices without secure entropy fail closed
 assert.match(id,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
 assert.notEqual(id,newFoodActionId());
});
