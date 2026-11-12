import {useCallback,useEffect,useRef,useState} from 'react';
import {useFocusEffect} from 'expo-router';
import {Pressable,StyleSheet,Text,TextInput,View} from 'react-native';
import {colors} from '../../theme/tokens.ts';
import {supabase} from '../../lib/supabase.ts';
import {deviceLocalToday} from '../today/todayEntry.ts';
import {readOwnedFuelDayPayload,V2_FUEL_DAY_READ_ENABLED} from './fuelOwnerFoodClient.ts';
import {V2_FUEL_MANUAL_WRITE_ENABLED,writeOwnedManualFood,type ManualFoodCommand} from './fuelOwnerFoodWrite.ts';
import {editableFoodDay,newFoodActionId,prepareFoodReplacement,type EditableFoodDay,type EditableFoodRow,type FoodFormInput} from './fuelFoodDetail.ts';

type FuelMeal='breakfast'|'lunch'|'dinner'|'snack'|'other';
const mealOrder:FuelMeal[]=['breakfast','lunch','dinner','snack','other'];
const mealLabels:Record<FuelMeal,string>={
 breakfast:'Breakfast',lunch:'Lunch',dinner:'Dinner',snack:'Snacks',other:'Other',
};
const units:FoodFormInput['unit'][]=['serving','each','g','oz','ml','fl_oz'];
const deviceClock=()=>{
 const d=new Date();
 return [String(d.getHours()).padStart(2,'0'),String(d.getMinutes()).padStart(2,'0')].join(':');
};
const localTimeFor=(iso:string,zone:string):string=>{
 try{
  return new Intl.DateTimeFormat('en-GB',{timeZone:zone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(iso));
 }catch{return deviceClock();}
};
const timezone=()=>Intl.DateTimeFormat().resolvedOptions().timeZone??'';
const defaultForm=(day:string):FoodFormInput=>({
 day,clock:deviceClock(),timezoneName:timezone(),mealSlot:'lunch',
 label:'',quantity:'1',unit:'serving',calories:'',
});
function rowForm(row:EditableFoodRow):FoodFormInput{
 return {
  day:row.local_date,clock:localTimeFor(row.consumed_at,row.timezone_name),
  timezoneName:row.timezone_name,mealSlot:row.meal_slot as FuelMeal,
  label:row.label,quantity:String(row.quantity),unit:row.unit,
  calories:row.kcal===null?'':String(row.kcal),
 };
}
type Editor={kind:'add'}|{kind:'edit';row:EditableFoodRow}|null;
const unavailableText='Food Log data is not available yet. Existing meals are not assumed missing.';

export function FuelFoodLogPanel({ownerId,day,accessReady,onDayChange}:{
 ownerId:string;day:string;accessReady:boolean;onDayChange:(newDay:string)=>void;
}){
 const [snapshot,setSnapshot]=useState<EditableFoodDay|null>(null);
 const [loading,setLoading]=useState(false);
 const [refresh,setRefresh]=useState(0);
 const [editor,setEditor]=useState<Editor>(null);
 const [form,setForm]=useState<FoodFormInput>(()=>defaultForm(day));
 const [notice,setNotice]=useState<string|null>(null);
 const [busy,setBusy]=useState(false);
 const [confirmDelete,setConfirmDelete]=useState<string|null>(null);
 const pending=useRef<{key:string;command:ManualFoodCommand}|null>(null);
 const busyRef=useRef(false);
 const active=useRef(true);
 const focused=useRef(false);
 useEffect(()=>{
  active.current=true;
  return()=>{active.current=false;focused.current=false;};
 },[]);
 useFocusEffect(useCallback(()=>{
  focused.current=true;
  setRefresh(r=>r+1);
  return()=>{focused.current=false;};
 },[]));
 useEffect(()=>{
  pending.current=null;setEditor(null);setForm(defaultForm(day));
  setNotice(null);setConfirmDelete(null);setSnapshot(null);
 },[ownerId,day]);
 useEffect(()=>{
  let current=true;
  setSnapshot(null);
  if(!V2_FUEL_DAY_READ_ENABLED||!accessReady||!ownerId){
   setLoading(false);return()=>{current=false;};
  }
  setLoading(true);
  void readOwnedFuelDayPayload(supabase,ownerId,day,
   ()=>current&&active.current&&focused.current)
   .then(payload=>{
    if(!current||!active.current)return;
    setSnapshot(editableFoodDay(payload,ownerId,day));
   })
   .catch(()=>{if(current&&active.current)setSnapshot(null);})
   .finally(()=>{if(current&&active.current)setLoading(false);});
  return()=>{current=false;};
 },[ownerId,day,accessReady,refresh]);
 const canWrite=V2_FUEL_MANUAL_WRITE_ENABLED&&V2_FUEL_DAY_READ_ENABLED&&
  accessReady&&snapshot!==null&&!loading;
 const beginAdd=()=>{
  if(!canWrite)return;
  pending.current=null;setEditor({kind:'add'});setForm(defaultForm(day));
  setNotice(null);setConfirmDelete(null);
 };
 const beginEdit=(row:EditableFoodRow)=>{
  if(!canWrite)return;
  pending.current=null;setEditor({kind:'edit',row});
  setForm(rowForm(row));setNotice(null);setConfirmDelete(null);
 };
 const updateForm=<K extends keyof FoodFormInput>(key:K,value:FoodFormInput[K])=>{
  pending.current=null;
  setForm(f=>({...f,[key]:value}));
 };
 const record=async(command:ManualFoodCommand)=>{
  if(busyRef.current||!canWrite||!active.current||!focused.current)return;
  busyRef.current=true;setBusy(true);setNotice(null);
  const result=await writeOwnedManualFood(supabase,command,
   ()=>active.current&&focused.current);
  if(!active.current){busyRef.current=false;return;}
  busyRef.current=false;setBusy(false);
  if(result.status==='saved'){
   pending.current=null;setEditor(null);setConfirmDelete(null);
   setNotice('Saved to Food Log. Refreshing the day.');
   // A moved or newly added entry can belong to a different selected date.
   // Show its actual saved date instead of implying it disappeared.
   if(command.operation!=='delete'&&command.replacement.localDate!==day){
    onDayChange(command.replacement.localDate);
   }else setRefresh(r=>r+1);
  }else if(result.status==='conflict'){
   pending.current=null;
   setEditor(null);setConfirmDelete(null);
   setNotice('This meal changed elsewhere. Reloaded the latest day; review before editing again.');
   setRefresh(r=>r+1);
  }else if(result.status==='unauthorized'){
   setNotice('Session could not be verified. Sign in again before changing food.');
  }else{
   // Keep the action ID across ambiguous network results; an exact retry
   // is idempotent and cannot create a second food entry.
   setNotice(result.status==='unavailable'?
    'Save could not be confirmed. Retry the unchanged entry safely, or refresh.':
    'Food entry is invalid or writing is unavailable.');
  }
 };
 const submit=()=>{
  if(!editor||!canWrite)return;
  const replacement=prepareFoodReplacement(form);
  if(!replacement){setNotice('Check the date, time, timezone, food, quantity and optional calories.');return;}
  const changedTime=editor.kind==='edit'&&(
   form.day!==editor.row.local_date||
   form.clock!==localTimeFor(editor.row.consumed_at,editor.row.timezone_name)||
   form.timezoneName!==editor.row.timezone_name);
  const changedMeal=editor.kind==='edit'&&form.mealSlot!==editor.row.meal_slot;
  const operation=editor.kind==='add'?'add':(changedTime||changedMeal?'move':'edit');
  // Preserve the original instant on a non-temporal edit, including seconds.
  if(editor.kind==='edit'&&!changedTime)replacement.consumedAt=editor.row.consumed_at;
  // A move cannot modify nutrition, quantity, or label; use edit then move.
  if(editor.kind==='edit'&&operation==='move'&&(
   replacement.label!==editor.row.label||replacement.quantity!==editor.row.quantity
   ||replacement.unit!==editor.row.unit||replacement.kcal!==editor.row.kcal
   ||replacement.nutritionSource!==editor.row.nutrition_source)){
    setNotice('Save food and quantity changes first, then move its time or meal.');return;
  }
  const key=JSON.stringify([ownerId,editor.kind==='edit'?editor.row.id:null,
   editor.kind==='edit'?editor.row.revision:null,operation,replacement]);
  let command=pending.current?.key===key?pending.current.command:null;
  if(!command){
   const actionId=newFoodActionId();
   const entryId=editor.kind==='add'?newFoodActionId():editor.row.id;
   if(!actionId||!entryId){setNotice('Secure action IDs are unavailable on this device. Nothing was saved.');return;}
   command=editor.kind==='add'
    ?{operation:'add',ownerId,actionId,entryId,replacement}
    :{operation:operation==='move'?'move':'edit',ownerId,actionId,entryId,
      expectedRevision:editor.row.revision,replacement};
   pending.current={key,command};
  }
  void record(command);
 };
 const remove=(row:EditableFoodRow)=>{
  if(!canWrite)return;
  if(confirmDelete!==row.id){setConfirmDelete(row.id);setNotice('Press Delete again to confirm removal.');return;}
  const key=JSON.stringify(['delete',ownerId,row.id,row.revision]);
  let command=pending.current?.key===key?pending.current.command:null;
  if(!command){
   const actionId=newFoodActionId();
   if(!actionId){setNotice('Secure action IDs unavailable. Nothing was deleted.');return;}
   command={operation:'delete',ownerId,actionId,entryId:row.id,expectedRevision:row.revision};
   pending.current={key,command};
  }
  void record(command);
 };
 const currentRows=snapshot?.entries??[];
 const today=deviceLocalToday();
 return (
  <View style={styles.section}>
   <View style={styles.heading}>
    <Text accessibilityRole="header" style={styles.headingTitle}>Food Log</Text>
    <Text style={styles.small}>{day}</Text>
   </View>
   <View style={styles.metrics}>
    {['Calories','Protein','Carbs','Fat'].map(label=>(
     <View key={label} style={styles.metric}>
      <Text style={styles.metricValue}>—</Text><Text style={styles.small}>{label}</Text>
     </View>
    ))}
   </View>
   <Text style={styles.note}>Nutrition totals are not connected yet. Logged foods can exist even when totals are unavailable.</Text>
   {loading?<Text style={styles.small}>Loading your Food Log…</Text>:
    snapshot===null?<Text style={styles.small}>{unavailableText}</Text>:
    currentRows.length===0?<Text style={styles.small}>No entries in the verified log for this day.</Text>:
    mealOrder.map(meal=>{
     const entries=currentRows.filter(row=>row.meal_slot===meal);
     if(!entries.length)return null;
     return <View key={meal} style={styles.mealGroup}>
      <Text style={styles.mealHeading}>{mealLabels[meal]}</Text>
      {entries.map(row=>(
       <View key={row.id} style={styles.foodRow}>
        <View style={styles.rowDetails}>
         <Text style={styles.foodLabel}>{row.label}</Text>
         <Text style={styles.small}>{row.quantity} {row.unit} · {row.kcal===null?'Calories unknown':row.kcal+' kcal (entered)'}</Text>
        </View>
        {canWrite?<View style={styles.rowActions}>
         <Pressable disabled={busy} accessibilityRole="button"
          accessibilityLabel={'Edit '+row.label} onPress={()=>beginEdit(row)}>
          <Text style={styles.action}>Edit</Text>
         </Pressable>
         <Pressable disabled={busy} accessibilityRole="button"
          accessibilityLabel={'Delete '+row.label} onPress={()=>remove(row)}>
          <Text style={[styles.action,styles.danger]}>{confirmDelete===row.id?'Confirm':'Delete'}</Text>
         </Pressable>
        </View>:null}
       </View>
      ))}
     </View>;
    })}
   {canWrite&&!editor?<Pressable accessibilityRole="button" onPress={beginAdd}
    style={styles.goldButton}><Text style={styles.goldButtonLabel}>+ Add Food</Text></Pressable>:null}
   {!V2_FUEL_MANUAL_WRITE_ENABLED?<Text style={styles.small}>Manual Food Log editing is not enabled in this build.</Text>:null}
   {editor&&canWrite?<View style={styles.form}>
    <Text accessibilityRole="header" style={styles.mealHeading}>
     {editor.kind==='add'?'Add Food':'Edit Food'}
    </Text>
    <Text style={styles.small}>Meal</Text>
    <View style={styles.choices}>{mealOrder.map(m=>(
     <Pressable key={m} accessibilityRole="button" accessibilityState={{selected:form.mealSlot===m}}
      style={[styles.choice,form.mealSlot===m&&styles.choiceSelected]}
      onPress={()=>updateForm('mealSlot',m)}><Text style={styles.small}>{mealLabels[m]}</Text></Pressable>
    ))}</View>
    <Text style={styles.small}>Food name</Text>
    <TextInput accessibilityLabel="Food name" placeholder="Food or meal" placeholderTextColor={colors.mutedText}
      value={form.label} onChangeText={v=>updateForm('label',v)} style={styles.input} maxLength={200}/>
    <View style={styles.twoCols}>
     <View style={styles.flex}><Text style={styles.small}>Quantity</Text>
      <TextInput accessibilityLabel="Quantity" keyboardType="decimal-pad" value={form.quantity}
       onChangeText={v=>updateForm('quantity',v)} style={styles.input}/></View>
     <View style={styles.flex}><Text style={styles.small}>Unit</Text>
      <View style={styles.choices}>{units.map(u=><Pressable key={u} accessibilityRole="button"
       accessibilityState={{selected:form.unit===u}} onPress={()=>updateForm('unit',u)}
       style={[styles.choice,form.unit===u&&styles.choiceSelected]}>
       <Text style={styles.small}>{u}</Text></Pressable>)}</View></View>
    </View>
    <Text style={styles.small}>Calories (optional, only if known)</Text>
    <TextInput accessibilityLabel="Calories optional" keyboardType="decimal-pad"
      placeholder="Unknown" placeholderTextColor={colors.mutedText}
      value={form.calories} onChangeText={v=>updateForm('calories',v)} style={styles.input}/>
    <View style={styles.twoCols}>
     <View style={styles.flex}><Text style={styles.small}>Local date (YYYY-MM-DD)</Text>
      <TextInput accessibilityLabel="Food date" value={form.day}
       onChangeText={v=>updateForm('day',v)} style={styles.input}/></View>
     <View style={styles.flex}><Text style={styles.small}>Local time (HH:MM)</Text>
      <TextInput accessibilityLabel="Food time" value={form.clock}
       onChangeText={v=>updateForm('clock',v)} style={styles.input}/></View>
    </View>
    <Text style={styles.note}>Time zone: {form.timezoneName}. For accurate edits, your device must use the same time zone as this entry.</Text>
    <View style={styles.buttons}>
     <Pressable disabled={busy} accessibilityRole="button" onPress={()=>{
      pending.current=null;setEditor(null);setNotice(null);
     }} style={styles.secondaryButton}><Text style={styles.foodLabel}>Cancel</Text></Pressable>
     <Pressable disabled={busy} accessibilityRole="button" onPress={submit}
      style={styles.goldButton}><Text style={styles.goldButtonLabel}>{busy?'Saving…':'Save food'}</Text></Pressable>
    </View>
   </View>:null}
   {notice?<Text accessibilityRole="alert" style={styles.notice}>{notice}</Text>:null}
   {today&&day!==today?<Text style={styles.note}>You are viewing {day}, not today. Dates and times are saved exactly as entered.</Text>:null}
  </View>
 );
}
const styles=StyleSheet.create({
 section:{gap:14},
 heading:{flexDirection:'row',alignItems:'center',justifyContent:'space-between'},
 headingTitle:{color:colors.warmWhite,fontSize:22,fontWeight:'800'},
 metric:{flex:1,alignItems:'center',paddingVertical:12,backgroundColor:colors.surfaceRaised,borderRadius:14},
 metrics:{flexDirection:'row',gap:6},
 metricValue:{color:colors.goldSoft,fontWeight:'800',fontSize:20},
 small:{color:colors.mutedText,fontSize:12,lineHeight:18},
 note:{color:colors.mutedText,fontSize:13,lineHeight:20},
 mealGroup:{gap:8},
 mealHeading:{color:colors.warmWhite,fontWeight:'700',fontSize:17},
 foodRow:{backgroundColor:colors.surface,borderRadius:14,borderWidth:1,borderColor:colors.border,
  flexDirection:'row',alignItems:'center',padding:14,gap:10},
 rowDetails:{flex:1,gap:5},
 foodLabel:{color:colors.warmWhite,fontWeight:'600',fontSize:15},
 rowActions:{gap:12,alignItems:'flex-end'},
 action:{color:colors.goldSoft,fontWeight:'700',fontSize:13},
 danger:{color:colors.danger},
 goldButton:{backgroundColor:colors.gold,borderRadius:12,paddingHorizontal:18,paddingVertical:14,alignItems:'center'},
 goldButtonLabel:{color:colors.background,fontWeight:'800',fontSize:14},
 secondaryButton:{backgroundColor:colors.surfaceRaised,borderRadius:12,paddingHorizontal:18,paddingVertical:14},
 form:{backgroundColor:colors.surface,borderColor:colors.border,borderWidth:1,
  padding:16,borderRadius:16,gap:10},
 input:{color:colors.warmWhite,backgroundColor:colors.surfaceRaised,borderRadius:10,
  minHeight:44,paddingHorizontal:12,borderColor:colors.border,borderWidth:1},
 choices:{flexDirection:'row',flexWrap:'wrap',gap:6},
 choice:{paddingVertical:9,paddingHorizontal:10,borderWidth:1,borderRadius:10,borderColor:colors.border},
 choiceSelected:{borderColor:colors.gold,backgroundColor:colors.surfaceRaised},
 twoCols:{flexDirection:'row',gap:12},
 flex:{flex:1,gap:5},
 buttons:{flexDirection:'row',justifyContent:'flex-end',gap:10,alignItems:'center'},
 notice:{color:colors.goldSoft,fontSize:13,lineHeight:19},
});
