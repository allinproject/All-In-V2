import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../../theme/tokens';

import type { TrainingPlanProjection } from './trainingPlanOwnerProjection';

/** Training owns accepted plan state. A missing reader is not proof of no plan. */
export function TrainingPlanContent({ evidence }: {
  evidence: TrainingPlanProjection;
}) {
  const safe = evidence.status === 'ready';
  const plans = safe ? evidence.plans : [];
  return (
    <View style={styles.container}>
      <View style={styles.head}>
        <Text accessibilityRole="header" style={styles.title}>Training Plan</Text>
        <Text style={styles.eyebrow}>YOUR TRAINING</Text>
      </View>
      {!safe ? (
        <View style={styles.message}>
          <Text style={styles.heading}>Plan not available</Text>
          <Text style={styles.muted}>Your accepted plan hasn't loaded here yet.</Text>
          <Link href="/coach" asChild>
            <Pressable accessibilityRole="button" accessibilityLabel="Open Coach to discuss training" style={styles.action}>
              <Text style={styles.actionText}>Talk to Coach ›</Text>
            </Pressable>
          </Link>
        </View>
      ) : plans.length === 0 ? (
        <View style={styles.message}>
          <Text style={styles.heading}>Need a plan?</Text>
          <Text style={styles.muted}>Build a plan around your goals, available time and training history.</Text>
          <Link href="/coach" asChild>
            <Pressable accessibilityRole="button" style={styles.primary}>
              <Text style={styles.primaryText}>Make a Training Plan</Text>
            </Pressable>
          </Link>
        </View>
      ) : plans.map(plan => (
        <View key={plan.revisionId} style={styles.plan}>
          <Text style={styles.heading}>{plan.title}</Text>
          <Text style={styles.gold}>{plan.goal}</Text>
          <Text style={styles.muted}>{plan.phase ?? 'Current phase unavailable'} · {plan.dateRange}</Text>
          <Text style={styles.subhead}>Weekly structure</Text>
          {plan.weekStructure.map(session => (
            <View key={session.id} style={styles.session}>
              <Text style={styles.day}>{session.day}</Text>
              <View style={styles.sessionBody}>
                <Text style={styles.sessionTitle}>{session.sport}</Text>
                <Text style={styles.muted}>{session.purpose}</Text>
              </View>
            </View>
          ))}
          <Link href="/train" asChild>
            <Pressable accessibilityRole="button" style={styles.action}><Text style={styles.actionText}>View Calendar ›</Text></Pressable>
          </Link>
        </View>
      ))}
    </View>
  );
}
const styles = StyleSheet.create({
  container: { gap: 16, paddingTop: 10 },
  head: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
  title: { fontSize: 22, fontWeight: '900', color: colors.warmWhite },
  eyebrow: { fontSize: 10, fontWeight: '800', letterSpacing: 1.4, color: colors.goldSoft },
  message: { paddingVertical: 20, borderTopWidth: 2, borderTopColor: colors.gold, gap: 10 },
  heading: { fontSize: 20, fontWeight: '800', color: colors.warmWhite },
  muted: { color: colors.mutedText, fontSize: 13, lineHeight: 20 },
  gold: { color: colors.goldSoft, fontSize: 14, fontWeight: '800' },
  action: { minHeight: 46, justifyContent: 'center', alignSelf: 'flex-start', paddingHorizontal: 8 },
  actionText: { color: colors.goldSoft, fontSize: 14, fontWeight: '800' },
  primary: { backgroundColor: colors.gold, borderRadius: 8, minHeight: 48, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  primaryText: { color: colors.background, fontSize: 15, fontWeight: '900' },
  plan: { borderTopWidth: 2, borderTopColor: colors.gold, gap: 12, paddingVertical: 14 },
  subhead: { color: colors.warmWhite, fontSize: 16, fontWeight: '800', marginTop: 10 },
  session: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 14 },
  day: { width: 80, fontSize: 13, fontWeight: '800', color: colors.goldSoft },
  sessionBody: { flex: 1, gap: 4 },
  sessionTitle: { color: colors.warmWhite, fontSize: 15, fontWeight: '700' },
});
