import {useEffect,useState} from 'react';
import {Redirect,useLocalSearchParams} from 'expo-router';
import {Pressable,ScrollView,StyleSheet,Text,View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useAuth} from '../src/auth/AuthProvider';
import {v2AuthenticatedScreenKey} from '../src/auth/authRoute';
import {useAccessGate} from '../src/auth/AccessGateProvider';
import {FuelFoodLogPanel} from '../src/features/fuel/FuelFoodLogPanel';
import {V2BottomNavigation} from '../src/navigation/V2BottomNavigation';
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
    <Text style={styles.brand}>ALL IN <Text style={styles.gold}>365</Text></Text>
    <Text accessibilityRole="header" style={styles.title}>Fuel</Text>
    <Text style={styles.description}>Your food, recipes and meal planning in one place.</Text>
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
     {section==='daily'?<View style={styles.card}>
      <Text accessibilityRole="header" style={styles.subhead}>Daily Overview</Text>
      <Text style={styles.description}>Hydration and exercise-adjusted nutrition totals are not connected yet. No drinking, calories or workout energy is inferred.</Text>
      <Pressable accessibilityRole="button" onPress={()=>setSection('food-log')}>
       <Text style={styles.linkText}>Open Food Log</Text>
      </Pressable>
     </View>:
      <FuelFoodLogPanel ownerId={user.id} day={day} onDayChange={setDay} accessReady={gate.status==='ready'}/>}
    </>:
     section==='recipes'?<View style={styles.card}>
      <Text accessibilityRole="header" style={styles.subhead}>Recipes</Text>
      <Text style={styles.description}>Recipe browsing and Cook Now will appear here after the canonical Cookbook connects. Each recipe is one serving; planning and shopping are separate.</Text>
     </View>:
     <View style={styles.card}>
      <Text accessibilityRole="header" style={styles.subhead}>Food Plan</Text>
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
       <Text style={styles.description}>Choose the recipes and individual foods you intend to eat on specific days and at breakfast, lunch, dinner or snacks.</Text>
       <Text style={styles.description}>A banana, an apple and a protein bar may each be planned as separate foods for the same lunch. Planning is not logging food as eaten.</Text>
       <Text style={styles.note}>Meal Plan data is not connected yet. No days or foods have been added. Start Meal Prep will become available only with a verified plan and an authenticated session.</Text>
      </>:foodPlanSection==='shopping'?<>
       <Text style={styles.description}>Shopping will combine missing ingredients from planned recipes with individual scheduled foods, including fruit, snacks and drinks.</Text>
       <Text style={styles.description}>Only verified shortages after usable Pantry quantities and reservations are considered belong on this list. Purchases must be confirmed before changing Pantry.</Text>
       <Text style={styles.note}>Shopping data is not connected yet. No shopping cart or purchase has been created.</Text>
      </>:<>
       <Text style={styles.description}>Pantry will track actual available stock, reserved quantities, and food stored in the pantry, fridge or freezer.</Text>
       <Text style={styles.description}>Planning and Shopping never assume an item was purchased or eaten. Only verified inventory writes change available stock.</Text>
       <Text style={styles.note}>Pantry data is not connected yet. Existing stock is not assumed empty.</Text>
      </>}
     </View>}
   </ScrollView>
   <V2BottomNavigation/>
  </SafeAreaView>
 );
}
const styles=StyleSheet.create({
 safe:{flex:1,backgroundColor:colors.background},
 content:{padding:22,paddingBottom:50,gap:16},
 brand:{fontSize:16,color:colors.warmWhite,fontWeight:'800'},
 gold:{color:colors.gold},
 title:{color:colors.warmWhite,fontSize:30,fontWeight:'800'},
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
});
