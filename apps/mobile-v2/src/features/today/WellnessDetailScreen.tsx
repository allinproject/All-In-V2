import { Link, Redirect } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../auth/AuthProvider';
import { useAccessGate } from '../../auth/AccessGateProvider';
import { colors } from '../../theme/tokens';

/**
 * Presentation-only destination for a not-yet-connected canonical owner reader.
 * Once owner-approved Progress / Recovery readers are available, extend these
 * routes rather than fabricating values or introducing a second data source.
 */
export function WellnessDetailScreen({ domain }: { domain: 'progress' | 'recovery' }) {
  const { user, loading } = useAuth();
  const gate = useAccessGate();
  if (!loading && !user) return <Redirect href="/sign-in" />;
  if (gate.status === 'legal_required') return <Redirect href="/legal-acceptance" />;
  if (gate.status === 'onboarding_required') return <Redirect href="/onboarding-required" />;
  if (loading || gate.status !== 'ready' || !user) return <Redirect href="/" />;
  const title = domain === 'progress' ? 'Progress' : 'Recovery';
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.content}>
        <Link href="/home" asChild>
          <Pressable accessibilityRole="button" accessibilityLabel="Back to Today" style={styles.back}>
            <Text style={styles.gold}>‹ Today</Text>
          </Pressable>
        </Link>
        <Text accessibilityRole="header" style={styles.title}>{title}</Text>
        <View style={styles.rule} />
        <Text style={styles.status}>
          {domain === 'progress'
            ? 'Your verified progress history is not available here yet.'
            : 'Your verified recovery data is not available here yet.'}
        </Text>
      </View>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { flex: 1, paddingHorizontal: 22, paddingTop: 12, gap: 22 },
  back: { minHeight: 44, justifyContent: 'center' },
  gold: { color: colors.goldSoft, fontWeight: '800', fontSize: 14 },
  title: { color: colors.warmWhite, fontWeight: '900', fontSize: 32 },
  rule: { height: 2, backgroundColor: colors.gold },
  status: { color: colors.mutedText, fontSize: 14, lineHeight: 21 },
});
