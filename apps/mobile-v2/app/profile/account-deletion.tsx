import { Link, Redirect } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../src/auth/AuthProvider';
import { useAccessGate } from '../../src/auth/AccessGateProvider';
import { v2AuthenticatedScreenKey } from '../../src/auth/authRoute';
import { colors } from '../../src/theme/tokens';

/**
 * Account-deletion entry point, owned by ALL-251.
 * Deliberately provides no fake destructive action or unverified request receipt.
 * A real owner-verified deletion initiation + confirmation workflow is still required
 * before beta distribution can claim account-deletion compliance.
 */
export default function AccountDeletionScreen() {
  const { user, sessionGeneration } = useAuth();
  return <OwnedAccountDeletionScreen key={v2AuthenticatedScreenKey(user?.id ?? null, sessionGeneration)} />;
}

function OwnedAccountDeletionScreen() {
  const { user, loading } = useAuth();
  const gate = useAccessGate();

  if (!loading && !user) return <Redirect href="/sign-in" />;
  if (gate.status === 'legal_required') return <Redirect href="/legal-acceptance" />;
  if (gate.status === 'onboarding_required') return <Redirect href="/onboarding-required" />;
  if (loading || gate.status !== 'ready' || !user) return <Redirect href="/" />;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <Link href="/profile" asChild>
          <Pressable accessibilityRole="button" style={styles.back}>
            <Text style={styles.backText}>‹ Profile</Text>
          </Pressable>
        </Link>
        <Text accessibilityRole="header" style={styles.title}>Delete account</Text>
        <View style={styles.card}>
          <Text style={styles.heading}>Account deletion is not available yet</Text>
          <Text style={styles.body}>
            ALL IN 365 V2 is still being built. The secure in-app deletion workflow is not connected.
            No deletion request has been sent, and your account or data has not been changed.
          </Text>
          <Text style={styles.body}>
            This screen will provide a reviewed, confirmed deletion process before external beta access opens.
            For privacy questions in the meantime, contact durbenventures@gmail.com.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: 24, paddingBottom: 48, gap: 16 },
  back: { minHeight: 44, justifyContent: 'center' },
  backText: { color: colors.gold },
  title: { color: colors.warmWhite, fontSize: 28, fontWeight: '800' },
  card: { padding: 18, gap: 12, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  heading: { color: colors.warmWhite, fontSize: 18, fontWeight: '800' },
  body: { color: colors.mutedText, fontSize: 14, lineHeight: 21 },
});
