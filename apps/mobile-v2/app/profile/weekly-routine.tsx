import { useCallback, useRef, useState } from 'react';
import { Link, Redirect, useFocusEffect } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../src/auth/AuthProvider';
import { useAccessGate } from '../../src/auth/AccessGateProvider';
import { assertV2SessionOwner, readV2OwnedProfileState } from '../../src/auth/accessGateClient';
import { v2AuthenticatedScreenKey } from '../../src/auth/authRoute';
import { supabase } from '../../src/lib/supabase';
import { colors } from '../../src/theme/tokens';
import { WEEK_DAYS, TIME_WINDOWS, parseWeeklyRoutine, emptyWeeklyRoutine, toggleRoutineDay,
  changeRoutineWindow, trainingRoutinePatch, nutritionRoutinePatch,
  type RoutineSlot, type WeekDay, type RoutineWindow, type WeeklyRoutine,
} from '../../src/features/profile/weeklyRoutine';

type SettingsState={version?:number;settings?:unknown};
type Section='training'|'nutrition';
function actionId(owner:string,section:Section) {
 return ['weekly-routine',section,owner,Date.now().toString(36),Math.random().toString(36).slice(2,10)].join(':');
}

export default function WeeklyRoutineScreen(){
 const {user,sessionGeneration}=useAuth();
 return <OwnedWeeklyRoutine key={v2AuthenticatedScreenKey(user?.id??null,sessionGeneration)}/>;
}
function OwnedWeeklyRoutine(){
 const {user,loading:authLoading}=useAuth();
 const gate=useAccessGate();
 const owner=user?.id??null;
 const [draft,setDraft]=useState<WeeklyRoutine>(emptyWeeklyRoutine);
 const [settingsVersion,setSettingsVersion]=useState<number|null>(null);
 const [loading,setLoading]=useState(true);
 const [saving,setSaving]=useState<Section|null>(null);
 const [error,setError]=useState<string|null>(null);
 const [notice,setNotice]=useState<string|null>(null);
 const [retry,setRetry]=useState(0);
 const busy=useRef(false);
 const mounted=useRef(false);
 const pending=useRef<{section:Section;version:number;patch:string;id:string}|null>(null);

 const refresh=useCallback(async(current:()=>boolean)=>{
  if(!owner)throw new Error('Sign in to edit your routine.');
  const data=await readV2OwnedProfileState(supabase,owner,current);
  const payload=data.settings as SettingsState|null;
  if(!Number.isSafeInteger(payload?.version)||!payload?.version||payload.version<1)
   throw new Error('Profile settings version is unavailable.');
  if(!current())return;
  setSettingsVersion(payload.version);
  setDraft(parseWeeklyRoutine(payload.settings));
 },[owner]);

 useFocusEffect(useCallback(()=>{
  if(!owner||authLoading||gate.status!=='ready')return;
  let active=true;mounted.current=true;setLoading(true);setSettingsVersion(null);setError(null);setNotice(null);pending.current=null;
  void refresh(()=>active).catch(cause=>{if(active)setError(cause instanceof Error?cause.message:'Could not load routine.');})
   .finally(()=>{if(active)setLoading(false);});
  return()=>{active=false;mounted.current=false};
 },[owner,authLoading,gate.status,refresh,retry]));

 function edit(key:keyof WeeklyRoutine,fn:(slot:RoutineSlot)=>RoutineSlot){
  if(busy.current)return;
  pending.current=null;
  setDraft(old=>({...old,[key]:fn(old[key])}));setNotice(null);setError(null);
 }

 async function save(section:Section){
  if(!owner||settingsVersion===null||loading||busy.current)return;
  busy.current=true;setSaving(section);setError(null);setNotice(null);
  const originalVersion=settingsVersion;
  const patch=section==='training'?trainingRoutinePatch(draft.training):
   nutritionRoutinePatch(draft.shopping,draft.mealPrep);
  const serialized=JSON.stringify(patch);
  const previous=pending.current;
  const id=previous?.section===section&&previous.version===originalVersion&&previous.patch===serialized
   ?previous.id:actionId(owner,section);
  pending.current={section,version:originalVersion,patch:serialized,id};
  try{
   await assertV2SessionOwner(supabase,owner);
   const {data,error:writeError}=await supabase.rpc('v2_patch_profile_settings_section',{
    p_expected_user_id:owner,
    p_section:section==='training'?'training_preferences':'nutrition_preferences',
    p_patch:patch,
    p_expected_version:originalVersion,
    p_client_action_id:id,
   });
   if(writeError){
    if(writeError.code==='40001'){
     pending.current=null;
     await refresh(()=>mounted.current);
    }
    throw writeError;
   }
   await assertV2SessionOwner(supabase,owner);
   if(!Number.isSafeInteger(data)||!data||data<1)throw new Error('Could not verify routine save.');
   await refresh(()=>mounted.current);
   pending.current=null;
   if(mounted.current)setNotice(section==='training'?'Training routine saved.':'Shopping and meal-prep routine saved.');
  }catch(cause){
   if(mounted.current)setError(cause instanceof Error?cause.message:'Could not save routine.');
  }finally{
   busy.current=false;if(mounted.current)setSaving(null);
  }
 }

 if(!authLoading&&!user)return <Redirect href="/sign-in"/>;
 if(gate.status==='legal_required')return <Redirect href="/legal-acceptance"/>;
 if(gate.status==='onboarding_required')return <Redirect href="/onboarding-required"/>;
 if(authLoading||gate.status!=='ready'||!owner)return <Redirect href="/"/>;

 return <SafeAreaView style={styles.safe}>
  <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
   <Link href="/profile" asChild><Pressable accessibilityRole="button" style={styles.back}><Text style={styles.gold}>‹ Profile</Text></Pressable></Link>
   <Text accessibilityRole="header" style={styles.title}>Weekly Routine</Text>
   <Text style={styles.helper}>Your usual habits help ALL IN personalize suggestions. They are preferences—not scheduled workouts, shopping trips, meal-prep sessions or automatic reminders.</Text>
   {loading?<ActivityIndicator color={colors.gold} accessibilityLabel="Loading weekly routine"/>:null}
   {error?<Text accessibilityRole="alert" style={styles.error}>{error}</Text>:null}
   {!loading&&settingsVersion===null?<Pressable accessibilityRole="button" style={styles.save} onPress={()=>setRetry(x=>x+1)}><Text style={styles.saveText}>Retry loading</Text></Pressable>:null}
   {!loading&&settingsVersion!==null?<>
    <View style={styles.card}>
     <Text style={styles.heading}>Training</Text>
     <Text style={styles.helper}>Usual available days and preferred time. Flexible? Leave days unselected and choose Varies.</Text>
     <RoutineFields slot={draft.training} disabled={saving!==null} onDay={day=>edit('training',x=>toggleRoutineDay(x,day))}
      onWindow={window=>edit('training',x=>changeRoutineWindow(x,window))}/>
     <Pressable accessibilityRole="button" disabled={saving!==null} accessibilityState={{disabled:saving!==null,busy:saving==='training'}}
      style={[styles.save,saving!==null&&styles.dim]} onPress={()=>void save('training')}>
      <Text style={styles.saveText}>{saving==='training'?'Saving…':'Save Training Routine'}</Text>
     </Pressable>
    </View>
    <View style={styles.card}>
     <Text style={styles.heading}>Grocery Shopping</Text>
     <Text style={styles.helper}>When do you usually shop? This does not create a shopping-list item or a reminder.</Text>
     <RoutineFields slot={draft.shopping} disabled={saving!==null} onDay={day=>edit('shopping',x=>toggleRoutineDay(x,day))}
      onWindow={window=>edit('shopping',x=>changeRoutineWindow(x,window))}/>
     <View style={styles.line}/>
     <Text style={styles.heading}>Meal Prep</Text>
     <Text style={styles.helper}>Choose one or more days you tend to batch cook. Cook Now remains separate from planned Meal Prep.</Text>
     <RoutineFields slot={draft.mealPrep} disabled={saving!==null} onDay={day=>edit('mealPrep',x=>toggleRoutineDay(x,day))}
      onWindow={window=>edit('mealPrep',x=>changeRoutineWindow(x,window))}/>
     <Pressable accessibilityRole="button" disabled={saving!==null} accessibilityState={{disabled:saving!==null,busy:saving==='nutrition'}}
      style={[styles.save,saving!==null&&styles.dim]} onPress={()=>void save('nutrition')}>
      <Text style={styles.saveText}>{saving==='nutrition'?'Saving…':'Save Shopping & Meal Prep'}</Text>
     </Pressable>
    </View>
    <View style={styles.coachCard}>
     <Text style={styles.coachHeading}>Have a more complicated schedule?</Text>
     <Text style={styles.helper}>Rotating shifts, different workout times, or a routine that changes week to week? Just tell Coach. Coach can help personalize your routine.</Text>
     <Text style={styles.coachPending}>Talk to Coach · Connection coming</Text>
    </View>
    <View style={styles.card}>
     <Text style={styles.heading}>Reminders</Text>
     <Text style={styles.helper}>Shopping and meal-prep notifications will be configurable through the existing Notifications system when V2 delivery is connected. Saving a routine does not enable push alerts.</Text>
    </View>
    {notice?<Text accessibilityRole="text" style={styles.gold}>{notice}</Text>:null}
   </>:null}
  </ScrollView>
 </SafeAreaView>;
}

function RoutineFields({slot,disabled,onDay,onWindow}:{
 slot:RoutineSlot;disabled:boolean;onDay:(day:WeekDay)=>void;onWindow:(window:RoutineWindow)=>void;
}){
 return <View style={styles.field}>
  <Text style={styles.label}>Usual days (optional)</Text>
  <View style={styles.chips}>{WEEK_DAYS.map(day=><Pressable key={day.id} accessibilityRole="checkbox"
   accessibilityState={{checked:slot.days.includes(day.id),disabled}} disabled={disabled}
   style={[styles.chip,slot.days.includes(day.id)&&styles.selected]} onPress={()=>onDay(day.id)}>
    <Text style={[styles.chipText,slot.days.includes(day.id)&&styles.selectedText]}>{day.label}</Text>
   </Pressable>)}</View>
  <Text style={styles.label}>Usual time (optional)</Text>
  <View style={styles.chips}>{TIME_WINDOWS.map(time=><Pressable key={time.id} accessibilityRole="radio"
   accessibilityState={{checked:slot.window===time.id,disabled}} disabled={disabled}
   style={[styles.chip,slot.window===time.id&&styles.selected]} onPress={()=>onWindow(time.id)}>
    <Text style={[styles.chipText,slot.window===time.id&&styles.selectedText]}>{time.label}</Text>
   </Pressable>)}</View>
 </View>;
}

const styles=StyleSheet.create({
 safe:{flex:1,backgroundColor:colors.background},
 content:{padding:24,paddingBottom:48,gap:18},
 back:{minHeight:44,justifyContent:'center'},
 gold:{color:colors.goldSoft,fontWeight:'700'},
 title:{color:colors.warmWhite,fontSize:29,fontWeight:'800'},
 heading:{color:colors.warmWhite,fontSize:19,fontWeight:'800'},
 helper:{color:colors.mutedText,fontSize:13,lineHeight:20},
 error:{color:colors.danger,fontSize:14},
 card:{backgroundColor:colors.surface,borderColor:colors.border,borderWidth:1,borderRadius:18,padding:17,gap:13},
 coachCard:{backgroundColor:colors.surface,borderColor:'#38332A',borderWidth:1,borderRadius:18,padding:17,gap:10},
 coachHeading:{color:colors.warmWhite,fontSize:16,fontWeight:'800'},
 coachPending:{color:colors.goldSoft,fontSize:13,fontWeight:'700'},
 field:{gap:10},label:{color:colors.mutedText,fontSize:12,fontWeight:'700'},
 chips:{flexDirection:'row',flexWrap:'wrap',gap:8},
 chip:{paddingHorizontal:13,paddingVertical:10,minHeight:44,justifyContent:'center',borderRadius:999,
  borderColor:colors.border,borderWidth:1,backgroundColor:colors.surfaceRaised},
 selected:{backgroundColor:colors.gold,borderColor:colors.gold},
 chipText:{color:colors.warmWhite,fontWeight:'700'},
 selectedText:{color:colors.background},
 save:{minHeight:48,borderRadius:14,backgroundColor:colors.gold,alignItems:'center',justifyContent:'center',paddingHorizontal:12},
 saveText:{color:colors.background,fontWeight:'800'},
 line:{height:1,backgroundColor:colors.border},dim:{opacity:0.6},
});
