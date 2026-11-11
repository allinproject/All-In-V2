import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Redirect, useFocusEffect } from 'expo-router';
import { AppState, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../src/auth/AuthProvider';
import { createV2AuthActionGuard, v2AuthenticatedScreenKey } from '../src/auth/authRoute';
import { useAccessGate } from '../src/auth/AccessGateProvider';
import { colors } from '../src/theme/tokens';
import { V2BottomNavigation } from '../src/navigation/V2BottomNavigation';
import { deviceLocalToday, shouldRefreshTodayOnAppState, todayTrainingDestination } from '../src/features/today/todayEntry';
import { combineCalendarReads } from '../src/features/training/trainingCalendarReadModel';
import { summarizeTodayTraining } from '../src/features/today/todayTrainingCard';
import { todayEnergyGlance } from '../src/features/today/todayEnergyGlance';
import { todayFoodLog } from '../src/features/today/todayFoodLog';

/**
 * Today is the one existing /home entry point.
 * No placeholder metric or workout is presented as a verified athlete fact.
 * Canonical Training, Nutrition, Progress and Recovery readers populate these sections
 * through their respective domain owners; this screen must not create shadow state.
 */
export default function HomeScreen() {
  const { user, sessionGeneration } = useAuth();
  return <HomeOwnerScreen key={v2AuthenticatedScreenKey(user?.id ?? null, sessionGeneration)} />;
}

function HomeOwnerScreen() {
  const { user, loading, signOut } = useAuth();
  const gate = useAccessGate();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const signOutGuard = useRef(createV2AuthActionGuard());
  // Re-evaluate the date on focus after backgrounding or crossing local midnight.
  // This is device-local until the athlete's preferred timezone is available.
  const [localDay, setLocalDay] = useState(deviceLocalToday);
  useFocusEffect(useCallback(() => { setLocalDay(deviceLocalToday()); }, []));
  // React Native may resume without remounting the Today tab. Recheck the day
  // on every foreground transition; never trust a date cached before midnight.
  useEffect(() => {
    const listener = AppState.addEventListener('change', state => {
      if (shouldRefreshTodayOnAppState(state)) setLocalDay(deviceLocalToday());
    });
    return () => listener.remove();
  }, []);
  const trainingDestination = todayTrainingDestination(localDay) ?? '/train';
  // Consume exactly the Train calendar read contract; no separate Today writer.
  // Both sources remain unavailable until their canonical backend owners are live.
  const trainingRead = useMemo(() => combineCalendarReads({
    ownerId: user?.id ?? '',
    fromDate: localDay ?? '',
    throughDate: localDay ?? '',
    planned: { status: 'unavailable' },
    completed: { status: 'unavailable' },
  }), [user?.id, localDay]);
  const trainingCard = summarizeTodayTraining(trainingRead, localDay);
  // Read-only Fuel projection. The canonical daily Fuel owner is not connected;
  // do not invent calories or present a missing food day as zero.
  const energyGlance = todayEnergyGlance({ status: 'unavailable' }, user?.id ?? '', localDay);
  // Canonical Fuel entries are not available yet; do not invent rows or photos.
  const foodLog = todayFoodLog({ status: 'unavailable' }, user?.id ?? '', localDay);

  async function handleSignOut() {
    if (!signOutGuard.current.tryEnter()) return;
    setSigningOut(true);
    setSignOutError(null);
    try {
      await signOut();
    } catch (error) {
      setSignOutError(error instanceof Error ? error.message : 'Could not sign out. Please retry.');
    } finally {
      signOutGuard.current.leave();
      setSigningOut(false);
    }
  }

  if (!loading && !user) return <Redirect href="/sign-in" />;
  if (gate.status === 'legal_required') return <Redirect href="/legal-acceptance" />;
  if (gate.status === 'onboarding_required') return <Redirect href="/onboarding-required" />;
  if (gate.status !== 'ready' || !user) return <Redirect href="/" />;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.topBar}>
          <View>
            <Text style={styles.brand}>ALL IN <Text style={styles.gold}>365</Text></Text>
            <Text accessibilityRole="header" style={styles.heading}>Today</Text>
          </View>
          <View style={styles.topActions}>
            <Text style={styles.weather}>Weather unavailable</Text>
            <Link href="/profile" asChild>
              <Pressable accessibilityRole="button" accessibilityLabel="Profile and settings" style={styles.profile}>
                <Text style={styles.profileText}>Profile</Text>
              </Pressable>
            </Link>
          </View>
        </View>

        <View style={styles.hero}>
          <Text style={styles.sectionLabel}>TODAY'S TRAINING</Text>
          <Text style={styles.heroTitle}>{trainingCard.title}</Text>
          <Text style={styles.help}>{trainingCard.detail}</Text>
          <Link href={trainingDestination} asChild>
            <Pressable accessibilityRole="button" style={styles.primaryAction}>
              <Text style={styles.primaryActionText}>{trainingCard.actionLabel}</Text>
            </Pressable>
          </Link>
        </View>

        <View style={styles.card}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Daily Extended</Text>
            <Link href="/fuel" asChild>
              <Pressable accessibilityRole="button" accessibilityLabel="View daily nutrition details" style={styles.inlineAction}>
                <Text style={styles.actionText}>View more ›</Text>
              </Pressable>
            </Link>
          </View>
          <View style={styles.metricRow}>
            <View style={styles.metric}><Text style={styles.metricLabel}>Burned</Text><Text style={styles.metricUnknown}>{energyGlance.burned}</Text></View>
            <View style={styles.metric}><Text style={styles.metricLabel}>Eaten</Text><Text style={styles.metricUnknown}>{energyGlance.eaten}</Text></View>
            <View style={styles.metric}><Text style={styles.metricLabel}>Left to eat</Text><Text style={styles.metricUnknown}>{energyGlance.remaining}</Text></View>
          </View>
          <Text style={styles.help}>{energyGlance.detail}</Text>
        </View>

        <View style={styles.card}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Food Log</Text>
            <Link href="/fuel" asChild>
              <Pressable accessibilityRole="button" style={styles.inlineAction}>
                <Text style={styles.actionText}>View log ›</Text>
              </Pressable>
            </Link>
          </View>
          {foodLog.visible.map(row => (
            <View key={row.id} style={styles.foodRow}>
              <Text style={styles.foodMeal}>{row.meal}</Text>
              <Text style={styles.foodLabel} numberOfLines={1}>{row.label}</Text>
            </View>
          ))}
          {foodLog.additionalCount > 0 ? <Text style={styles.help}>+{foodLog.additionalCount} more entries in Fuel</Text> : null}
          <Text style={styles.help}>{foodLog.detail}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Progress</Text>
          <Text style={styles.help}>Your sport- and goal-specific progress summary is not connected yet. No performance statistics are being inferred.</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Recovery</Text>
          <Text style={styles.help}>Your current Recovery assessment is not connected yet. No recovery recommendation is being inferred.</Text>
        </View>

        <Text style={styles.account}>Signed in as {user.email ?? 'your V2 account'}</Text>
        {signOutError ? <Text accessibilityRole="alert" style={styles.error}>{signOutError}</Text> : null}
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: signingOut, busy: signingOut }}
          disabled={signingOut} onPress={() => void handleSignOut()} style={styles.signOut}>
          <Text style={styles.signOutText}>{signingOut ? 'Signing out…' : 'Sign out'}</Text>
        </Pressable>
      </ScrollView>
      <V2BottomNavigation />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20, gap: 16, paddingBottom: 40 },
  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  topActions: { alignItems: 'flex-end', gap: 8 },
  brand: { color: colors.warmWhite, fontSize: 15, fontWeight: '800', letterSpacing: 1.2 },
  gold: { color: colors.gold },
  heading: { color: colors.warmWhite, fontSize: 30, fontWeight: '800', marginTop: 4 },
  weather: { color: colors.mutedText, fontSize: 11 },
  profile: { borderColor: colors.border, borderWidth: 1, paddingHorizontal: 12, minHeight: 40, justifyContent: 'center', borderRadius: 12 },
  profileText: { color: colors.warmWhite, fontWeight: '700', fontSize: 12 },
  hero: { backgroundColor: colors.surfaceRaised, borderColor: colors.gold, borderWidth: 1, borderRadius: 18, padding: 20, gap: 12 },
  sectionLabel: { fontSize: 12, color: colors.goldSoft, fontWeight: '800', letterSpacing: 1 },
  heroTitle: { fontSize: 21, color: colors.warmWhite, fontWeight: '800' },
  help: { color: colors.mutedText, fontSize: 13, lineHeight: 20 },
  primaryAction: { backgroundColor: colors.gold, borderRadius: 12, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  primaryActionText: { color: colors.background, fontWeight: '800' },
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 18, padding: 16, gap: 12 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionTitle: { color: colors.warmWhite, fontSize: 17, fontWeight: '800' },
  inlineAction: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
  actionText: { color: colors.goldSoft, fontSize: 13, fontWeight: '700' },
  metricRow: { flexDirection: 'row', gap: 8 },
  metric: { flex: 1, minWidth: 0, backgroundColor: colors.surfaceRaised, borderRadius: 12, padding: 10, gap: 5 },
  metricLabel: { color: colors.mutedText, fontSize: 11 },
  metricUnknown: { color: colors.warmWhite, fontSize: 22, fontWeight: '800' },
  foodRow: { flexDirection: 'row', gap: 8, alignItems: 'center', minHeight: 28 },
  foodMeal: { color: colors.goldSoft, fontSize: 11, minWidth: 64, textTransform: 'capitalize' },
  foodLabel: { color: colors.warmWhite, fontSize: 13, flex: 1 },
  account: { color: colors.mutedText, fontSize: 12 },
  error: { color: colors.danger, fontSize: 13 },
  signOut: { minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  signOutText: { color: colors.mutedText, fontWeight: '700' },
});
