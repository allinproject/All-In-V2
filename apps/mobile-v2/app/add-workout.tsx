import { useState } from 'react';
import { Link, Redirect, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../src/auth/AuthProvider';
import { useAccessGate } from '../src/auth/AccessGateProvider';
import { colors } from '../src/theme/tokens';
import { prepareManualActivity, validAthleteLocalDate } from '../src/features/training/manualActivityDraft';
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
function deviceLocalDate(): string {
  const date = new Date();
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

export default function AddWorkoutScreen() {
  const { user, loading } = useAuth();
  const params = useLocalSearchParams<{ date?: string }>();
  const calendarDay = typeof params.date === 'string' && validAthleteLocalDate(params.date) ? params.date : null;
  const gate = useAccessGate();
  const [mode, setMode] = useState<ActivityEntryMode | null>(null);
  const [sport, setSport] = useState<ActivitySport>('walking');
  const [manualDate, setManualDate] = useState<string | null>(null);
  const [minutes, setMinutes] = useState('');
  const [floors, setFloors] = useState('');
  const selectedDate = manualDate ?? calendarDay ?? deviceLocalDate();
  const manualDraft = mode === 'manual_entry' ? prepareManualActivity({
    sport, athleteLocalDate: selectedDate, athleteLocalToday: deviceLocalDate(),
    durationMinutes: minutes, machineFloors: sport === 'stair' ? floors : '',
  }) : null;

  if (!loading && !user) return <Redirect href="/sign-in" />;
  if (gate.status === 'legal_required') return <Redirect href="/legal-acceptance" />;
  if (gate.status === 'onboarding_required') return <Redirect href="/onboarding-required" />;
  if (gate.status !== 'ready' || !user) return <Redirect href="/" />;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <Link href="/train" asChild>
          <Pressable accessibilityRole="button" style={styles.back}>
            <Text style={styles.muted}>‹ Back to Calendar</Text>
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
            {mode === 'manual_entry' && (
              <View style={styles.manualFields}>
                <Text style={styles.sectionTitle}>Completed activity details</Text>
                <Text style={styles.muted}>Activity date (YYYY-MM-DD)</Text>
                <TextInput accessibilityLabel="Activity date" value={selectedDate}
                  onChangeText={setManualDate} autoCapitalize="none" keyboardType="numbers-and-punctuation"
                  maxLength={10} style={styles.input} placeholder="YYYY-MM-DD" placeholderTextColor={colors.mutedText} />
                <Text style={styles.muted}>Duration (minutes)</Text>
                <TextInput accessibilityLabel="Duration in minutes" value={minutes} onChangeText={setMinutes}
                  keyboardType="decimal-pad" maxLength={8} style={styles.input}
                  placeholder="e.g. 30" placeholderTextColor={colors.mutedText} />
                {sport === 'stair' && (
                  <>
                    <Text style={styles.muted}>Machine-reported floors (optional)</Text>
                    <TextInput accessibilityLabel="Machine-reported floors" value={floors}
                      onChangeText={setFloors} keyboardType="number-pad" maxLength={8}
                      style={styles.input} placeholder="Leave blank if unknown" placeholderTextColor={colors.mutedText} />
                  </>
                )}
                <Text style={styles.muted}>Machine photo scanning is not connected yet. You can prepare a manual draft without it.</Text>
                <Text accessibilityRole="text" style={styles.info}>
                  {manualDraft?.valid
                    ? `Draft only: ${labels[manualDraft.sport]} · ${manualDraft.durationSeconds / 60} min · ${manualDraft.athleteLocalDate}${manualDraft.machineFloors !== null ? ` · ${manualDraft.machineFloors} machine-reported floors` : ''}. Not saved.`
                    : `Complete the date and duration to prepare a draft (${manualDraft?.reason ?? 'missing_details'}).`}
                </Text>
              </View>
            )}
            <Text style={styles.info}>
              {mode === 'start_activity'
                ? `Start ${labels[sport]} will use the one canonical Training session across phone and Watch. The recording service is not connected yet.`
                : `This manual entry stays separate from any scheduled workout on ${selectedDate}. Saving will be enabled once the canonical Completed Activity writer is connected.`}
            </Text>
            <View style={styles.disabledAction} accessibilityState={{ disabled: true }}>
              <Text style={styles.disabledActionText}>
                {mode === 'start_activity' ? 'Start Activity — not yet available' : 'Save Activity — not yet available'}
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
  manualFields: { gap: 9, backgroundColor: colors.surface, borderRadius: 16, padding: 16 },
  input: { minHeight: 48, color: colors.warmWhite, backgroundColor: colors.surfaceRaised, borderColor: colors.border, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14 },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: colors.warmWhite },
  sportGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  sport: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.surface, paddingVertical: 11, paddingHorizontal: 14 },
  sportText: { color: colors.warmWhite, fontSize: 14 },
  info: { color: colors.mutedText, lineHeight: 21, fontSize: 14 },
  disabledAction: { padding: 16, backgroundColor: colors.surfaceRaised, borderRadius: 14, borderWidth: 1, borderColor: colors.border, alignItems: 'center' },
  disabledActionText: { color: colors.mutedText, fontWeight: '700', textAlign: 'center' },
});
