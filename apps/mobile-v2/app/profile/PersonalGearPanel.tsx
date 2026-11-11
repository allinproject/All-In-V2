import { useCallback, useRef, useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, Text, TextInput, View, ActivityIndicator } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { assertV2SessionOwner, readV2OwnedProfileState } from '../../src/auth/accessGateClient';
import { supabase } from '../../src/lib/supabase';
import { colors } from '../../src/theme/tokens';
import {addPersonalGear,changeGearStatus,changeGearDistance,setShoeMileageRecommendation,selectGearDefault,
 parsePersonalGear,personalGearPatch,emptyPersonalGear,type PersonalGear,type GearKind,
 type GearItem,type ShoeUse,type BikeUse} from '../../src/features/training/personalGear';
import {lookupVerifiedShoeMileage,type ShoeMileageRecommendation} from '../../src/features/training/shoeMileageRecommendation';
const MI_TO_KM=1.609344;
const miles=(km:number)=>Math.round(km/MI_TO_KM*10)/10;
export function PersonalGearPanel({owner}:{owner:string}){
 const [section,setSection]=useState<GearKind>('shoes');
 const [state,setState]=useState<PersonalGear>(emptyPersonalGear);
 const [version,setVersion]=useState<number|null>(null);
 const [loading,setLoading]=useState(true),[saving,setSaving]=useState(false);
 const [error,setError]=useState<string|null>(null),[notice,setNotice]=useState<string|null>(null);
 const [name,setName]=useState(''),[distance,setDistance]=useState('0'),[threshold,setThreshold]=useState('');
 const [use,setUse]=useState<ShoeUse|BikeUse|'general'>('road');
 const [editing,setEditing]=useState<string|null>(null),[editedDistance,setEditedDistance]=useState('');
 const [editingTarget,setEditingTarget]=useState<string|null>(null),[targetValue,setTargetValue]=useState('');
 const [retry,setRetry]=useState(0);
 const alive=useRef(false),busy=useRef(false),ids=useRef(0);
 const pending=useRef<{version:number;serialized:string;id:string}|null>(null);
 const newId=()=>[owner,'personal-gear',Date.now().toString(36),(++ids.current).toString(36),Math.random().toString(36).slice(2,10)].join(':');
 const refresh=useCallback(async(current:()=>boolean)=>{
  const result=await readV2OwnedProfileState(supabase,owner,current);
  const snapshot=result.settings as {version?:number;settings?:unknown}|null;
  if(!Number.isSafeInteger(snapshot?.version)||!snapshot?.version||snapshot.version<1)throw new Error('Gear settings version unavailable.');
  if(!current())return;
  setState(parsePersonalGear(snapshot.settings));setVersion(snapshot.version);
 },[owner]);
 useFocusEffect(useCallback(()=>{
  let active=true;alive.current=true;setLoading(true);setVersion(null);setError(null);setNotice(null);pending.current=null;
  void refresh(()=>active&&alive.current).catch(e=>{if(active&&alive.current)setError(e instanceof Error?e.message:'Could not load gear.')})
   .finally(()=>{if(active&&alive.current)setLoading(false)});
  return()=>{active=false;alive.current=false};
 },[refresh,retry]));
 function update(make:(old:PersonalGear)=>PersonalGear){
  if(busy.current||loading||version===null)return;
  try{setState(make(state));setError(null);setNotice(null);pending.current=null}
  catch(e){setError(e instanceof Error?e.message:'Could not change gear.')}
 }
 function changeSection(kind:GearKind){setSection(kind);setUse(kind==='shoes'?'road':kind==='bikes'?'outdoor':'general');setEditing(null);setEditingTarget(null)}
 function create(){
  try{
   const mi=Number(distance),recommendation=section==='shoes'?lookupVerifiedShoeMileage(name):null;
   const thresholdMi=threshold.trim()===''?(recommendation?recommendation.recommendedAlertKm/MI_TO_KM:null):Number(threshold);
   if(distance.trim()===''||!Number.isFinite(mi)||mi<0||thresholdMi!==null&&(!Number.isFinite(thresholdMi)||thresholdMi<=0))
    throw new Error('Enter a valid starting mileage and optional reminder threshold.');
   const item:GearItem={id:newId(),kind:section,name,distanceKm:mi*MI_TO_KM,status:'active',
     reminderKm:thresholdMi===null?null:thresholdMi*MI_TO_KM,use,
     ...(section==='shoes'?{recommendation}:{}),};
   const next=addPersonalGear(state,item);
   update(()=>next);setName('');setDistance('0');setThreshold('');
  }catch(e){setError(e instanceof Error?e.message:'Could not add gear.')}
 }
 async function save(){
  if(busy.current||loading||version===null)return;
  busy.current=true;setSaving(true);setError(null);setNotice(null);
  try{
   const patch=personalGearPatch(state),serialized=JSON.stringify(patch);
   const prev=pending.current,id=prev?.version===version&&prev.serialized===serialized?prev.id:newId();
   pending.current={version,serialized,id};
   await assertV2SessionOwner(supabase,owner);
   const {data,error:writeError}=await supabase.rpc('v2_patch_profile_settings_section',{
    p_expected_user_id:owner,p_section:'training_preferences',p_patch:patch,p_expected_version:version,p_client_action_id:id,
   });
   if(writeError){
    if(writeError.code==='40001'){pending.current=null;await refresh(()=>alive.current)}
    throw writeError;
   }
   await assertV2SessionOwner(supabase,owner);
   if(typeof data!=='number'||!Number.isSafeInteger(data)||data<1)throw new Error('Could not verify gear save.');
   await refresh(()=>alive.current);pending.current=null;
   if(alive.current)setNotice('Personal gear saved.');
  }catch(e){if(alive.current)setError(e instanceof Error?e.message:'Could not save personal gear.')}
  finally{busy.current=false;if(alive.current)setSaving(false)}
 }
 const shown=state.items.filter(item=>item.kind===section);
 const suggested=section==='shoes'?lookupVerifiedShoeMileage(name):null;
 const miRange=(r:ShoeMileageRecommendation)=>`${Math.round(miles(r.minKm))}–${Math.round(miles(r.maxKm))} mi`;
 const defaultKeys=(item:GearItem):Array<keyof PersonalGear['defaults']>=>{
  if(item.kind==='shoes')return item.use==='mixed'?['road','trail']:item.use==='road'?['road']:['trail'];
  if(item.kind==='bikes')return item.use==='outdoor'?['outdoorBike']:['indoorBike'];
  return [];
 };
 return <View style={styles.wrap}>
  <Text style={styles.heading}>Personal Gear</Text>
  <Text style={styles.helper}>Manage shoes, bikes and gear. Shoe lifespan recommendations use verified guidance when available; mileage remains manual until completed workouts are connected.</Text>
  <View style={styles.tabs}>{(['shoes','bikes','other'] as GearKind[]).map(kind=><Pressable key={kind} accessibilityRole="tab" accessibilityState={{selected:section===kind}}
   style={[styles.tab,section===kind&&styles.active]} onPress={()=>changeSection(kind)}>
   <Text style={section===kind?styles.selectedText:styles.labelText}>{kind==='shoes'?'Shoes':kind==='bikes'?'Bikes':'Other Gear'}</Text>
  </Pressable>)}</View>
  {loading?<ActivityIndicator color={colors.gold}/>:null}
  {error?<Text accessibilityRole="alert" style={styles.error}>{error}</Text>:null}
  {!loading&&version===null?<Pressable accessibilityRole="button" onPress={()=>setRetry(x=>x+1)}><Text style={styles.gold}>Retry loading</Text></Pressable>:null}
  {!loading&&version!==null?<>
   {shown.length===0?<Text style={styles.helper}>No {section==='shoes'?'shoes':section==='bikes'?'bikes':'gear'} saved yet.</Text>:null}
   {shown.map(item=><View style={styles.card} key={item.id}>
    <Text style={styles.heading}>{item.name}</Text>
    <Text style={styles.helper}>{item.kind==='shoes'?(item.use==='road'?'Road':item.use==='trail'?'Trail':'Road & Trail'):
     item.kind==='bikes'?(item.use==='indoor'?'Indoor':'Outdoor'):'Personal gear'} · {item.status==='retired'?'Retired':'Active'}</Text>
    <Text style={styles.metric}>{miles(item.distanceKm)} mi</Text>
    {item.recommendation?<><Text style={styles.helper}>Recommended shoe lifespan: {miRange(item.recommendation)} ({item.recommendation.scope==='model_specific'?'Model-specific':'Brand/general guidance'})</Text>
      <Text style={styles.helper}>Source: {item.recommendation.sourceName}</Text>
      {item.recommendation.sourceUrl?<Pressable accessibilityRole="link" onPress={()=>void Linking.openURL(item.recommendation!.sourceUrl!)}><Text style={styles.gold}>View recommendation source</Text></Pressable>:null}
     </>:null}
    {item.reminderKm!==null?<Text style={styles.helper}>Mileage alert target: {miles(item.reminderKm)} mi · Advisory only; no automatic retirement</Text>:null}
    {item.kind==='shoes'?<>
     {editingTarget===item.id?<View style={styles.card}>
      <Text style={styles.helper}>Notify me at (miles)</Text>
      <TextInput style={styles.input} keyboardType="decimal-pad" accessibilityLabel="Shoe mileage alert target" value={targetValue} onChangeText={setTargetValue}/>
      <Pressable style={styles.outline} accessibilityRole="button" onPress={()=>{
       const value=Number(targetValue);
       if(targetValue.trim()===''||!Number.isFinite(value)||value<=0){setError('Enter a valid mileage alert target.');return;}
       update(s=>setShoeMileageRecommendation(s,item.id,item.recommendation??null,value*MI_TO_KM));setEditingTarget(null);
      }}><Text style={styles.gold}>Apply alert target</Text></Pressable>
     </View>:<Pressable style={styles.outline} accessibilityRole="button" onPress={()=>{
       setEditingTarget(item.id);setTargetValue(item.reminderKm===null?'':String(miles(item.reminderKm)));
      }}><Text style={styles.gold}>Edit shoe mileage alert</Text></Pressable>}
     {!item.recommendation?<Pressable style={styles.outline} accessibilityRole="button" onPress={()=>{
       const found=lookupVerifiedShoeMileage(item.name);
       if(!found){setNotice('No verified manufacturer recommendation found yet. Set your preferred alert mileage manually.');return;}
       update(s=>setShoeMileageRecommendation(s,item.id,found,item.reminderKm??found.recommendedAlertKm));
      }}><Text style={styles.gold}>Look up shoe lifespan guidance</Text></Pressable>:null}
    </>:null}
    {defaultKeys(item).map(key=><Pressable key={key} accessibilityRole="button" disabled={saving||item.status==='retired'}
       style={styles.outline} onPress={()=>update(s=>selectGearDefault(s,key,s.defaults[key]===item.id?null:item.id))}>
       <Text style={styles.gold}>{state.defaults[key]===item.id?'★ Default · Remove':key==='road'?'Set road default':key==='trail'?'Set trail default':key==='outdoorBike'?'Set outdoor bike default':'Set indoor bike default'}</Text>
    </Pressable>)}
    {editing===item.id?<View style={styles.card}><Text style={styles.helper}>Correct total lifetime mileage (mi)</Text>
      <TextInput style={styles.input} keyboardType="decimal-pad" value={editedDistance} onChangeText={setEditedDistance} accessibilityLabel="Correct lifetime mileage"/>
      <Pressable style={styles.outline} accessibilityRole="button" onPress={()=>{
       try{if(editedDistance.trim()==='')throw new Error('Enter mileage.');
        update(s=>changeGearDistance(s,item.id,Number(editedDistance)*MI_TO_KM));setEditing(null);
       }catch(e){setError(e instanceof Error?e.message:'Invalid mileage.')}
      }}><Text style={styles.gold}>Apply mileage correction</Text></Pressable>
    </View>:<Pressable style={styles.outline} accessibilityRole="button" onPress={()=>{setEditing(item.id);setEditedDistance(String(miles(item.distanceKm)))}}>
       <Text style={styles.gold}>Correct Mileage</Text></Pressable>}
    <Pressable style={styles.outline} disabled={saving} accessibilityRole="button" onPress={()=>Alert.alert(
      item.status==='active'?'Retire gear?':'Restore gear?',
      'Retiring preserves the gear and its mileage, but removes it from activity defaults.',
      [{text:'Cancel',style:'cancel'},{text:item.status==='active'?'Retire':'Restore',onPress:()=>update(s=>changeGearStatus(s,item.id,item.status==='active'?'retired':'active'))}]
    )}><Text style={styles.gold}>{item.status==='active'?'Mark Retired':'Restore to Active'}</Text></Pressable>
   </View>)}
   <View style={styles.card}>
    <Text style={styles.heading}>Add {section==='shoes'?'Shoes':section==='bikes'?'Bike':'Gear'}</Text>
    <Text style={styles.helper}>Name / Model</Text>
    <TextInput style={styles.input} accessibilityLabel="New gear name or model" placeholder="Name or model"
     placeholderTextColor={colors.mutedText} value={name} onChangeText={setName} editable={!saving} maxLength={100}/>
    {section!=='other'?<>
     <Text style={styles.helper}>Used for</Text>
     <View style={styles.tabs}>
      {(section==='shoes'?['road','trail','mixed']:['outdoor','indoor']).map(option=><Pressable key={option} style={[styles.tab,use===option&&styles.active]}
       accessibilityRole="radio" accessibilityState={{checked:use===option}} onPress={()=>setUse(option as ShoeUse|BikeUse)}>
       <Text style={use===option?styles.selectedText:styles.labelText}>{option==='mixed'?'Both':option}</Text></Pressable>)}
     </View></>:null}
    <Text style={styles.helper}>Starting mileage (mi)</Text>
    <TextInput style={styles.input} keyboardType="decimal-pad" accessibilityLabel="Starting mileage in miles" value={distance} onChangeText={setDistance}/>
    {section==='shoes'?<>
      {suggested?<Text style={styles.helper}>Verified guidance found: {miRange(suggested)} · {suggested.sourceName}. The alert will default to {Math.round(miles(suggested.recommendedAlertKm))} mi unless you set a different target.</Text>
       :name.trim()?<Text style={styles.helper}>No manufacturer recommendation verified for this model yet. You can set your own alert mileage.</Text>:null}
      <Text style={styles.helper}>Mileage alert target (mi, optional)</Text>
      <TextInput style={styles.input} keyboardType="decimal-pad" accessibilityLabel="Mileage reminder threshold" placeholder="e.g. 500"
       placeholderTextColor={colors.mutedText} value={threshold} onChangeText={setThreshold}/></>:null}
    <Pressable accessibilityRole="button" disabled={saving} style={styles.outline} onPress={create}><Text style={styles.gold}>＋ Add {section==='shoes'?'Shoes':section==='bikes'?'Bike':'Gear'}</Text></Pressable>
   </View>
   <Pressable accessibilityRole="button" accessibilityState={{busy:saving,disabled:saving}} disabled={saving} style={styles.save} onPress={()=>void save()}>
    <Text style={styles.saveText}>{saving?'Saving…':'Save Personal Gear'}</Text>
   </Pressable>
   {notice?<Text style={styles.gold}>{notice}</Text>:null}
  </>:null}
  <View style={styles.card}><Text style={styles.heading}>Coach & Gear</Text>
   <Text style={styles.helper}>Coach should use your saved activity defaults, terrain, weather, and gear availability once the integration is connected. It does not access this inventory yet.</Text>
   <Text style={styles.gold}>Coach connection coming</Text>
  </View>
 </View>;
}
const styles=StyleSheet.create({
 wrap:{gap:14},heading:{fontSize:18,color:colors.warmWhite,fontWeight:'800'},
 helper:{fontSize:13,lineHeight:20,color:colors.mutedText},gold:{color:colors.goldSoft,fontWeight:'700'},
 tabs:{flexDirection:'row',gap:6},tab:{flex:1,minHeight:44,borderWidth:1,borderColor:colors.border,borderRadius:10,justifyContent:'center',alignItems:'center',padding:7},
 active:{backgroundColor:colors.gold,borderColor:colors.gold},selectedText:{color:colors.background,fontWeight:'800',textTransform:'capitalize',fontSize:12},
 labelText:{color:colors.warmWhite,fontWeight:'700',textTransform:'capitalize',fontSize:12},
 card:{borderWidth:1,borderColor:colors.border,borderRadius:16,padding:15,gap:10,backgroundColor:colors.surface},
 metric:{fontSize:23,color:colors.warmWhite,fontWeight:'800'},
 input:{borderWidth:1,borderColor:colors.border,borderRadius:12,backgroundColor:colors.surfaceRaised,color:colors.warmWhite,minHeight:48,padding:12},
 outline:{borderWidth:1,borderColor:colors.border,borderRadius:10,minHeight:44,padding:10,justifyContent:'center'},
 save:{minHeight:48,backgroundColor:colors.gold,borderRadius:12,justifyContent:'center',alignItems:'center'},
 saveText:{color:colors.background,fontWeight:'800'},error:{color:colors.danger,fontSize:13},
});
