import {useEffect,useState} from 'react';
import {Redirect,useLocalSearchParams} from 'expo-router';
import {Pressable,ScrollView,StyleSheet,Text,View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useAuth} from '../src/auth/AuthProvider';
import {v2AuthenticatedScreenKey} from '../src/auth/authRoute';
import {useAccessGate} from '../src/auth/AccessGateProvider';
import {FuelFoodLogPanel} from '../src/features/fuel/FuelFoodLogPanel';
import {KitchenWeekPlanPanel} from '../src/features/kitchen/KitchenWeekPlanPanel';
import {KitchenStockSummaryPanel} from '../src/features/kitchen/KitchenStockSummaryPanel';
import {V2BottomNavigation} from '../src/navigation/V2BottomNavigation';
import { V2WorkspaceHeader } from '../src/navigation/V2WorkspaceHeader';
import {deviceLocalToday} from '../src/features/today/todayEntry';
import {parseFuelDayContext} from '../src/features/today/todayFuelNavigation';
import {shiftCalendarDate} from '../src/features/training/calendarDayView';
import {colors} from '../src/theme/tokens';

type FuelSection='food-log'|'recipes'|'food-plan'|'daily';
type FoodPlanSection='plan'|'shopping'|'pantry';
const foodPlanSections:readonly {id:FoodPlanSection;label:string}[]=[
 {id:'plan',label:'Plan'},
 {id:'shopping',label:'Shopping'},
 {id:'pantry',label:'Pantry'},
];
const sections:readonly {id:FuelSection;label:string}[]=[
 {id:'food-log',label:'Food Log'},
 {id:'recipes',label:'Recipes'},
 {id:'food-plan',label:'Food Plan'},
];

export default function FuelScreen(){
 const {user,sessionGeneration}=useAuth();
 return <OwnedFuelScreen key={v2AuthenticatedScreenKey(user?.id??null,sessionGeneration)}/>;
}

/** One existing Fuel route, not a new root tab or second owner store. */
function OwnedFuelScreen(){
 const params=useLocalSearchParams<{date?:string;section?:string}>();
 const context=parseFuelDayContext(params.date, params.section);
 const {user,loading}=useAuth();
 const gate=useAccessGate();
 const [day,setDay]=useState(()=>context?.date??deviceLocalToday()??'');
 const [section,setSection]=useState<FuelSection>(()=>context?.section??'food-log');
 const [foodPlanSection,setFoodPlanSection]=useState<FoodPlanSection>('plan');
 useEffect(()=>{
  if(context?.date)setDay(context.date);
  if(context?.section)setSection(context.section);
 },[context?.date,context?.section]);
 if(!loading&&!user)return <Redirect href="/sign-in"/>;
 if(gate.status==='legal_required')return <Redirect href="/legal-acceptance"/>;
 if(gate.status==='onboarding_required')return <Redirect href="/onboarding-required"/>;
 if(loading||gate.status!=='ready'||!user)return <Redirect href="/"/>;
 const adjust=(delta:number)=>{
  const next=shiftCalendarDate(day,delta);
  if(next)setDay(next);
 };
 return (
  <SafeAreaView style={styles.safe}>
   <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <V2WorkspaceHeader title="Fuel" />
    <View accessibilityRole="tablist" style={styles.tabs}>
     {sections.map(tab=><Pressable key={tab.id}
      accessibilityRole="tab" accessibilityLabel={tab.label}
      accessibilityState={{selected:section===tab.id}}
      style={[styles.tab,section===tab.id&&styles.selected]}
      onPress={()=>setSection(tab.id)}>
      <Text style={[styles.tabLabel,section===tab.id&&styles.tabActive]}>{tab.label}</Text>
     </Pressable>)}
    </View>
    {section==='food-log'||section==='daily'?<>
     <View style={styles.dayPicker}>
      <Pressable accessibilityRole="button" accessibilityLabel="Previous Food Log day"
       style={styles.dayControl} onPress={()=>adjust(-1)}>
       <Text style={styles.dayText}>‹</Text></Pressable>
      <Text style={styles.dayText}>{day}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Next Food Log day"
       style={styles.dayControl} onPress={()=>adjust(1)}>
       <Text style={styles.dayText}>›</Text></Pressable>
     </View>
     {section==='daily'?<View style={styles.nutritionDetails}>
      <View style={styles.nutritionHeading}>
       <View style={styles.nutritionTitleGroup}>
        <View style={styles.goldAccent}/>
        <Text accessibilityRole="header" style={styles.subhead}>Nutrition</Text>
       </View>
       <Pressable accessibilityRole="button" accessibilityLabel="Return to Food Log"
        style={styles.backAction} onPress={()=>setSection('food-log')}>
        <Text style={styles.linkText}>‹ Food Log</Text>
       </Pressable>
      </View>
      <View style={styles.nutritionMetrics}>
       {(['Calories','Protein','Carbs','Fat'] as const).map(label=>(
        <View key={label} style={styles.nutritionMetric}>
         <Text style={styles.metricCaption}>{label}</Text>
         <Text style={styles.nutritionUnknown}>—</Text>
         <Text style={styles.metricCaption}>Target — · Remaining —</Text>
        </View>
       ))}
      </View>
      <Text style={styles.description}>Intake, targets and remaining amounts are unavailable.</Text>
      <View style={styles.nutritionSection}>
       <View style={styles.nutritionTitleGroup}>
        <View style={styles.goldAccent}/>
        <Text accessibilityRole="header" style={styles.nutritionSectionTitle}>Energy budget</Text>
       </View>
       {(['Eaten','Burned','Left to eat'] as const).map(label=>(
        <View key={label} style={styles.nutritionRow}>
         <Text style={styles.nutritionLabel}>{label}</Text>
         <Text style={styles.nutritionUnknown}>—</Text>
        </View>
       ))}
       <Text style={styles.description}>Fixed or adaptive target: Not available</Text>
      </View>
      <View style={styles.nutritionSection}>
       <View style={styles.nutritionTitleGroup}>
        <View style={styles.goldAccent}/>
        <Text accessibilityRole="header" style={styles.nutritionSectionTitle}>Trends</Text>
       </View>
       <Text style={styles.description}>Daily and weekly trends aren't available yet.</Text>
      </View>
      <View style={styles.nutritionSection}>
       <View style={styles.nutritionTitleGroup}>
        <View style={styles.goldAccent}/>
        <Text accessibilityRole="header" style={styles.nutritionSectionTitle}>Coach insights</Text>
       </View>
       <Text style={styles.description}>Training-aware nutrition insights aren't available yet.</Text>
      </View>
     </View>:
      <FuelFoodLogPanel ownerId={user.id} day={day} onDayChange={setDay}
       accessReady={gate.status==='ready'} onOpenNutrition={()=>setSection('daily')}/>}
    </>:
     section==='recipes'?<View style={styles.card}>
      <Text style={styles.description}>Recipes aren't available yet.</Text>
     </View>:
     <View style={styles.card}>
      <View accessibilityRole="tablist" style={styles.tabs}>
       {foodPlanSections.map(tab=><Pressable key={tab.id}
        accessibilityRole="tab" accessibilityLabel={tab.label}
        accessibilityState={{selected:foodPlanSection===tab.id}}
        style={[styles.tab,foodPlanSection===tab.id&&styles.selected]}
        onPress={()=>setFoodPlanSection(tab.id)}>
        <Text style={[styles.tabLabel,foodPlanSection===tab.id&&styles.tabActive]}>{tab.label}</Text>
       </Pressable>)}
      </View>
      {foodPlanSection==='plan'?<>
       <KitchenWeekPlanPanel ownerId={user.id} day={day} accessReady={gate.status==='ready'}/>
       <Text style={styles.note}>Adding foods and starting Meal Prep aren't available yet.</Text>
      </>:foodPlanSection==='shopping'?<>
       <KitchenStockSummaryPanel ownerId={user.id} kind="shopping" accessReady={gate.status==='ready'}/>
      </>:<>
       <KitchenStockSummaryPanel ownerId={user.id} kind="pantry" accessReady={gate.status==='ready'}/>
      </>}
     </View>}
   </ScrollView>
   <V2BottomNavigation/>
  </SafeAreaView>
 );
}
const styles=StyleSheet.create({
 safe:{flex:1,backgroundColor:colors.background},
 content:{paddingHorizontal:20,paddingTop:10,paddingBottom:50,gap:12},
 description:{color:colors.mutedText,fontSize:14,lineHeight:22},
 tabs:{flexDirection:'row',gap:6,backgroundColor:colors.surface,padding:5,borderRadius:14},
 tab:{flex:1,paddingVertical:12,alignItems:'center',justifyContent:'center',borderRadius:10},
 selected:{backgroundColor:colors.surfaceRaised,borderWidth:1,borderColor:colors.gold},
 tabLabel:{color:colors.mutedText,fontSize:12,fontWeight:'700'},
 tabActive:{color:colors.goldSoft},
 dayPicker:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',backgroundColor:colors.surface,
  borderRadius:12,paddingHorizontal:8},
 dayControl:{minWidth:44,minHeight:46,alignItems:'center',justifyContent:'center'},
 dayText:{color:colors.warmWhite,fontSize:17,fontWeight:'700'},
 card:{padding:20,borderRadius:18,backgroundColor:colors.surface,gap:12},
 subhead:{color:colors.warmWhite,fontSize:21,fontWeight:'800'},
 linkText:{color:colors.goldSoft,fontSize:15,fontWeight:'700'},
 note:{color:colors.goldSoft,fontSize:13,lineHeight:20},
 nutritionDetails:{backgroundColor:colors.background,paddingHorizontal:2,paddingVertical:18,gap:12},
 nutritionHeading:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:8},
 nutritionTitleGroup:{flexDirection:'row',alignItems:'center',gap:10},
 goldAccent:{width:4,height:20,borderRadius:2,backgroundColor:colors.gold},
 backAction:{minHeight:44,justifyContent:'center',paddingHorizontal:4},
 nutritionMetrics:{flexDirection:'row',flexWrap:'wrap',gap:12,paddingVertical:8},
 nutritionMetric:{width:'47%',minWidth:0,gap:7,paddingVertical:10},
 metricCaption:{color:colors.mutedText,fontSize:12},
 nutritionSection:{borderTopWidth:1,borderTopColor:colors.border,paddingTop:18,gap:12},
 nutritionSectionTitle:{color:colors.warmWhite,fontSize:17,fontWeight:'800'},
 nutritionRow:{minHeight:44,flexDirection:'row',alignItems:'center',justifyContent:'space-between',
  borderBottomWidth:1,borderBottomColor:colors.border,paddingVertical:8},
 nutritionLabel:{color:colors.warmWhite,fontSize:15,fontWeight:'700'},
 nutritionUnknown:{color:colors.warmWhite,fontSize:20,fontWeight:'800'},
});
