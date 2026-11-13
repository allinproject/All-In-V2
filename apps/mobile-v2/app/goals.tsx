import { Link, Redirect } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../src/auth/AuthProvider';
import { useAccessGate } from '../src/auth/AccessGateProvider';
import { v2AuthenticatedScreenKey } from '../src/auth/authRoute';
import { GoalReviewPanel } from '../src/features/goals/GoalReviewPanel';
import { V2BottomNavigation } from '../src/navigation/V2BottomNavigation';
import { colors } from '../src/theme/tokens';

export default function GoalsScreen() {
  const { user, sessionGeneration } = useAuth();
  return <OwnedGoalsScreen key={v2AuthenticatedScreenKey(user?.id ?? null,sessionGeneration)} />;
}

/** No client-side Goal store or fabricated preview.
 * Only the canonical signed-in Goals owner may provide accepted evidence.
 * Until the backend reader/approval gateway ships, this route is read-only.
 */
function OwnedGoalsScreen() {
  const { user, loading, sessionGeneration } = useAuth();
  const gate = useAccessGate();
  if (!loading && !user) return <Redirect href="/sign-in" />;
  if (gate.status === 'legal_required') return <Redirect href="/legal-acceptance" />;
  if (gate.status === 'onboarding_required') return <Redirect href="/onboarding-required" />;
  if (loading || gate.status !== 'ready' || !user) return <Redirect href="/" />;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <Link href="/home" asChild>
          <Pressable accessibilityRole="button" accessibilityLabel="Back to Today"
            style={styles.back}><Text style={styles.muted}>‹ Today</Text></Pressable>
        </Link>
        <Text style={styles.brand}>ALL IN <Text style={styles.gold}>365</Text></Text>
        <Text accessibilityRole="header" style={styles.title}>Goals</Text>
        <Text style={styles.muted}>
          Goals can include races, strength, activity habits, benchmarks, and
          intentions without a deadline. Each athlete must approve any
          proposed change to an existing goal.
        </Text>
        <GoalReviewPanel preview={null} ownerId={user.id}
          sessionGeneration={sessionGeneration} nowMs={Date.now()} />
      </ScrollView>
      <V2BottomNavigation />
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: 24, paddingBottom: 44, gap: 16 },
  back: { minHeight: 42, justifyContent: 'center' },
  muted: { color: colors.mutedText, fontSize: 14, lineHeight: 22 },
  brand: { color: colors.warmWhite, fontSize: 16, fontWeight: '800' },
  gold: { color: colors.gold },
  title: { color: colors.warmWhite, fontSize: 30, fontWeight: '800' },
});
