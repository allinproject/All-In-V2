import { Link, Redirect, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../src/auth/AuthProvider';
import { useAccessGate } from '../src/auth/AccessGateProvider';
import { V2WorkspaceHeader } from '../src/navigation/V2WorkspaceHeader';
import { V2BottomNavigation } from '../src/navigation/V2BottomNavigation';
import { deviceLocalToday } from '../src/features/today/todayEntry';
import { validAthleteLocalDate } from '../src/features/training/manualActivityDraft';
import { colors } from '../src/theme/tokens';

/**
 * Daily Extended is the athlete's whole-day activity + energy destination,
 * not the Food Log Nutrition detail. Domain owners supply verified totals;
 * a missing reader never means the athlete ate or burned zero calories.
 */
export default function DailyExtendedScreen() {
  const { user, loading } = useAuth();
  const gate = useAccessGate();
  const { date } = useLocalSearchParams<{ date?: string }>();
  const day = typeof date === 'string' && validAthleteLocalDate(date)
    ? date : deviceLocalToday();

  if (!loading && !user) return <Redirect href="/sign-in" />;
  if (gate.status === 'legal_required') return <Redirect href="/legal-acceptance" />;
  if (gate.status === 'onboarding_required') return <Redirect href="/onboarding-required" />;
  if (loading || gate.status !== 'ready' || !user) return <Redirect href="/" />;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <V2WorkspaceHeader title="Daily Extended" />
        <View style={styles.heading}>
          <Text style={styles.date}>{day ?? 'Date unavailable'}</Text>
          <Link href="/home" asChild>
            <Pressable accessibilityRole="button" style={styles.action}>
              <Text style={styles.actionLabel}>‹ Today</Text>
            </Pressable>
          </Link>
        </View>
        <View style={styles.section}>
          <View style={styles.sectionHeading}>
            <View style={styles.accent} />
            <Text accessibilityRole="header" style={styles.title}>Daily Energy</Text>
          </View>
          <View style={styles.metrics}>
            {(['Burned', 'Eaten', 'Left to eat'] as const).map(label => (
              <View key={label} style={styles.metric}>
                <Text style={styles.metricLabel}>{label}</Text>
                <Text style={styles.value}>—</Text>
              </View>
            ))}
          </View>
          <Text style={styles.status}>Daily energy totals aren't available yet.</Text>
        </View>
        <View style={styles.section}>
          <View style={styles.sectionHeading}>
            <View style={styles.accent} />
            <Text accessibilityRole="header" style={styles.title}>Activities</Text>
          </View>
          <Text style={styles.status}>Daily activity details aren't available yet.</Text>
          <Link href="/train" asChild>
            <Pressable accessibilityRole="button" style={styles.action}>
              <Text style={styles.actionLabel}>View training ›</Text>
            </Pressable>
          </Link>
        </View>
        <View style={styles.section}>
          <View style={styles.sectionHeading}>
            <View style={styles.accent} />
            <Text accessibilityRole="header" style={styles.title}>Nutrition</Text>
          </View>
          <Text style={styles.status}>Verified nutrition totals aren't available yet.</Text>
          <Link href={{ pathname: '/fuel', params: { date: day ?? '', section: 'daily' } }} asChild>
            <Pressable accessibilityRole="button" style={styles.action}>
              <Text style={styles.actionLabel}>View nutrition ›</Text>
            </Pressable>
          </Link>
        </View>
      </ScrollView>
      <V2BottomNavigation />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 50, gap: 14 },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  date: { color: colors.mutedText, fontSize: 13 },
  action: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 6 },
  actionLabel: { color: colors.goldSoft, fontSize: 14, fontWeight: '700' },
  section: { borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: 16, gap: 12 },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  accent: { width: 4, height: 20, borderRadius: 2, backgroundColor: colors.gold },
  title: { fontSize: 17, fontWeight: '800', color: colors.warmWhite },
  metrics: { flexDirection: 'row', gap: 8 },
  metric: { flex: 1, minWidth: 0, gap: 7, paddingVertical: 8 },
  metricLabel: { color: colors.mutedText, fontSize: 12 },
  value: { color: colors.warmWhite, fontSize: 21, fontWeight: '800' },
  status: { color: colors.mutedText, fontSize: 13 },
});
