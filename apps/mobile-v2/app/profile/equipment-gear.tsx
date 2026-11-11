import { useCallback, useRef, useState } from 'react';
import { Link, Redirect, useFocusEffect } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../src/auth/AuthProvider';
import { useAccessGate } from '../../src/auth/AccessGateProvider';
import { assertV2SessionOwner,readV2OwnedProfileState } from '../../src/auth/accessGateClient';
import { v2AuthenticatedScreenKey } from '../../src/auth/authRoute';
import { supabase } from '../../src/lib/supabase';
import { colors } from '../../src/theme/tokens';
import {emptyEquipmentInventory,parseEquipmentInventory,addTrainingLocation,removeTrainingLocation,
 addEquipment,removeEquipment,equipmentInventoryPatch,type EquipmentInventory} from '../../src/features/training/equipmentInventory';

export default function EquipmentGearScreen(){
 const {user,sessionGeneration}=useAuth();
 return <OwnedEquipmentGear key={v2AuthenticatedScreenKey(user?.id??null,sessionGeneration)}/>;
}
function OwnedEquipmentGear(){
 const {user,loading:authLoading}=useAuth(),gate=useAccessGate(),owner=user?.id??null;
 const [tab,setTab]=useState<'locations'|'gear'>('locations');
 const [draft,setDraft]=useState<EquipmentInventory>(emptyEquipmentInventory);
 const [version,setVersion]=useState<number|null>(null);
 const [loading,setLoading]=useState(true),[saving,setSaving]=useState(false);
 const [error,setError]=useState<string|null>(null),[notice,setNotice]=useState<string|null>(null);
 const [locationName,setLocationName]=useState('');
 const [selected,setSelected]=useState<string|null>(null);
 const [itemName,setItemName]=useState(''),[quantity,setQuantity]=useState('1'),[weight,setWeight]=useState('');
 const [retry,setRetry]=useState(0);
 const busy=useRef(false),mounted=useRef(false);
 const pending=useRef<{version:number;payload:string;id:string}|null>(null);
 const ids=useRef(0);

 const refresh=useCallback(async(isCurrent:()=>boolean)=>{
  if(!owner)throw new Error('Sign in to manage equipment.');
  const result=await readV2OwnedProfileState(supabase,owner,isCurrent);
  const snapshot=result.settings as {version?:number;settings?:unknown}|null;
  if(!Number.isSafeInteger(snapshot?.version)||!snapshot?.version||snapshot.version<1)
   throw new Error('Equipment settings version unavailable.');
  if(!isCurrent())return;
  const inventory=parseEquipmentInventory(snapshot.settings);
  setDraft(inventory);setVersion(snapshot.version);
  setSelected(current=>inventory.locations.some(x=>x.id===current)?current:null);
 },[owner]);
 useFocusEffect(useCallback(()=>{
  if(!owner||authLoading||gate.status!=='ready')return;
  let active=true;mounted.current=true;setLoading(true);setVersion(null);setError(null);setNotice(null);pending.current=null;
  void refresh(()=>active&&mounted.current).catch(e=>{if(active&&mounted.current)setError(e instanceof Error?e.message:'Could not load equipment.');})
   .finally(()=>{if(active&&mounted.current)setLoading(false)});
  return()=>{active=false;mounted.current=false};
 },[owner,authLoading,gate.status,refresh,retry]));
 function edit(fn:(old:EquipmentInventory)=>EquipmentInventory){
  if(busy.current||loading)return;
  try{setDraft(fn(draft));setError(null);setNotice(null);pending.current=null}
  catch(e){setError(e instanceof Error?e.message:'Could not change equipment.')}
 }
 function newId(){return [owner,'equipment',Date.now().toString(36),(++ids.current).toString(36),Math.random().toString(36).slice(2,8)].join(':')}
 function createLocation(){
  try{
   const id=newId(),next=addTrainingLocation(draft,locationName,id);
   edit(()=>next);setLocationName('');setSelected(id);
  }catch(e){setError(e instanceof Error?e.message:'Could not add location.')}
 }
 function createItem(){
  try{
   const count=Number(quantity);
   const kg=weight.trim()===''?null:Number(weight);
   if(!Number.isSafeInteger(count)||count<1||count>99||kg!==null&&(!Number.isFinite(kg)||kg<=0))
    throw new Error('Enter a valid quantity and optional weight in kilograms.');
   const next=addEquipment(draft,selected??'',{id:newId(),name:itemName,quantity:count,weightKg:kg});
   edit(()=>next);setItemName('');setQuantity('1');setWeight('');
  }catch(e){setError(e instanceof Error?e.message:'Could not add equipment.')}
 }
 async function save(){
  if(!owner||version===null||loading||busy.current)return;
  busy.current=true;setSaving(true);setError(null);setNotice(null);
  try{
   const payload=equipmentInventoryPatch(draft),serialized=JSON.stringify(payload);
   const prev=pending.current;
   const id=prev?.version===version&&prev.payload===serialized?prev.id:newId();
   pending.current={version,payload:serialized,id};
   await assertV2SessionOwner(supabase,owner);
   const {data,error:writeError}=await supabase.rpc('v2_patch_profile_settings_section',{
    p_expected_user_id:owner,p_section:'training_preferences',p_patch:payload,
    p_expected_version:version,p_client_action_id:id,
   });
   if(writeError){
    if(writeError.code==='40001'){pending.current=null;await refresh(()=>mounted.current)}
    throw writeError;
   }
   await assertV2SessionOwner(supabase,owner);
   if(typeof data!=='number'||!Number.isSafeInteger(data)||data<1)throw new Error('Equipment save not verified.');
   await refresh(()=>mounted.current);pending.current=null;
   if(mounted.current)setNotice('Training locations and equipment saved.');
  }catch(e){if(mounted.current)setError(e instanceof Error?e.message:'Could not save equipment.')}
  finally{busy.current=false;if(mounted.current)setSaving(false)}
 }
 if(!authLoading&&!user)return <Redirect href="/sign-in"/>;
 if(gate.status==='legal_required')return <Redirect href="/legal-acceptance"/>;
 if(gate.status==='onboarding_required')return <Redirect href="/onboarding-required"/>;
 if(authLoading||gate.status!=='ready'||!owner)return <Redirect href="/"/>;
 const location=draft.locations.find(x=>x.id===selected);
 return <SafeAreaView style={styles.safe}><ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
  <Link href="/profile" asChild><Pressable accessibilityRole="button" style={styles.back}><Text style={styles.gold}>‹ Profile</Text></Pressable></Link>
  <Text accessibilityRole="header" style={styles.title}>Equipment & Gear</Text>
  <Text style={styles.helper}>Manage where you train and what equipment you actually have. Coach and Training will use confirmed inventory when those integrations are ready.</Text>
  <View style={styles.tabs}>
   <Pressable accessibilityRole="tab" accessibilityState={{selected:tab==='locations'}} style={[styles.tab,tab==='locations'&&styles.active]} onPress={()=>setTab('locations')}><Text style={tab==='locations'?styles.activeText:styles.tabText}>Training Locations</Text></Pressable>
   <Pressable accessibilityRole="tab" accessibilityState={{selected:tab==='gear'}} style={[styles.tab,tab==='gear'&&styles.active]} onPress={()=>setTab('gear')}><Text style={tab==='gear'?styles.activeText:styles.tabText}>Personal Gear</Text></Pressable>
  </View>
  {loading?<ActivityIndicator color={colors.gold}/>:null}
  {error?<Text accessibilityRole="alert" style={styles.error}>{error}</Text>:null}
  {!loading&&version===null?<Pressable accessibilityRole="button" style={styles.action} onPress={()=>setRetry(x=>x+1)}><Text style={styles.gold}>Retry loading</Text></Pressable>:null}
  {!loading&&version!==null&&tab==='locations'?<>
   {draft.locations.map(loc=><View style={styles.card} key={loc.id}>
    <Pressable accessibilityRole="button" accessibilityState={{selected:selected===loc.id}} style={styles.cardHeading} onPress={()=>setSelected(x=>x===loc.id?null:loc.id)}>
     <Text style={styles.heading}>{loc.name}</Text><Text style={styles.gold}>{selected===loc.id?'Close':'Manage'}</Text>
    </Pressable>
    <Text style={styles.helper}>{loc.equipment.length?loc.equipment.length+' equipment entries':'No equipment added yet — bodyweight-only is valid.'}</Text>
    {loc.equipment.map(item=><View key={item.id} style={styles.item}><Text style={styles.itemText}>{item.name} · Qty {item.quantity}{item.weightKg!==null?' · '+item.weightKg+' kg':''}</Text>
     <Pressable accessibilityRole="button" accessibilityLabel={'Remove '+item.name} disabled={saving} onPress={()=>edit(s=>removeEquipment(s,loc.id,item.id))}><Text style={styles.gold}>Remove</Text></Pressable></View>)}
    {selected===loc.id?<><Text style={styles.label}>Add equipment to {loc.name}</Text>
     <TextInput accessibilityLabel="Equipment name" placeholder="Equipment name (e.g. Dumbbells)" placeholderTextColor={colors.mutedText} style={styles.input} value={itemName} onChangeText={setItemName} editable={!saving}/>
     <View style={styles.inline}>
      <View style={styles.flex}><Text style={styles.label}>Quantity</Text><TextInput accessibilityLabel="Equipment quantity" keyboardType="number-pad" style={styles.input} value={quantity} onChangeText={setQuantity} editable={!saving}/></View>
      <View style={styles.flex}><Text style={styles.label}>Weight (kg, optional)</Text><TextInput accessibilityLabel="Equipment weight in kilograms" keyboardType="decimal-pad" style={styles.input} value={weight} onChangeText={setWeight} placeholder="Unknown" placeholderTextColor={colors.mutedText} editable={!saving}/></View>
     </View>
     <Pressable accessibilityRole="button" style={styles.action} disabled={saving} onPress={createItem}><Text style={styles.gold}>＋ Add Equipment</Text></Pressable>
     <Pressable accessibilityRole="button" disabled={saving} onPress={()=>{edit(s=>removeTrainingLocation(s,loc.id));setSelected(null)}}><Text style={styles.danger}>Remove this location</Text></Pressable>
    </>:null}
   </View>)}
   <View style={styles.card}><Text style={styles.heading}>Add Training Location</Text>
    <TextInput accessibilityLabel="Training location name" placeholder="Home, Gym, or another place" placeholderTextColor={colors.mutedText} style={styles.input} value={locationName} onChangeText={setLocationName} editable={!saving}/>
    <Pressable accessibilityRole="button" style={styles.action} disabled={saving} onPress={createLocation}><Text style={styles.gold}>＋ Add Training Location</Text></Pressable></View>
   <View style={styles.card}><Text style={styles.heading}>Scan Your Equipment</Text>
    <Text style={styles.helper}>Photo and video recognition are future optional tools. Manual equipment management works without scanning.</Text></View>
   <Pressable accessibilityRole="button" disabled={saving} accessibilityState={{busy:saving,disabled:saving}} style={[styles.save,saving&&styles.dim]} onPress={()=>void save()}><Text style={styles.saveText}>{saving?'Saving…':'Save Equipment & Locations'}</Text></Pressable>
   {notice?<Text style={styles.gold}>{notice}</Text>:null}
  </>:null}
  {tab==='gear'?<View style={styles.card}><Text style={styles.heading}>Personal Gear</Text>
   <Text style={styles.helper}>Running shoes, bikes and sport-specific gear will live here, separate from location-based gym equipment. Mileage and workout selection are not connected yet.</Text>
   <Text style={styles.label}>Running Shoes · Coming next</Text>
   <Text style={styles.label}>Bikes · Coming next</Text>
   <Text style={styles.label}>Other Gear · Coming next</Text>
  </View>:null}
 </ScrollView></SafeAreaView>;
}
const styles=StyleSheet.create({
 safe:{flex:1,backgroundColor:colors.background},content:{padding:24,paddingBottom:48,gap:16},back:{minHeight:44,justifyContent:'center'},
 gold:{color:colors.goldSoft,fontWeight:'700'},title:{fontSize:28,fontWeight:'800',color:colors.warmWhite},
 helper:{color:colors.mutedText,fontSize:13,lineHeight:20},heading:{color:colors.warmWhite,fontSize:18,fontWeight:'800'},
 card:{borderColor:colors.border,borderWidth:1,borderRadius:16,backgroundColor:colors.surface,padding:16,gap:12},
 cardHeading:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',minHeight:44,gap:12},
 tabs:{flexDirection:'row',gap:8},tab:{flex:1,borderRadius:12,borderWidth:1,borderColor:colors.border,padding:11,minHeight:48,justifyContent:'center',alignItems:'center'},
 active:{backgroundColor:colors.gold,borderColor:colors.gold},activeText:{color:colors.background,fontWeight:'800',fontSize:12},tabText:{color:colors.warmWhite,fontSize:12,fontWeight:'800'},
 item:{flexDirection:'row',gap:10,justifyContent:'space-between',alignItems:'center',paddingVertical:7},
 itemText:{color:colors.warmWhite,fontSize:13,flex:1},label:{fontSize:12,color:colors.mutedText,fontWeight:'700'},
 input:{minHeight:48,color:colors.warmWhite,backgroundColor:colors.surfaceRaised,borderWidth:1,borderRadius:12,borderColor:colors.border,padding:12},
 inline:{flexDirection:'row',gap:9},flex:{flex:1},action:{minHeight:44,justifyContent:'center',borderColor:colors.border,borderWidth:1,borderRadius:12,paddingHorizontal:12},
 save:{minHeight:48,backgroundColor:colors.gold,borderRadius:12,alignItems:'center',justifyContent:'center'},
 saveText:{color:colors.background,fontWeight:'800'},dim:{opacity:0.5},danger:{color:colors.danger,fontWeight:'700'},
 error:{color:colors.danger,fontSize:13},
});
