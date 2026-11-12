import {useCallback,useEffect,useState} from 'react';
import {useFocusEffect} from 'expo-router';
import {Pressable,StyleSheet,Text,View} from 'react-native';
import {colors} from '../../theme/tokens.ts';
import {supabase} from '../../lib/supabase.ts';
import {readKitchenWeek,ownedKitchenPlanServices,V2_KITCHEN_PLAN_ENABLED,
 type KitchenWeek,type PlannedMealSlot} from './kitchenPlanOwnerClient.ts';

const mealSlots:PlannedMealSlot[]=['breakfast','lunch','dinner','snack'];
const labels:Record<PlannedMealSlot,string>={
 breakfast:'Breakfast',lunch:'Lunch',dinner:'Dinner',snack:'Snacks',
};
const weekMonday=(day:string)=>{
 if(!/^\d{4}-\d{2}-\d{2}$/.test(day))return null;
 const dt=new Date(day+'T00:00:00Z');
 if(!Number.isFinite(dt.getTime())||dt.toISOString().slice(0,10)!==day)return null;
 dt.setUTCDate(dt.getUTCDate()-((dt.getUTCDay()+6)%7));
 return dt.toISOString().slice(0,10);
};
const weekShift=(week:string,delta:number)=>{
 const dt=new Date(week+'T00:00:00Z');
 dt.setUTCDate(dt.getUTCDate()+delta*7);
 return dt.toISOString().slice(0,10);
};
const weekDates=(week:string)=>Array.from({length:7},(_,i)=>{
 const dt=new Date(week+'T00:00:00Z');
 dt.setUTCDate(dt.getUTCDate()+i);
 return dt.toISOString().slice(0,10);
});

/** Read-only canonical Kitchen view. Never reports an unconnected owner as empty.
 * Reference names must be joined with reviewed Cookbook/Food owners before
 * enabling edit/add actions or displaying nutrition or Shopping quantities.
 */
export function KitchenWeekPlanPanel({ownerId,day,accessReady}:{
 ownerId:string;day:string;accessReady:boolean;
}){
 const [week,setWeek]=useState(()=>weekMonday(day)??'');
 const [snapshot,setSnapshot]=useState<KitchenWeek|null>(null);
 const [busy,setBusy]=useState(false);
 const [revision,setRevision]=useState(0);
 useEffect(()=>setWeek(weekMonday(day)??''),[day,ownerId]);
 useFocusEffect(useCallback(()=>{
  setRevision(v=>v+1);
  return()=>setSnapshot(null);
 },[]));
 useEffect(()=>{
  let active=true;
  setSnapshot(null);
  if(!accessReady||!V2_KITCHEN_PLAN_ENABLED||!week){
   setBusy(false);return()=>{active=false;};
  }
  setBusy(true);
  void readKitchenWeek(ownedKitchenPlanServices(supabase,ownerId),ownerId,week,
   ()=>active,true).then(result=>{
    if(active)setSnapshot(result.status==='ready'?result.week:null);
  }).catch(()=>{if(active)setSnapshot(null);})
   .finally(()=>{if(active)setBusy(false);});
  return()=>{active=false;};
 },[ownerId,week,accessReady,revision]);
 const canRead=accessReady&&V2_KITCHEN_PLAN_ENABLED;
 return <View style={styles.outer}>
  <View style={styles.navigation}>
   <Pressable accessibilityRole="button" accessibilityLabel="Previous meal plan week"
    style={styles.arrow} disabled={!week} onPress={()=>setWeek(w=>weekShift(w,-1))}>
    <Text style={styles.text}>‹</Text></Pressable>
   <Text style={styles.week}>Week of {week||'Unavailable'}</Text>
   <Pressable accessibilityRole="button" accessibilityLabel="Next meal plan week"
    style={styles.arrow} disabled={!week} onPress={()=>setWeek(w=>weekShift(w,1))}>
    <Text style={styles.text}>›</Text></Pressable>
  </View>
  {!canRead?<Text style={styles.notice}>Meal Plan is not connected yet. Your existing plans are not assumed empty.</Text>
   :busy?<Text style={styles.notice}>Loading your Meal Plan…</Text>
   :snapshot===null?<Text style={styles.notice}>Your Meal Plan could not be verified. No meals were changed.</Text>
   :snapshot.entries.length===0?<Text style={styles.notice}>No meals scheduled in this verified week.</Text>
   :<View style={styles.days}>
    <Text style={styles.notice}>{snapshot.entries.length} planned food and recipe items this week. Food details and add/edit controls require the canonical source catalog.</Text>
    {weekDates(week).map(d=>{
     const entries=snapshot.entries.filter(e=>e.eatDate===d);
     if(!entries.length)return null;
     return <View key={d} style={styles.day}>
      <Text style={styles.dayText}>{d}</Text>
      {mealSlots.map(slot=>{
       const matched=entries.filter(e=>e.mealSlot===slot);
       return matched.length?<Text key={slot} style={styles.text}>
        {labels[slot]} · {matched.length} planned {matched.length===1?'item':'items'}
       </Text>:null;
      })}
     </View>;
    })}
   </View>}
 </View>;
}
const styles=StyleSheet.create({
 outer:{gap:13},navigation:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',
  backgroundColor:colors.surfaceRaised,borderRadius:12,paddingHorizontal:8},
 arrow:{minWidth:44,minHeight:44,alignItems:'center',justifyContent:'center'},
 week:{color:colors.warmWhite,fontWeight:'700',fontSize:14},
 text:{color:colors.warmWhite,fontSize:14},
 notice:{color:colors.goldSoft,fontSize:13,lineHeight:20},
 days:{gap:12},day:{backgroundColor:colors.surfaceRaised,borderRadius:12,padding:12,gap:6},
 dayText:{color:colors.goldSoft,fontWeight:'800',fontSize:15},
});
