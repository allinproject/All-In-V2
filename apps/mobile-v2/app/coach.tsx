import {Redirect} from 'expo-router';
import {ScrollView,StyleSheet,Text} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useAuth} from '../src/auth/AuthProvider';
import {useAccessGate} from '../src/auth/AccessGateProvider';
import {v2AuthenticatedScreenKey} from '../src/auth/authRoute';
import {CoachConversationPanel} from '../src/features/coach/CoachConversationPanel';
import {V2BottomNavigation} from '../src/navigation/V2BottomNavigation';
import {colors} from '../src/theme/tokens';

export default function CoachScreen(){
 const {user,sessionGeneration}=useAuth();
 return <OwnedCoach key={v2AuthenticatedScreenKey(user?.id??null,sessionGeneration)}/>;
}
function OwnedCoach(){
 const {user,loading}=useAuth();
 const gate=useAccessGate();
 if(!loading&&!user)return <Redirect href="/sign-in"/>;
 if(gate.status==='legal_required')return <Redirect href="/legal-acceptance"/>;
 if(gate.status==='onboarding_required')return <Redirect href="/onboarding-required"/>;
 if(loading||gate.status!=='ready'||!user)return <Redirect href="/"/>;
 return <SafeAreaView style={styles.safe}>
  <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
   <Text style={styles.brand}>ALL IN <Text style={styles.gold}>365</Text></Text>
   <Text accessibilityRole="header" style={styles.title}>Coach</Text>
   <CoachConversationPanel ownerId={user.id}/>
  </ScrollView>
  <V2BottomNavigation/>
 </SafeAreaView>;
}
const styles=StyleSheet.create({
 safe:{flex:1,backgroundColor:colors.background},
 content:{padding:22,paddingBottom:50,gap:16},
 brand:{fontSize:16,color:colors.warmWhite,fontWeight:'800'},
 gold:{color:colors.gold},
 title:{fontSize:30,color:colors.warmWhite,fontWeight:'800'}
});
