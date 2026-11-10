import { useState } from 'react';
import { Link, Redirect } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../src/auth/AuthProvider';
import { useAccessGate } from '../src/auth/AccessGateProvider';
import { colors } from '../src/theme/tokens';
import {
  V2_ACTIVITY_SPORTS,
  type ActivityEntryMode,
  type ActivitySport,
} from '../src/features/training/activityEntryContract';

const labels: Record<ActivitySport, string> = {
  running: 'Running', walking: 'Walking', cycling: 'Cycling', swimming: 'Swimming',
  strength: 'Strength', hiking: 'Hiking', rucking: 'Rucking', rowing: 'Rowing',
  elliptical: 'Elliptical', stair: 'Stair Climber', yoga: 'Yoga',
  mobility: 'Mobility', other: 'Other',
};

/**
 * First mounted ALL-246 entry surface. This does not simulate or locally save
 * a completed workout. Once canonical owners are live, BOTH choices delegate
 * to Training's start writer or Activity's manual completion writer.
 */
export default function AddWorkoutScreen() {
  const { user, loading } = useAuth();
  const gate = useAccessGate();
  const [mode, setMode] = useState<ActivityEntryMode | null>(null);
  const [sport, setSport] = useState<ActivitySport>('walking');

  if (!loading && !user) return <Redirect href="/sign-in" />;
  if (gate.status === 'legal_required') return <Redirect href="/legal-acceptance" />;
  if (gate.status === 'onboarding_required') return <Redirect href="/onboarding-required" />;
  if (gate.status !== 'ready' || !user) return <Redirect href="/" />;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <Link href="/home" asChild>
          <Pressable accessibilityRole="button" style={styles.back}>
            <Text style={styles.muted}>‹ Back to Today</Text>
          </Pressable>
        </Link>
        <Text style={styles.brand}>ALL IN <Text style={styles.gold}>365</Text></Text>
        <Text accessibilityRole="header" style={styles.title}>Add Workout</Text>
        <Text style={styles.muted}>Choose how you want to record your activity.</Text>

        <View style={styles.modeRow}>
          <Pressable accessibilityRole="button" accessibilityState={{ selected: mode === 'start_activity' }}
            onPress={() => setMode('start_activity')} style={[styles.mode, mode === 'start_activity' && styles.selected]}>
            <Text style={styles.modeTitle}>Start Activity</Text>
            <Text style={styles.muted}>Track a workout live</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityState={{ selected: mode === 'manual_entry' }}
            onPress={() => setMode('manual_entry')} style={[styles.mode, mode === 'manual_entry' && styles.selected]}>
            <Text style={styles.modeTitle}>Add Activity</Text>
            <Text style={styles.muted}>Log a workout already completed</Text>
          </Pressable>
        </View>

        {mode !== null && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Choose activity</Text>
            <View style={styles.sportGrid}>
              {V2_ACTIVITY_SPORTS.map(value => (
                <Pressable key={value} accessibilityRole="button"
                  accessibilityLabel={labels[value]}
                  accessibilityState={{ selected: sport === value }}
                  onPress={() => setSport(value)}
                  style={[styles.sport, sport === value && styles.selected]}>
                  <Text style={styles.sportText}>{labels[value]}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.info}>
              {mode === 'start_activity'
                ? `Start ${labels[sport]} will use the one canonical Training session across phone and Watch. The recording service is not connected yet.`
                : `Log a completed ${labels[sport]} activity here. Optional machine-console photo capture and verified manual saving will be available after the Completed Activity writer is connected.`}
            </Text>
            <View style={styles.disabledAction} accessibilityState={{ disabled: true }}>
              <Text style={styles.disabledActionText}>
                {mode === 'start_activity' ? 'Start Activity — not yet available' : 'Continue to details — not yet available'}
              </Text>
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: 24, gap: 16, paddingBottom: 48 },
  back: { minHeight: 42, justifyContent: 'center' },
  brand: { fontSize: 16, fontWeight: '800', color: colors.warmWhite },
  gold: { color: colors.gold },
  title: { fontSize: 30, fontWeight: '800', color: colors.warmWhite },
  muted: { fontSize: 13, color: colors.mutedText, lineHeight: 19 },
  modeRow: { gap: 10 },
  mode: { minHeight: 78, borderWidth: 1, borderRadius: 16, borderColor: colors.border, backgroundColor: colors.surfaceRaised, padding: 15, gap: 6 },
  selected: { borderColor: colors.gold, borderWidth: 2 },
  modeTitle: { fontSize: 17, fontWeight: '700', color: colors.warmWhite },
  section: { gap: 16, marginTop: 8 },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: colors.warmWhite },
  sportGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  sport: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.surface, paddingVertical: 11, paddingHorizontal: 14 },
  sportText: { color: colors.warmWhite, fontSize: 14 },
  info: { color: colors.mutedText, lineHeight: 21, fontSize: 14 },
  disabledAction: { padding: 16, backgroundColor: colors.surfaceRaised, borderRadius: 14, borderWidth: 1, borderColor: colors.border, alignItems: 'center' },
  disabledActionText: { color: colors.mutedText, fontWeight: '700', textAlign: 'center' },
});
