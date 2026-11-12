import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../../theme/tokens';
import {
  goalReviewPresentation, type GoalApprovalPreview,
} from './goalReviewPresentation';

/**
 * ALL-239: read-only presentation of a server-certified Goal review.
 * The eventual approved action requires a mounted authenticated Edge gateway.
 * Do not add a local 'Approve' button that only changes client state.
 */
export function GoalReviewPanel({
  preview, ownerId, sessionGeneration, nowMs,
}: {
  preview: GoalApprovalPreview | null;
  ownerId: string | null;
  sessionGeneration: number;
  nowMs: number;
}) {
  const state = goalReviewPresentation(preview, ownerId, sessionGeneration, nowMs);
  if (state.status === 'unavailable') {
    return (
      <View style={styles.card} accessibilityLabel="Goals are not connected">
        <Text style={styles.heading}>Your goals</Text>
        <Text style={styles.description}>{state.message}</Text>
        <Text style={styles.note}>
          Goal approval stays unavailable until the authenticated owner reader
          and athlete-confirmed server writer are connected.
        </Text>
      </View>
    );
  }
  const goal = state.preview;
  return (
    <View style={styles.card} accessibilityLabel="Goal revision for review">
      <Text style={styles.eyebrow}>PROPOSED GOAL · REVIEW ONLY</Text>
      <Text style={styles.heading}>{goal.goalTitle}</Text>
      <Text style={styles.description}>{goal.goalKind.replace(/_/g, ' ')} · {goal.priority}</Text>
      <Text style={styles.description}>
        {goal.targetDate ? `Target date: ${goal.targetDate}` : 'No fixed target date'}
      </Text>
      <Text style={styles.version}>Revision {goal.expectedVersion} · No changes applied</Text>
      <Text style={styles.sectionTitle}>Supporting behaviors</Text>
      {goal.behaviors.length ? goal.behaviors.map(item => (
        <View key={item.id} style={styles.behavior}>
          <Text style={styles.description}>{item.description}</Text>
          <Text style={styles.note}>
            {item.userConfirmed ? 'Athlete-confirmed' : 'Confirmation required before acceptance'}
            {item.cadence ? ` · ${item.cadence.replace(/_/g, ' ')}` : ''}
          </Text>
        </View>
      )) : <Text style={styles.note}>No supporting behaviors in this revision.</Text>}
      <Text style={styles.note}>{state.message}</Text>
      <Text style={styles.note}>
        This is a preview only. It does not accept, publish, or change your plan.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1,
    borderRadius: 18, padding: 20, gap: 12 },
  eyebrow: { color: colors.goldSoft, fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  heading: { color: colors.warmWhite, fontWeight: '800', fontSize: 21 },
  sectionTitle: { color: colors.warmWhite, fontSize: 16, fontWeight: '700', marginTop: 6 },
  description: { color: colors.warmWhite, fontSize: 14, lineHeight: 21 },
  note: { color: colors.mutedText, fontSize: 13, lineHeight: 20 },
  version: { color: colors.goldSoft, fontSize: 12, fontWeight: '700' },
  behavior: { borderTopWidth: 1, borderColor: colors.border, paddingTop: 12, gap: 4 },
});
