import { useCallback, useRef, useState } from 'react';
import { Link, Redirect, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../src/auth/AuthProvider';
import { useAccessGate } from '../../src/auth/AccessGateProvider';
import { assertV2SessionOwner, readV2OwnedProfileState } from '../../src/auth/accessGateClient';
import { v2AuthenticatedScreenKey } from '../../src/auth/authRoute';
import {
  GUIDANCE_OPTIONS, DETAIL_OPTIONS, PLAN_CHANGE_OPTIONS, TONE_OPTIONS,
  EMPTY_COACH_PREFERENCES, coachPreferencesPatch, parseCoachPreferences,
  type CoachPreferences,
} from '../../src/features/coach/coachPreferences';
import { supabase } from '../../src/lib/supabase';
import { colors } from '../../src/theme/tokens';
import { GuidedTourPanel } from '../../src/features/tutorials/GuidedTourPanel';
import { COACH_PREFERENCES_GUIDE_STEPS, coachPreferencesGuideTarget, type CoachPreferencesGuideTarget } from '../../src/features/tutorials/coachPreferencesGuide';
import type { GuidePosition } from '../../src/features/tutorials/profileGuide';

type SettingsSnapshot = { version?: number; settings?: unknown };
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}
function actionId(owner: string): string {
  return ['coach-preferences', owner, Date.now().toString(36), Math.random().toString(36).slice(2, 12)].join(':');
}

export default function CoachPreferencesRoute() {
  const { user, sessionGeneration } = useAuth();
  return <OwnedCoachPreferences key={v2AuthenticatedScreenKey(user?.id ?? null,sessionGeneration)} />;
}

function OwnedCoachPreferences() {
  const { user, loading: authLoading } = useAuth();
  const gate = useAccessGate();
  const router=useRouter();
  const {tutorial}=useLocalSearchParams<{tutorial?:string}>();
  const owner = user?.id ?? null;
  const [draft,setDraft] = useState<CoachPreferences>({ ...EMPTY_COACH_PREFERENCES });
  const [version,setVersion] = useState<number|null>(null);
  const [loading,setLoading] = useState(true);
  const [saving,setSaving] = useState(false);
  const [error,setError] = useState<string|null>(null);
  const [notice,setNotice] = useState<string|null>(null);
  const [reload,setReload] = useState(0);
  const busy=useRef(false);
  const scrollRef=useRef<ScrollView>(null);
  const anchors=useRef<Partial<Record<CoachPreferencesGuideTarget,number>>>({});
  const activeTarget=useRef<CoachPreferencesGuideTarget|null>(null);
  const [highlight,setHighlight]=useState<CoachPreferencesGuideTarget|null>(null);
  const scrollToTarget=useCallback(()=>{
    const target=activeTarget.current;
    if(target){const y=anchors.current[target];if(y!==undefined)scrollRef.current?.scrollTo({y:Math.max(0,y-16),animated:true});}
  },[]);
  const onGuidePosition=useCallback((position:GuidePosition)=>{
    activeTarget.current=coachPreferencesGuideTarget(position);
    setHighlight(activeTarget.current);scrollToTarget();
  },[scrollToTarget]);
  const onGuideLayout=useCallback((target:CoachPreferencesGuideTarget)=>(event:LayoutChangeEvent)=>{
    anchors.current[target]=event.nativeEvent.layout.y;
    if(activeTarget.current===target)scrollToTarget();
  },[scrollToTarget]);
  const pending=useRef<{version:number;patch:string;id:string}|null>(null);

  const refresh=useCallback(async (isCurrent:()=>boolean, preserveDraft:boolean)=>{
    if(!owner)throw new Error('Sign in to edit Coach preferences.');
    const raw=await readV2OwnedProfileState(supabase,owner,isCurrent);
    const settings=raw.settings as SettingsSnapshot|null;
    const nextVersion=settings?.version;
    if(!Number.isSafeInteger(nextVersion)||!nextVersion||nextVersion<1)throw new Error('Coach settings version is unavailable.');
    if(!isCurrent())return;
    setVersion(nextVersion);
    if(!preserveDraft)setDraft(parseCoachPreferences(record(settings?.settings).coach_preferences));
  },[owner]);

  useFocusEffect(useCallback(()=>{
    if(!owner||authLoading||gate.status!=='ready')return;
    let active=true;
    setVersion(null);setLoading(true);setError(null);setNotice(null);pending.current=null;
    void refresh(()=>active,false)
      .catch(reason=>{if(active)setError(reason instanceof Error?reason.message:'Could not load Coach preferences.');})
      .finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[owner,authLoading,gate.status,refresh,reload]));

  function edit<K extends keyof CoachPreferences>(key:K,value:CoachPreferences[K]){
    if(busy.current)return;
    pending.current=null;
    setDraft(current=>({...current,[key]:value}));
    setError(null);setNotice(null);
  }
  async function save(){
    if(!owner||version===null||loading||busy.current)return;
    busy.current=true;setSaving(true);setError(null);setNotice(null);
    try{
      const patch=coachPreferencesPatch(draft);
      const serialized=JSON.stringify(patch);
      const previous=pending.current;
      const id=previous?.version===version&&previous.patch===serialized?previous.id:actionId(owner);
      pending.current={version,patch:serialized,id};
      await assertV2SessionOwner(supabase,owner);
      const {data,error:writeError}=await supabase.rpc('v2_patch_profile_settings_section',{
        p_expected_user_id:owner,p_section:'coach_preferences',
        p_patch:patch,p_expected_version:version,p_client_action_id:id,
      });
      if(writeError){
        if(writeError.code==='40001'){
          pending.current=null;
          await refresh(()=>true,false);
        }
        throw writeError;
      }
      await assertV2SessionOwner(supabase,owner);
      if(!Number.isSafeInteger(data)||!data||data<1)throw new Error('Coach preferences save could not be verified.');
      await refresh(()=>true,false);
      pending.current=null;
      setNotice('Coach preferences saved.');
    }catch(reason){setError(reason instanceof Error?reason.message:'Coach preferences could not be saved.');}
    finally{busy.current=false;setSaving(false);}
  }
  if(!authLoading&&!user)return <Redirect href="/sign-in"/>;
  if(gate.status==='legal_required')return <Redirect href="/legal-acceptance"/>;
  if(gate.status==='onboarding_required')return <Redirect href="/onboarding-required"/>;
  if(authLoading||gate.status!=='ready'||!owner)return <Redirect href="/"/>;

  return <SafeAreaView style={styles.safe}>
    {tutorial==='coach-preferences' && !loading && version!==null ? <GuidedTourPanel key={owner} title="Coach Preferences guide"
      steps={COACH_PREFERENCES_GUIDE_STEPS} onExit={()=>router.replace('/profile/tutorials')} onPositionChange={onGuidePosition}/> : null}
    <ScrollView ref={scrollRef} contentContainerStyle={styles.content}>
      <Link href="/profile" asChild><Pressable accessibilityRole="button" style={styles.back}><Text style={styles.gold}>‹ Profile</Text></Pressable></Link>
      <Text accessibilityRole="header" style={styles.title}>Coach Preferences</Text>
      <Text style={styles.helper}>Choose how Coach communicates. Coaching safety and explicit approval for plan changes always remain in place.</Text>
      {loading?<ActivityIndicator color={colors.gold} accessibilityLabel="Loading Coach preferences"/>:null}
      {error?<Text accessibilityRole="alert" style={styles.error}>{error}</Text>:null}
      {!loading&&version===null?<Pressable accessibilityRole="button" style={styles.save} onPress={()=>setReload(n=>n+1)}><Text style={styles.saveText}>Retry loading</Text></Pressable>:null}
      {!loading&&version!==null?<>
        <ChoiceSection onLayout={onGuideLayout('guidance')} highlighted={highlight==='guidance'} title="Guidance Style" description="How often should Coach offer suggestions?" choices={GUIDANCE_OPTIONS}
          selected={draft.guidance_style} disabled={saving} onChoose={value=>edit('guidance_style',value)}/>
        <ChoiceSection onLayout={onGuideLayout('detail')} highlighted={highlight==='detail'} title="Explanation Detail" description="How much explanation would you like?" choices={DETAIL_OPTIONS}
          selected={draft.explanation_detail} disabled={saving} onChoose={value=>edit('explanation_detail',value)}/>
        <ChoiceSection onLayout={onGuideLayout('changes')} highlighted={highlight==='changes'} title="Training Plan Changes" description="Coach can propose changes, but never silently rewrites an accepted plan." choices={PLAN_CHANGE_OPTIONS}
          selected={draft.plan_change_mode} disabled={saving} onChoose={value=>edit('plan_change_mode',value)}/>
        <ChoiceSection onLayout={onGuideLayout('tone')} highlighted={highlight==='tone'} title="Coaching Tone" description="How should Coach communicate with you?" choices={TONE_OPTIONS}
          selected={draft.coaching_tone} disabled={saving} onChoose={value=>edit('coaching_tone',value)}/>
        <View style={styles.card}>
          <Text style={styles.heading}>What Coach Knows</Text>
          <Text style={styles.helper}>Review or correct learned knowledge in the dedicated Coach learning screen when available. Kitchen facts remain owned by Profile → Kitchen.</Text>
        </View>
        {notice?<Text style={styles.gold}>{notice}</Text>:null}
        <Pressable onLayout={onGuideLayout('save')} accessibilityRole="button" accessibilityState={{disabled:saving,busy:saving}} disabled={saving}
          style={[styles.save,saving&&styles.dim,highlight==='save'&&styles.guideTarget]} onPress={()=>void save()}>
          <Text style={styles.saveText}>{saving?'Saving…':'Save Coach Preferences'}</Text>
        </Pressable>
      </>:null}
    </ScrollView>
  </SafeAreaView>;
}

function ChoiceSection<T extends string>({title,description,choices,selected,disabled,onChoose,highlighted,onLayout}:{
  title:string;description:string;choices:readonly {value:T;label:string;description?:string}[];
  selected:T|null;disabled:boolean;onChoose:(value:T)=>void;highlighted:boolean;onLayout:(event:LayoutChangeEvent)=>void;
}){
  return <View onLayout={onLayout} style={[styles.card,highlighted&&styles.guideTarget]}>
    <Text style={styles.heading}>{title}</Text>
    <Text style={styles.helper}>{description}</Text>
    {choices.map(choice=><Pressable key={choice.value} accessibilityRole="radio"
      accessibilityState={{checked:selected===choice.value,disabled}} disabled={disabled}
      onPress={()=>onChoose(choice.value)} style={[styles.option,selected===choice.value&&styles.optionSelected]}>
      <View style={styles.optionCopy}>
        <Text style={[styles.optionLabel,selected===choice.value&&styles.optionLabelSelected]}>{choice.label}</Text>
        {choice.description?<Text style={[styles.helper,selected===choice.value&&styles.optionLabelSelected]}>{choice.description}</Text>:null}
      </View>
      <Text style={[styles.radio,selected===choice.value&&styles.optionLabelSelected]}>{selected===choice.value?'◉':'○'}</Text>
    </Pressable>)}
  </View>;
}

const styles=StyleSheet.create({
  safe:{flex:1,backgroundColor:colors.background},
  content:{padding:24,paddingBottom:48,gap:18},
  back:{minHeight:44,justifyContent:'center'},
  title:{color:colors.warmWhite,fontSize:29,fontWeight:'800'},
  helper:{color:colors.mutedText,fontSize:13,lineHeight:20},
  gold:{color:colors.goldSoft,fontWeight:'700'},
  error:{color:colors.danger,fontSize:14},
  card:{backgroundColor:colors.surface,borderColor:colors.border,borderWidth:1,borderRadius:18,padding:17,gap:12},
  guideTarget:{borderColor:colors.goldSoft,borderWidth:2},
  heading:{color:colors.warmWhite,fontSize:19,fontWeight:'800'},
  option:{borderColor:colors.border,borderWidth:1,backgroundColor:colors.surfaceRaised,borderRadius:12,minHeight:50,padding:12,flexDirection:'row',alignItems:'center',gap:12},
  optionSelected:{borderColor:colors.gold,backgroundColor:colors.gold},
  optionCopy:{flex:1,gap:3},
  optionLabel:{color:colors.warmWhite,fontWeight:'700'},
  optionLabelSelected:{color:colors.background},
  radio:{fontSize:22,color:colors.goldSoft},
  save:{minHeight:48,borderRadius:14,backgroundColor:colors.gold,alignItems:'center',justifyContent:'center'},
  saveText:{color:colors.background,fontWeight:'800'},
  dim:{opacity:0.6},
});
