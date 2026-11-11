import { useCallback, useRef, useState } from 'react';
import { Link, Redirect, useFocusEffect } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../src/auth/AuthProvider';
import { useAccessGate } from '../../src/auth/AccessGateProvider';
import { v2AuthenticatedScreenKey } from '../../src/auth/authRoute';
import { assertV2SessionOwner } from '../../src/auth/accessGateClient';
import { supabase } from '../../src/lib/supabase';
import { colors } from '../../src/theme/tokens';
import {
  EMPTY_HEALTH_DRAFT, addHealthFact, removeHealthFact, parseSavedHealthConsiderations, healthConsiderationsPayload,
  type HealthDraft,
} from '../../src/features/profile/healthConditions';

export default function HealthConditionsScreen(){
  const {user,sessionGeneration}=useAuth();
  return <OwnedHealthConditions key={v2AuthenticatedScreenKey(user?.id??null,sessionGeneration)}/>;
}

function OwnedHealthConditions(){
  const {user,loading:authLoading}=useAuth();
  const gate=useAccessGate();
  const owner=user?.id??null;
  const [draft,setDraft]=useState<HealthDraft>(EMPTY_HEALTH_DRAFT);
  const [conditionInput,setConditionInput]=useState('');
  const [limitationInput,setLimitationInput]=useState('');
  const [error,setError]=useState<string|null>(null);
  const nextId=useRef(0);
  const [version,setVersion]=useState<number|null>(null);
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [notice,setNotice]=useState<string|null>(null);
  const [coachOptIn,setCoachOptIn]=useState(false);
  const [retry,setRetry]=useState(0);
  const mounted=useRef(false);
  const busy=useRef(false);

  const refresh=useCallback(async(isCurrent:()=>boolean)=>{
    if(!owner)throw new Error('Sign in to view health information.');
    await assertV2SessionOwner(supabase,owner);
    const {data,error:readError}=await supabase.rpc('v2_my_health_considerations',{p_expected_user_id:owner});
    if(readError)throw readError;
    await assertV2SessionOwner(supabase,owner);
    if(!isCurrent())return;
    const saved=parseSavedHealthConsiderations(data);
    setDraft(saved.draft);
    setVersion(saved.version);
    setCoachOptIn(saved.coachOptIn);
  },[owner]);

  useFocusEffect(useCallback(()=>{
    if(!owner||authLoading||gate.status!=='ready')return;
    let active=true;
    mounted.current=true;
    setLoading(true);setVersion(null);setError(null);setNotice(null);
    void refresh(()=>active&&mounted.current).catch(cause=>{
      if(active&&mounted.current)setError(cause instanceof Error?cause.message:'Could not load health information.');
    }).finally(()=>{if(active&&mounted.current)setLoading(false)});
    return()=>{active=false;mounted.current=false};
  },[owner,authLoading,gate.status,retry,refresh]));

  async function save(){
    if(!owner||version===null||loading||busy.current)return;
    busy.current=true;setSaving(true);setError(null);setNotice(null);
    try{
      const payload=healthConsiderationsPayload(draft);
      await assertV2SessionOwner(supabase,owner);
      const {data,error:writeError}=await supabase.rpc('v2_save_health_considerations',{
        p_expected_user_id:owner,p_conditions:payload.conditions,p_limitations:payload.limitations,
        p_coach_opt_in:coachOptIn,p_expected_version:version,
      });
      if(writeError){
        if(writeError.code==='40001')await refresh(()=>mounted.current);
        throw writeError;
      }
      if(typeof data!=='number'||!Number.isSafeInteger(data)||data<=0)
        throw new Error('Health save could not be verified.');
      await refresh(()=>mounted.current);
      if(mounted.current)setNotice('Health information saved privately.');
    }catch(cause){
      if(mounted.current)setError(cause instanceof Error?cause.message:'Could not save health information.');
    }finally{busy.current=false;if(mounted.current)setSaving(false)}
  }

  function add(section:keyof HealthDraft){
    if(loading||saving||version===null)return;
    try {
      const input=section==='conditions'?conditionInput:limitationInput;
      const id='health-draft-'+(++nextId.current);
      const next=addHealthFact(draft,section,input,id);
      setDraft(next);
      if(section==='conditions')setConditionInput('');else setLimitationInput('');
      setError(null);
    }catch(cause){
      setError(cause instanceof Error?cause.message:'Could not add entry.');
    }
  }
  if(!authLoading&&!user)return <Redirect href="/sign-in"/>;
  if(gate.status==='legal_required')return <Redirect href="/legal-acceptance"/>;
  if(gate.status==='onboarding_required')return <Redirect href="/onboarding-required"/>;
  if(authLoading||gate.status!=='ready'||!user)return <Redirect href="/"/>;

  return <SafeAreaView style={styles.safe}>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Link href="/profile" asChild>
        <Pressable accessibilityRole="button" style={styles.back}><Text style={styles.gold}>‹ Profile</Text></Pressable>
      </Link>
      <Text accessibilityRole="header" style={styles.title}>Health Conditions</Text>
      <Text style={styles.helper}>Help Coach tailor training, recovery, and nutrition recommendations to your needs. Everything here is optional.</Text>
      {loading?<ActivityIndicator accessibilityLabel="Loading health information" color={colors.gold}/>:null}
      {!loading&&version===null?<Pressable accessibilityRole="button" style={styles.add} onPress={()=>setRetry(x=>x+1)}><Text style={styles.gold}>Retry loading health information</Text></Pressable>:null}
      {!loading&&version!==null?<>
      <View style={styles.card}>
        <Text style={styles.heading}>Conditions Coach Should Know About</Text>
        <Text style={styles.helper}>Add a condition that may affect your activity or nutrition. You decide what to share.</Text>
        <TextInput accessibilityLabel="Condition" style={styles.input} placeholder="Search or enter a condition..."
          editable={!saving} placeholderTextColor={colors.mutedText} value={conditionInput} onChangeText={setConditionInput} maxLength={180}/>
        <Pressable accessibilityRole="button" disabled={saving} onPress={()=>add('conditions')} style={styles.add}>
          <Text style={styles.gold}>＋ Add condition</Text>
        </Pressable>
        {draft.conditions.map(fact=><View key={fact.id} style={styles.fact}>
          <Text style={styles.factText}>{fact.text}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={`Remove condition ${fact.text}`}
            disabled={saving} onPress={()=>setDraft(old=>removeHealthFact(old,'conditions',fact.id))} style={styles.remove}>
            <Text style={styles.gold}>Remove</Text>
          </Pressable>
        </View>)}
      </View>
      <View style={styles.card}>
        <Text style={styles.heading}>Injuries & Physical Limitations</Text>
        <Text style={styles.helper}>Anything Coach should consider when planning workouts or recovery?</Text>
        <TextInput accessibilityLabel="Injury or physical limitation" style={[styles.input,styles.multiline]}
          multiline textAlignVertical="top" placeholder="Describe an injury or limitation..."
          editable={!saving} placeholderTextColor={colors.mutedText} value={limitationInput} onChangeText={setLimitationInput} maxLength={180}/>
        <Pressable accessibilityRole="button" disabled={saving} onPress={()=>add('limitations')} style={styles.add}>
          <Text style={styles.gold}>＋ Add limitation</Text>
        </Pressable>
        {draft.limitations.map(fact=><View key={fact.id} style={styles.fact}>
          <Text style={styles.factText}>{fact.text}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={`Remove limitation ${fact.text}`}
            disabled={saving} onPress={()=>setDraft(old=>removeHealthFact(old,'limitations',fact.id))} style={styles.remove}>
            <Text style={styles.gold}>Remove</Text>
          </Pressable>
        </View>)}
      </View>
      {error?<Text accessibilityRole="alert" style={styles.error}>{error}</Text>:null}
      <View style={styles.card}>
        <Text style={styles.heading}>How Coach Uses This</Text>
        <Text style={styles.helper}>• Consider relevant limitations when suggesting exercise, recovery, and nutrition</Text>
        <Text style={styles.helper}>• Ask for clarification when something is unclear</Text>
        <Text style={styles.helper}>• Require approval before changing an established plan</Text>
        <Text style={styles.note}>Coach access to health information is not connected in V2 yet. Only you can manage the saved information today.</Text>
      </View>
      <View style={styles.coachCard}>
        <Text style={styles.heading}>Need to explain something?</Text>
        <Text style={styles.helper}>You can tell Coach about more complicated health considerations once Coach conversations are connected.</Text>
        <Text style={styles.gold}>Talk to Coach · Connection coming</Text>
      </View>
      <Pressable accessibilityRole="checkbox" accessibilityState={{checked:coachOptIn,disabled:saving}}
        disabled={saving} style={styles.consent} onPress={()=>setCoachOptIn(x=>!x)}>
        <Text style={styles.factText}>{coachOptIn?'☑':'☐'} Allow Coach to use this information when its private-health integration is ready</Text>
      </Pressable>
      <Text style={styles.warning}>Coach access is currently OFF even if you opt in. Your choice is stored for future use; it does not activate Coach access now. You can revoke consent here.</Text>
      <Pressable accessibilityRole="button" disabled={saving} accessibilityState={{busy:saving,disabled:saving}}
        style={[styles.save,saving&&styles.dim]} onPress={()=>void save()}>
        <Text style={styles.saveText}>{saving?'Saving…':'Save Health Information'}</Text>
      </Pressable>
      {notice?<Text accessibilityRole="text" style={styles.gold}>{notice}</Text>:null}
      </>
      <Text style={styles.footer}>This is sensitive account information, not Community content. Coach offers fitness guidance, not medical diagnosis or treatment. Food allergies belong in Nutrition settings.</Text>
    </ScrollView>
  </SafeAreaView>;
}

const styles=StyleSheet.create({
  safe:{flex:1,backgroundColor:colors.background},
  content:{padding:24,paddingBottom:48,gap:17},
  back:{minHeight:44,justifyContent:'center'},
  gold:{color:colors.goldSoft,fontWeight:'700'},
  title:{color:colors.warmWhite,fontSize:29,fontWeight:'800'},
  helper:{color:colors.mutedText,fontSize:13,lineHeight:20},
  heading:{color:colors.warmWhite,fontSize:18,fontWeight:'800'},
  card:{borderRadius:16,borderWidth:1,borderColor:colors.border,backgroundColor:colors.surface,padding:16,gap:12},
  coachCard:{borderRadius:16,borderWidth:1,borderColor:'#38332A',backgroundColor:colors.surface,padding:16,gap:12},
  input:{minHeight:48,borderWidth:1,borderColor:colors.border,borderRadius:12,padding:12,color:colors.warmWhite,backgroundColor:colors.surfaceRaised},
  multiline:{minHeight:90},
  add:{minHeight:44,justifyContent:'center',alignSelf:'flex-start',paddingHorizontal:4},
  fact:{borderWidth:1,borderColor:colors.border,borderRadius:12,padding:10,flexDirection:'row',alignItems:'center',gap:10},
  factText:{color:colors.warmWhite,flex:1,fontSize:13},
  remove:{minHeight:44,justifyContent:'center',paddingHorizontal:6},
  note:{color:colors.goldSoft,fontSize:12,lineHeight:18},
  save:{borderRadius:13,backgroundColor:colors.gold,minHeight:48,justifyContent:'center',alignItems:'center'},
  saveText:{color:colors.background,fontWeight:'800'},
  dim:{opacity:.5},
  consent:{borderWidth:1,borderColor:colors.border,borderRadius:12,padding:12,minHeight:48,justifyContent:'center'},
  warning:{color:colors.goldSoft,fontSize:12,lineHeight:19},
  footer:{color:colors.mutedText,fontSize:12,lineHeight:18},
  error:{color:colors.danger,fontSize:13},
});
