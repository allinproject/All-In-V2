import { useCallback, useRef, useState } from 'react';
import { Link, Redirect, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type LayoutChangeEvent } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../src/auth/AuthProvider';
import { useAccessGate } from '../../src/auth/AccessGateProvider';
import { assertV2SessionOwner, readV2OwnedProfileState } from '../../src/auth/accessGateClient';
import { v2AuthenticatedScreenKey } from '../../src/auth/authRoute';
import {
  HOME_KITCHEN_GROUPS, WORK_REHEAT_ITEMS, emptyKitchen, parseKitchen,
  setEquipmentAvailability, setKitchenCount, setKitchenNotes, kitchenSettingsPatch,
  type Availability, type KitchenCount, type KitchenState,
} from '../../src/features/cookbook/kitchenPreferences';
import { supabase } from '../../src/lib/supabase';
import { colors } from '../../src/theme/tokens';
import { GuidedTourPanel } from '../../src/features/tutorials/GuidedTourPanel';
import { KITCHEN_GUIDE_STEPS, kitchenGuideTarget, type KitchenGuideTarget } from '../../src/features/tutorials/kitchenGuide';
import type { GuidePosition } from '../../src/features/tutorials/profileGuide';

type VersionedSettings = { version?: number; settings?: unknown };
const options: readonly { value: Availability; label: string }[] = [
  { value:'available',label:'Have it' },{ value:'unavailable',label:"Don't have" },{ value:'unknown',label:'Unknown' },
];
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function actionId(owner: string) {
  return ['kitchen',owner,Date.now().toString(36),Math.random().toString(36).slice(2,12)].join(':');
}

export default function KitchenRoute() {
  const { user, sessionGeneration } = useAuth();
  return <OwnedKitchen key={v2AuthenticatedScreenKey(user?.id ?? null,sessionGeneration)} />;
}

function OwnedKitchen() {
  const { user, loading: authLoading } = useAuth();
  const gate = useAccessGate();
  const router=useRouter();
  const {tutorial}=useLocalSearchParams<{tutorial?:string}>();
  const owner = user?.id ?? null;
  const [draft,setDraft] = useState<KitchenState>(emptyKitchen);
  const [expanded,setExpanded] = useState<string | null>('Cooking appliances');
  const [version,setVersion] = useState<number | null>(null);
  const [loading,setLoading] = useState(true);
  const [saving,setSaving] = useState(false);
  const [error,setError] = useState<string | null>(null);
  const [notice,setNotice] = useState<string | null>(null);
  const [reload,setReload] = useState(0);
  const guard = useRef(false);
  const scrollRef=useRef<React.ElementRef<typeof ScrollView>>(null);
  const anchors=useRef<Partial<Record<KitchenGuideTarget,number>>>({});
  const activeTarget=useRef<KitchenGuideTarget|null>(null);
  const [highlight,setHighlight]=useState<KitchenGuideTarget|null>(null);
  const scrollToTarget=useCallback(()=>{
    const target=activeTarget.current;
    if(target){const y=anchors.current[target];if(y!==undefined)scrollRef.current?.scrollTo({y:Math.max(0,y-16),animated:true});}
  },[]);
  const onGuidePosition=useCallback((position:GuidePosition)=>{
    const target=kitchenGuideTarget(position);
    activeTarget.current=target;setHighlight(target);scrollToTarget();
  },[scrollToTarget]);
  const onGuideLayout=useCallback((target:KitchenGuideTarget)=>(event:LayoutChangeEvent)=>{
    anchors.current[target]=event.nativeEvent.layout.y;
    if(activeTarget.current===target)scrollToTarget();
  },[scrollToTarget]);
  const pending = useRef<{version:number;serialized:string;id:string}|null>(null);

  const refresh = useCallback(async (current:()=>boolean,preserve:boolean) => {
    if (!owner) throw new Error('Sign in to manage your Kitchen.');
    const result = await readV2OwnedProfileState(supabase,owner,current);
    const settings = result.settings as VersionedSettings | null;
    const value = settings?.version;
    if (!Number.isSafeInteger(value) || !value || value < 1) throw new Error('Kitchen settings version is unavailable.');
    if (!current()) return;
    setVersion(value);
    if (!preserve) setDraft(parseKitchen(object(object(settings?.settings).nutrition_preferences).kitchen));
  },[owner]);

  useFocusEffect(useCallback(()=>{
    if (!owner || authLoading || gate.status !== 'ready') return;
    let active=true;
    setVersion(null);setLoading(true);setError(null);setNotice(null);pending.current=null;
    void refresh(()=>active,false)
      .catch(cause=>{if(active)setError(cause instanceof Error?cause.message:'Kitchen could not be loaded.');})
      .finally(()=>{if(active)setLoading(false);});
    return ()=>{active=false;};
  },[owner,authLoading,gate.status,refresh,reload]));

  function edit(fn:(previous:KitchenState)=>KitchenState) {
    if(guard.current)return;
    pending.current=null;
    setDraft(fn);setError(null);setNotice(null);
  }
  function setCount(key:KitchenCount,raw:string) {
    // Validate before scheduling a React state updater; exceptions inside updaters
    // are asynchronous and cannot be caught by an enclosing try/catch.
    if (raw.trim() !== '' && !/^\d{1,2}$/.test(raw.trim())) {
      setError('Enter a whole number between 0 and 99, or leave blank.');
      return;
    }
    edit(previous=>setKitchenCount(previous,key,raw));
  }
  async function save() {
    if(!owner||version===null||guard.current||loading)return;
    guard.current=true;setSaving(true);setError(null);setNotice(null);
    try {
      const patch=kitchenSettingsPatch(draft);
      const serialized=JSON.stringify(patch);
      const previous=pending.current;
      const id=previous?.version===version&&previous.serialized===serialized?previous.id:actionId(owner);
      pending.current={version,serialized,id};
      await assertV2SessionOwner(supabase,owner);
      const {data,error:writeError}=await supabase.rpc('v2_patch_profile_settings_section',{
        p_expected_user_id:owner,
        p_section:'nutrition_preferences',
        p_patch:patch,
        p_expected_version:version,
        p_client_action_id:id,
      });
      if(writeError){
        if(writeError.code==='40001'){
          pending.current=null;
          await refresh(()=>true,false);
        }
        throw writeError;
      }
      await assertV2SessionOwner(supabase,owner);
      if(!Number.isSafeInteger(data)||!data||data<1)throw new Error('Kitchen save could not be verified.');
      await refresh(()=>true,false);
      pending.current=null;
      setNotice('Kitchen profile saved.');
    }catch(cause){setError(cause instanceof Error?cause.message:'Kitchen could not be saved.');}
    finally{guard.current=false;setSaving(false);}
  }

  if(!authLoading&&!user)return <Redirect href="/sign-in"/>;
  if(gate.status==='legal_required')return <Redirect href="/legal-acceptance"/>;
  if(gate.status==='onboarding_required')return <Redirect href="/onboarding-required"/>;
  if(authLoading||gate.status!=='ready'||!owner)return <Redirect href="/"/>;

  return <SafeAreaView style={styles.safe}>
    {tutorial==='kitchen' && !loading && version!==null ? <GuidedTourPanel key={owner} title="Kitchen guide"
      steps={KITCHEN_GUIDE_STEPS} onExit={()=>router.replace('/profile/tutorials')} onPositionChange={onGuidePosition} /> : null}
    <ScrollView ref={scrollRef} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Link href="/profile" asChild><Pressable accessibilityRole="button" style={styles.back}><Text style={styles.gold}>‹ Profile</Text></Pressable></Link>
      <Text accessibilityRole="header" style={styles.title}>Kitchen</Text>
      <Text style={styles.helper}>Tell Coach what equipment you have. Unknown means we have not confirmed it, not that you don't own it.</Text>
      {loading?<ActivityIndicator color={colors.gold} accessibilityLabel="Loading kitchen profile"/>:null}
      {error?<Text accessibilityRole="alert" style={styles.error}>{error}</Text>:null}
      {!loading&&version===null?<Pressable accessibilityRole="button" style={styles.save} onPress={()=>setReload(n=>n+1)}><Text style={styles.saveText}>Retry loading</Text></Pressable>:null}
      {!loading&&version!==null?<>
        <View onLayout={onGuideLayout('home')} style={[styles.card,highlight==='home'&&styles.guideTarget]}>
          <Text style={styles.heading}>Home Kitchen</Text>
          <Text style={styles.helper}>Appliances, equipment and cookware available where you cook.</Text>
          {HOME_KITCHEN_GROUPS.map(group=><View key={group.title} style={styles.group}>
            <Pressable accessibilityRole="button" accessibilityState={{expanded:expanded===group.title}}
              onPress={()=>setExpanded(previous=>previous===group.title?null:group.title)}
              style={styles.groupHeader}>
              <Text style={styles.groupName}>{group.title}</Text>
              <Text style={styles.gold}>{expanded===group.title?'−':'+'}</Text>
            </Pressable>
            {expanded===group.title?group.items.map(([id,label])=><AvailabilityRow key={id} label={label}
              value={draft.home[id]??'unknown'} disabled={saving}
              onChange={next=>edit(old=>setEquipmentAvailability(old,'home',id,next))}/>):null}
          </View>)}
        </View>
        <View onLayout={onGuideLayout('work')} style={[styles.card,highlight==='work'&&styles.guideTarget]}>
          <Text style={styles.heading}>Work Reheating</Text>
          <Text style={styles.helper}>Work equipment is separate so reheating plans never assume your home appliances are available.</Text>
          {WORK_REHEAT_ITEMS.map(([id,label])=><AvailabilityRow key={id} label={label}
            value={draft.work[id]??'unknown'} disabled={saving}
            onChange={next=>edit(old=>setEquipmentAvailability(old,'work',id,next))}/>)}
        </View>
        <View onLayout={onGuideLayout('constraints')} style={[styles.card,highlight==='constraints'&&styles.guideTarget]}>
          <Text style={styles.heading}>Kitchen Constraints</Text>
          <Text style={styles.helper}>Optional counts help Coach plan feasible meal prep. Leave blank if unknown.</Text>
          <View style={styles.countGrid}>
            {([
              ['burner_count','Burners'],['skillet_count','Skillets'],['container_count','Containers'],
            ] as const).map(([key,label])=><View key={key} style={styles.countCell}>
              <Text style={styles.label}>{label}</Text>
              <TextInput accessibilityLabel={label} keyboardType="number-pad" maxLength={2}
                style={styles.countInput} placeholder="Unknown" placeholderTextColor={colors.mutedText}
                editable={!saving} value={draft.constraints[key]===null?'':String(draft.constraints[key])}
                onChangeText={text=>setCount(key,text)}/>
            </View>)}
          </View>
          <Text style={styles.label}>Other kitchen constraints</Text>
          <TextInput accessibilityLabel="Other kitchen constraints" multiline maxLength={500}
            style={styles.notes} placeholder="For example: work lunches must be microwaveable"
            placeholderTextColor={colors.mutedText} editable={!saving}
            value={draft.constraints.notes??''} onChangeText={text=>edit(old=>setKitchenNotes(old,text))}/>
        </View>
        {notice?<Text style={styles.gold} accessibilityRole="text">{notice}</Text>:null}
        <Pressable onLayout={onGuideLayout('save')} accessibilityRole="button" accessibilityState={{disabled:saving,busy:saving}}
          disabled={saving} onPress={()=>void save()} style={[styles.save,saving&&styles.dim,highlight==='save'&&styles.guideTarget]}>
          <Text style={styles.saveText}>{saving?'Saving…':'Save Kitchen Profile'}</Text>
        </Pressable>
      </>:null}
    </ScrollView>
  </SafeAreaView>;
}

function AvailabilityRow({label,value,disabled,onChange}:{
  label:string;value:Availability;disabled:boolean;onChange:(next:Availability)=>void;
}) {
  return <View style={styles.equipment}>
    <Text style={styles.equipmentName}>{label}</Text>
    <View style={styles.choices}>{options.map(option=><Pressable key={option.value}
      accessibilityRole="button" accessibilityState={{selected:value===option.value,disabled}}
      disabled={disabled} onPress={()=>onChange(option.value)}
      style={[styles.choice,value===option.value&&styles.chosen]}>
      <Text style={[styles.choiceText,value===option.value&&styles.chosenText]}>{option.label}</Text>
    </Pressable>)}</View>
  </View>;
}

const styles=StyleSheet.create({
  safe:{flex:1,backgroundColor:colors.background},
  content:{padding:24,paddingBottom:48,gap:18},
  back:{minHeight:44,justifyContent:'center'},
  title:{color:colors.warmWhite,fontSize:30,fontWeight:'800'},
  helper:{color:colors.mutedText,fontSize:13,lineHeight:20},
  gold:{color:colors.goldSoft,fontWeight:'700'},
  error:{color:colors.danger,fontSize:14},
  card:{borderColor:colors.border,borderWidth:1,borderRadius:18,backgroundColor:colors.surface,padding:16,gap:13},
  guideTarget:{borderColor:colors.goldSoft,borderWidth:2},
  heading:{color:colors.warmWhite,fontSize:19,fontWeight:'800'},
  group:{borderColor:colors.border,borderBottomWidth:1,paddingBottom:8,gap:10},
  groupHeader:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',minHeight:44},
  groupName:{color:colors.warmWhite,fontWeight:'800',fontSize:15},
  equipment:{gap:7,paddingBottom:5},
  equipmentName:{color:colors.warmWhite,fontSize:14,fontWeight:'700'},
  choices:{flexDirection:'row',gap:5},
  choice:{flex:1,borderRadius:10,borderWidth:1,borderColor:colors.border,backgroundColor:colors.surfaceRaised,paddingVertical:10,paddingHorizontal:4,alignItems:'center',justifyContent:'center',minHeight:40},
  chosen:{borderColor:colors.gold,backgroundColor:colors.gold},
  choiceText:{color:colors.warmWhite,fontSize:11,fontWeight:'700'},
  chosenText:{color:colors.background},
  countGrid:{flexDirection:'row',gap:8},
  countCell:{flex:1,gap:6,minWidth:0},
  label:{color:colors.mutedText,fontSize:12,fontWeight:'700'},
  countInput:{borderColor:colors.border,borderWidth:1,borderRadius:10,backgroundColor:colors.surfaceRaised,color:colors.warmWhite,minHeight:44,paddingHorizontal:8,textAlign:'center',fontSize:13},
  notes:{minHeight:90,borderColor:colors.border,borderWidth:1,borderRadius:10,backgroundColor:colors.surfaceRaised,color:colors.warmWhite,padding:12,textAlignVertical:'top'},
  save:{minHeight:48,borderRadius:14,backgroundColor:colors.gold,alignItems:'center',justifyContent:'center'},
  saveText:{color:colors.background,fontWeight:'800'},
  dim:{opacity:0.6},
});
