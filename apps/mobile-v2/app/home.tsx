import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Redirect, useFocusEffect } from 'expo-router';
import { AppState, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../src/auth/AuthProvider';
import { v2AuthenticatedScreenKey } from '../src/auth/authRoute';
import { useAccessGate } from '../src/auth/AccessGateProvider';
import { colors } from '../src/theme/tokens';
import { V2BottomNavigation } from '../src/navigation/V2BottomNavigation';
import { deviceLocalToday, millisecondsUntilNextLocalDay, shouldRefreshTodayOnAppState, todayTrainingDestination } from '../src/features/today/todayEntry';
import { combineCalendarReads } from '../src/features/training/trainingCalendarReadModel';
import { summarizeTodayTraining } from '../src/features/today/todayTrainingCard';
import { todayEnergyGlance } from '../src/features/today/todayEnergyGlance';
import { todayFoodLog, type FuelLogDayEvidence } from '../src/features/today/todayFoodLog';
import { readOwnedFuelDay, V2_FUEL_DAY_READ_ENABLED } from '../src/features/fuel/fuelOwnerFoodClient';
import { supabase } from '../src/lib/supabase';
import { todayWellnessGlance } from '../src/features/today/todayWellnessGlances';
import { todayKitchenDue } from '../src/features/today/todayKitchenDue';
import { todayFuelDestination } from '../src/features/today/todayFuelNavigation';
import { todayWeatherGlance } from '../src/features/today/todayWeatherGlance';

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
  const { user, loading } = useAuth();
  const gate = useAccessGate();
  // Re-evaluate the date on focus after backgrounding or crossing local midnight.
  // This is device-local until the athlete's preferred timezone is available.
  const [localDay, setLocalDay] = useState(deviceLocalToday);
  // A meal can be edited in Fuel without changing the athlete-local day.
  // Refresh the canonical owner reader when returning to Today.
  const [foodRefreshRevision, setFoodRefreshRevision] = useState(0);
  useFocusEffect(useCallback(() => {
    setLocalDay(deviceLocalToday());
    if (V2_FUEL_DAY_READ_ENABLED) setFoodRefreshRevision(value => value + 1);
  }, []));
  // Keep an actively open Today screen on the correct day at local midnight.
  // A suspended native timer is supplemented by focus and AppState refreshes.
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const scheduleNextDay = () => {
      if (!active) return;
      const delay = millisecondsUntilNextLocalDay();
      if (delay === null) return;
      timer = setTimeout(() => {
        if (!active) return;
        setLocalDay(deviceLocalToday());
        scheduleNextDay();
      }, delay);
    };
    scheduleNextDay();
    return () => {
      active = false;
      if (timer !== null) clearTimeout(timer);
    };
  }, []);
  // React Native may resume without remounting the Today tab. Recheck the day
  // on every foreground transition; never trust a date cached before midnight.
  useEffect(() => {
    const listener = AppState.addEventListener('change', state => {
      if (shouldRefreshTodayOnAppState(state)) {
        setLocalDay(deviceLocalToday());
        if (V2_FUEL_DAY_READ_ENABLED) setFoodRefreshRevision(value => value + 1);
      }
    });
    return () => listener.remove();
  }, []);
  const trainingDestination = todayTrainingDestination(localDay) ?? '/train';
  const dailyDestination = todayFuelDestination(localDay, 'daily') ?? '/fuel';
  const foodLogDestination = todayFuelDestination(localDay, 'food-log') ?? '/fuel';
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
  // The Fuel RPC is disabled until its single canonical schema is approved and deployed.
  // Keep unavailable distinct from a verified empty day; reject stale async results.
  const [foodEvidence, setFoodEvidence] = useState<FuelLogDayEvidence>({status:'unavailable'});
  useEffect(() => {
    let active = true;
    if (!V2_FUEL_DAY_READ_ENABLED || gate.status !== 'ready' || !user?.id || !localDay) {
      setFoodEvidence({status:'unavailable'});
      return () => { active=false; };
    }
    setFoodEvidence({status:'loading'});
    void readOwnedFuelDay(supabase,user.id,localDay,()=>active)
      .then(evidence => { if(active)setFoodEvidence(evidence); })
      .catch(() => { if(active)setFoodEvidence({status:'unavailable'}); });
    return () => { active=false; };
  }, [user?.id, localDay, gate.status, foodRefreshRevision]);
  const foodLog = todayFoodLog(foodEvidence, user?.id ?? '', localDay);
  // Progress/Recovery owners are not connected yet: preserve unknown rather
  // than manufacturing performance statistics or a readiness recommendation.
  const progressGlance = todayWellnessGlance({status:'unavailable'}, user?.id ?? '', localDay, 'progress');
  const recoveryGlance = todayWellnessGlance({status:'unavailable'}, user?.id ?? '', localDay, 'recovery');
  // Kitchen scheduling is not connected; reminders must not appear until
  // canonical Meal Prep/Cook Now ownership confirms a due item.
  const dueKitchen = todayKitchenDue({status:'unavailable'}, user?.id ?? '', localDay);
  // Weather provider and explicit location consent are not connected in V2.
  const weatherGlance = todayWeatherGlance({status:'unavailable'}, user?.id ?? '', localDay);

  if (!loading && !user) return <Redirect href="/sign-in" />;
  if (gate.status === 'legal_required') return <Redirect href="/legal-acceptance" />;
  if (gate.status === 'onboarding_required') return <Redirect href="/onboarding-required" />;
  if (gate.status !== 'ready' || !user) return <Redirect href="/" />;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.topBar}>
          <View style={styles.identity}>
            <Image accessibilityLabel="ALL IN 365 circular logo" source={require('../assets/all-in-365-circle.jpg')} style={styles.brandMark} resizeMode="contain" />
            <View style={styles.identityText}>
              <Text style={styles.kicker}>LIVE ALL IN.</Text>
              <Text accessibilityRole="header" style={styles.heading}>Today</Text>
            </View>
          </View>
          <Link href="/profile" asChild>
            <Pressable accessibilityRole="button" accessibilityLabel="Profile and settings" style={styles.profile}>
              <Text style={styles.profileText}>Profile</Text>
            </Pressable>
          </Link>
        </View>
        <View style={styles.dayStrip}>
          <Text style={styles.dayLabel}>{localDay ? new Date(`${localDay}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }) : 'Current day unavailable'}</Text>
          <Text style={styles.weather}>{weatherGlance.label}</Text>
        </View>

        <View style={styles.hero}>
          <View style={styles.heroTopLine}>
            <View style={styles.heroGoldLine} />
            <Text style={styles.sectionLabel}>TODAY'S TRAINING</Text>
          </View>
          <Text style={styles.heroTitle}>{trainingCard.title}</Text>
          <Text style={styles.help}>{trainingCard.detail}</Text>
          <Link href={trainingDestination} asChild>
            <Pressable accessibilityRole="button" style={styles.primaryAction}>
              <Text style={styles.primaryActionText}>{trainingCard.actionLabel}</Text>
            </Pressable>
          </Link>
        </View>

        <View style={styles.goalFeature}>
          <View style={styles.sectionHeader}>
            <View style={styles.goalTitleGroup}>
              <View style={styles.goalAccent} />
              <Text accessibilityRole="header" style={styles.sectionTitle}>Goals &amp; Milestones</Text>
            </View>
            <Link href="/goals" asChild>
              <Pressable accessibilityRole="button" accessibilityLabel="View goals and milestones" style={styles.inlineAction}>
                <Text style={styles.actionText}>View more ›</Text>
              </Pressable>
            </Link>
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.sectionHeader}>
            <Text accessibilityRole="header" style={styles.sectionTitle}>Daily Energy</Text>
            <Link href={dailyDestination} asChild>
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
            <Text accessibilityRole="header" style={styles.sectionTitle}>Food Log</Text>
            <Link href={foodLogDestination} asChild>
              <Pressable accessibilityRole="button" accessibilityLabel="Open this day's food log" style={styles.inlineAction}>
                <Text style={styles.actionText}>View log ›</Text>
              </Pressable>
            </Link>
          </View>
          {foodLog.visible.length > 0 ? (
            <View style={styles.foodPhotoRow}>
              {foodLog.visible.map(row => (
                <Link key={row.id} href={foodLogDestination} asChild>
                  <Pressable accessibilityRole="button"
                    accessibilityLabel={`View ${row.label} in this day's Food Log`}
                    style={styles.foodTile}>
                    {row.photoUri ? (
                      <Image
                        source={{ uri: row.photoUri }}
                        style={styles.foodPhoto}
                        accessibilityLabel={row.label}
                        resizeMode="cover"
                      />
                    ) : (
                      <View style={styles.foodPhotoFallback}>
                        <Text style={styles.foodFallbackText} numberOfLines={2}>{row.label}</Text>
                      </View>
                    )}
                    <Text style={styles.foodTileLabel} numberOfLines={1}>{row.label}</Text>
                  </Pressable>
                </Link>
              ))}
            </View>
          ) : null}
          {foodLog.additionalCount > 0 ? <Text style={styles.help}>+{foodLog.additionalCount} more entries in Fuel</Text> : null}
          <Text style={styles.help}>{foodLog.detail}</Text>
        </View>

        {dueKitchen.length > 0 ? (
          <View style={styles.card}>
            {dueKitchen.map(item => (
              <View key={item.id}>
                <Text style={styles.sectionLabel}>{item.label}</Text>
                <Text style={styles.help}>{item.title}</Text>
              </View>
            ))}
          </View>
        ) : null}

        <View style={styles.card}>
          <View style={styles.sectionHeader}>
            <Text accessibilityRole="header" style={styles.sectionTitle}>Progress</Text>
            <Link href="/progress" asChild>
              <Pressable accessibilityRole="button" accessibilityLabel="View progress details" style={styles.inlineAction}>
                <Text style={styles.actionText}>View more ›</Text>
              </Pressable>
            </Link>
          </View>
          {progressGlance.label ? <Text style={styles.sectionLabel}>{progressGlance.label}</Text> : null}
        </View>

        <View style={styles.card}>
          <View style={styles.sectionHeader}>
            <Text accessibilityRole="header" style={styles.sectionTitle}>Recovery</Text>
            <Link href="/recovery" asChild>
              <Pressable accessibilityRole="button" accessibilityLabel="View recovery details" style={styles.inlineAction}>
                <Text style={styles.actionText}>View more ›</Text>
              </Pressable>
            </Link>
          </View>
          {recoveryGlance.label ? <Text style={styles.sectionLabel}>{recoveryGlance.label}</Text> : null}
        </View>

      </ScrollView>
      <V2BottomNavigation />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {flex: 1, backgroundColor: colors.background},
  content: {paddingHorizontal: 22, paddingTop: 18, paddingBottom: 40, gap: 12, maxWidth: 620, width: '100%', alignSelf: 'center'},
  topBar: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10},
  identity: {flexDirection: 'row', alignItems: 'center', gap: 13, flexShrink: 1},
  identityText: {gap: 3, flexShrink: 1},
  brandMark: {width: 58, height: 58, borderRadius: 29},
  kicker: {color: colors.goldSoft, fontSize: 11, fontWeight: '900', letterSpacing: 1.8},
  heading: {color: colors.warmWhite, fontSize: 31, lineHeight: 36, fontWeight: '900'},
  profile: {paddingHorizontal: 8, minHeight: 44, justifyContent: 'center'},
  profileText: {color: colors.goldSoft, fontWeight: '800', fontSize: 13},
  dayStrip: {flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', minHeight: 42, paddingHorizontal: 12, borderBottomColor: colors.border, borderBottomWidth: 1, gap: 6},
  dayLabel: {color: colors.mutedText, fontSize: 13, fontWeight: '600'},
  weather: {color: colors.mutedText, fontSize: 12},
  hero: {backgroundColor: colors.background, borderTopColor: colors.gold, borderTopWidth: 2, borderBottomColor: colors.border, borderBottomWidth: 1, paddingVertical: 20, paddingHorizontal: 2, gap: 12, marginTop: 3},
  heroTopLine: {flexDirection: 'row', alignItems: 'center', gap: 9},
  heroGoldLine: {width: 4, height: 20, backgroundColor: colors.gold, borderRadius: 3},
  sectionLabel: {fontSize: 11, color: colors.goldSoft, fontWeight: '900', letterSpacing: 1.2},
  heroTitle: {fontSize: 25, lineHeight: 30, color: colors.warmWhite, fontWeight: '900'},
  help: {color: colors.mutedText, fontSize: 13, lineHeight: 20},
  primaryAction: {backgroundColor: colors.gold, borderRadius: 8, minHeight: 49, alignItems: 'center', justifyContent: 'center'},
  primaryActionText: {color: colors.background, fontWeight: '900', fontSize: 15},
  groupHeading: {color: colors.warmWhite, fontSize: 19, fontWeight: '800', marginTop: 10, marginBottom: 1},
  quickActions: {flexDirection: 'row', gap: 10},
  quickAction: {flex: 1, minWidth: 0, minHeight: 74, borderWidth: 1, borderColor: colors.border, borderRadius: 16, backgroundColor: colors.surface, padding: 14, justifyContent: 'center', gap: 6},
  quickActionText: {color: colors.goldSoft, fontSize: 15, fontWeight: '800'},
  quickActionHint: {color: colors.mutedText, fontSize: 11},
  card: {backgroundColor: colors.background, borderBottomColor: colors.border, borderBottomWidth: 1, paddingVertical: 18, paddingHorizontal: 2, gap: 12},
  goalFeature: {backgroundColor: colors.background, borderBottomColor: colors.border, borderBottomWidth: 1, paddingVertical: 18, paddingHorizontal: 2},
  goalTitleGroup: {flexDirection: 'row', alignItems: 'center', flexShrink: 1, gap: 10},
  goalAccent: {width: 4, height: 23, backgroundColor: colors.gold},
  sectionHeader: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8},
  sectionTitle: {color: colors.warmWhite, fontSize: 17, fontWeight: '800'},
  inlineAction: {minHeight: 44, justifyContent: 'center', paddingHorizontal: 4},
  actionText: {color: colors.goldSoft, fontSize: 13, fontWeight: '700'},
  metricRow: {flexDirection: 'row', gap: 8},
  metric: {flex: 1, minWidth: 0, paddingVertical: 8, paddingHorizontal: 4, gap: 7},
  metricLabel: {color: colors.mutedText, fontSize: 11},
  metricUnknown: {color: colors.warmWhite, fontSize: 21, fontWeight: '800'},
  foodPhotoRow: {flexDirection: 'row', gap: 8},
  foodTile: {width: '22%', maxWidth: 88, minWidth: 0, gap: 4},
  foodPhoto: {width: '100%', aspectRatio: 1, borderRadius: 10, backgroundColor: colors.surfaceRaised},
  foodPhotoFallback: {width: '100%', aspectRatio: 1, borderRadius: 3, backgroundColor: colors.background, borderColor: colors.border, borderWidth: 1, alignItems: 'center', justifyContent: 'center', padding: 4},
  foodFallbackText: {color: colors.mutedText, fontSize: 10, textAlign: 'center'},
  foodTileLabel: {color: colors.warmWhite, fontSize: 10, textAlign: 'center'},
  account: {color: colors.mutedText, fontSize: 12},
  error: {color: colors.danger, fontSize: 13},
  signOut: {minHeight: 44, justifyContent: 'center', alignItems: 'center'},
  signOutText: {color: colors.mutedText, fontWeight: '700'}
});
