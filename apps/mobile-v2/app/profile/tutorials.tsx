import { Link, Redirect } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../src/auth/AuthProvider';
import { useAccessGate } from '../../src/auth/AccessGateProvider';
import {
  V2_TUTORIAL_CATALOG, tutorialCatalogCategories,
} from '../../src/features/tutorials/tutorialCatalog';
import { colors } from '../../src/theme/tokens';

/**
 * V2 Help / Tutorials catalog shell.
 * No guide is currently device-validated, so do NOT render faux Start/Replay
 * buttons or store completion state. Real screen links below are exploration
 * links, not tutorials.
 */
export default function TutorialsRoute() {
  const { user, loading } = useAuth();
  const gate = useAccessGate();
  if (!loading && !user) return <Redirect href="/sign-in" />;
  if (gate.status === 'legal_required') return <Redirect href="/legal-acceptance" />;
  if (gate.status === 'onboarding_required') return <Redirect href="/onboarding-required" />;
  if (loading || gate.status !== 'ready' || !user) return <Redirect href="/" />;

  return <SafeAreaView style={styles.safe}>
    <ScrollView contentContainerStyle={styles.content}>
      <Link href="/profile" asChild>
        <Pressable accessibilityRole="button" style={styles.back}>
          <Text style={styles.gold}>‹ Profile</Text>
        </Pressable>
      </Link>
      <Text accessibilityRole="header" style={styles.title}>Help & Tutorials</Text>
      <Text style={styles.description}>
        Guides are being rebuilt for the new ALL IN 365. None are ready to start yet.
        You can explore the existing screens below without changing any settings.
      </Text>
      {tutorialCatalogCategories().map(category => <View style={styles.section} key={category}>
        <Text style={styles.heading}>{category}</Text>
        {V2_TUTORIAL_CATALOG.filter(t => t.category===category).map(t => <View style={styles.card} key={t.id}>
          <Text style={styles.itemTitle}>{t.title}</Text>
          <Text style={styles.description}>{t.summary}</Text>
          <Text style={styles.status}>Tutorial coming later</Text>
          {t.exploreRoute ? <Link href={t.exploreRoute} asChild>
            <Pressable accessibilityRole="button" style={styles.explore}>
              <Text style={styles.exploreLabel}>Explore current screen</Text>
            </Pressable>
          </Link> : null}
        </View>)}
      </View>)}
      <Text style={styles.note}>A tutorial will become available only after its real app workflow has been tested. Exploring a screen is not the same as completing a guide.</Text>
    </ScrollView>
  </SafeAreaView>;
}

const styles=StyleSheet.create({
  safe:{flex:1,backgroundColor:colors.background},
  content:{padding:24,paddingBottom:48,gap:17},
  back:{minHeight:44,justifyContent:'center'},
  gold:{color:colors.goldSoft,fontWeight:'800'},
  title:{fontSize:28,fontWeight:'800',color:colors.warmWhite},
  heading:{fontSize:20,color:colors.warmWhite,fontWeight:'800'},
  section:{gap:12},
  card:{backgroundColor:colors.surface,borderWidth:1,borderColor:colors.border,borderRadius:16,padding:16,gap:9},
  itemTitle:{fontSize:16,fontWeight:'800',color:colors.warmWhite},
  description:{fontSize:13,lineHeight:20,color:colors.mutedText},
  status:{fontSize:12,color:colors.goldSoft,fontWeight:'700'},
  explore:{borderWidth:1,borderColor:colors.border,borderRadius:10,padding:11,alignSelf:'flex-start'},
  exploreLabel:{fontSize:13,color:colors.warmWhite,fontWeight:'700'},
  note:{color:colors.mutedText,fontSize:12,lineHeight:19},
});
