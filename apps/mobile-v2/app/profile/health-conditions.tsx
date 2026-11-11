import { useRef, useState } from 'react';
import { Link, Redirect } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../src/auth/AuthProvider';
import { useAccessGate } from '../../src/auth/AccessGateProvider';
import { v2AuthenticatedScreenKey } from '../../src/auth/authRoute';
import { colors } from '../../src/theme/tokens';
import {
  EMPTY_HEALTH_DRAFT, addHealthFact, removeHealthFact,
  type HealthDraft,
} from '../../src/features/profile/healthConditions';

export default function HealthConditionsScreen(){
  const {user,sessionGeneration}=useAuth();
  return <OwnedHealthConditions key={v2AuthenticatedScreenKey(user?.id??null,sessionGeneration)}/>;
}

function OwnedHealthConditions(){
  const {user,loading:authLoading}=useAuth();
  const gate=useAccessGate();
  const [draft,setDraft]=useState<HealthDraft>(EMPTY_HEALTH_DRAFT);
  const [conditionInput,setConditionInput]=useState('');
  const [limitationInput,setLimitationInput]=useState('');
  const [error,setError]=useState<string|null>(null);
  const nextId=useRef(0);

  function add(section:keyof HealthDraft){
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
      <View style={styles.card}>
        <Text style={styles.heading}>Conditions Coach Should Know About</Text>
        <Text style={styles.helper}>Add a condition that may affect your activity or nutrition. You decide what to share.</Text>
        <TextInput accessibilityLabel="Condition" style={styles.input} placeholder="Search or enter a condition..."
          placeholderTextColor={colors.mutedText} value={conditionInput} onChangeText={setConditionInput} maxLength={180}/>
        <Pressable accessibilityRole="button" onPress={()=>add('conditions')} style={styles.add}>
          <Text style={styles.gold}>＋ Add condition</Text>
        </Pressable>
        {draft.conditions.map(fact=><View key={fact.id} style={styles.fact}>
          <Text style={styles.factText}>{fact.text}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={`Remove condition ${fact.text}`}
            onPress={()=>setDraft(old=>removeHealthFact(old,'conditions',fact.id))} style={styles.remove}>
            <Text style={styles.gold}>Remove</Text>
          </Pressable>
        </View>)}
      </View>
      <View style={styles.card}>
        <Text style={styles.heading}>Injuries & Physical Limitations</Text>
        <Text style={styles.helper}>Anything Coach should consider when planning workouts or recovery?</Text>
        <TextInput accessibilityLabel="Injury or physical limitation" style={[styles.input,styles.multiline]}
          multiline textAlignVertical="top" placeholder="Describe an injury or limitation..."
          placeholderTextColor={colors.mutedText} value={limitationInput} onChangeText={setLimitationInput} maxLength={180}/>
        <Pressable accessibilityRole="button" onPress={()=>add('limitations')} style={styles.add}>
          <Text style={styles.gold}>＋ Add limitation</Text>
        </Pressable>
        {draft.limitations.map(fact=><View key={fact.id} style={styles.fact}>
          <Text style={styles.factText}>{fact.text}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={`Remove limitation ${fact.text}`}
            onPress={()=>setDraft(old=>removeHealthFact(old,'limitations',fact.id))} style={styles.remove}>
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
        <Text style={styles.note}>Coach access to health information is not connected in V2 yet.</Text>
      </View>
      <View style={styles.coachCard}>
        <Text style={styles.heading}>Need to explain something?</Text>
        <Text style={styles.helper}>You can tell Coach about more complicated health considerations once Coach conversations are connected.</Text>
        <Text style={styles.gold}>Talk to Coach · Connection coming</Text>
      </View>
      <View style={styles.saveDisabled} accessibilityState={{disabled:true}} accessible accessibilityLabel="Save Health Information unavailable until secure storage is connected">
        <Text style={styles.saveText}>Save Health Information</Text>
      </View>
      <Text style={styles.warning}>Secure health-information storage is not connected yet. Entries on this screen are temporary and will be lost when you leave. Do not rely on them for Coach guidance.</Text>
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
  saveDisabled:{borderRadius:13,backgroundColor:colors.border,minHeight:48,justifyContent:'center',alignItems:'center',opacity:.65},
  saveText:{color:colors.warmWhite,fontWeight:'800'},
  warning:{color:colors.goldSoft,fontSize:12,lineHeight:19},
  footer:{color:colors.mutedText,fontSize:12,lineHeight:18},
  error:{color:colors.danger,fontSize:13},
});
