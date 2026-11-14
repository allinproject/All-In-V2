import { Redirect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../auth/AuthProvider';
import { useAccessGate } from '../auth/AccessGateProvider';
import { colors } from '../theme/tokens';
import { V2BottomNavigation } from './V2BottomNavigation';
import { V2WorkspaceHeader } from './V2WorkspaceHeader';

type WorkspaceName = 'Fuel' | 'Community' | 'Coach';

export function V2WorkspaceEntry({ title, contextDescription }: { title: WorkspaceName; contextDescription?: string | null }) {
  const { user, loading } = useAuth();
  const gate = useAccessGate();
  if (!loading && !user) return <Redirect href="/sign-in" />;
  if (gate.status === 'legal_required') return <Redirect href="/legal-acceptance" />;
  if (gate.status === 'onboarding_required') return <Redirect href="/onboarding-required" />;
  if (loading || gate.status !== 'ready' || !user) return <Redirect href="/" />;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.content}>
        <V2WorkspaceHeader title={title} />
        <Text style={styles.description}>Features aren't available yet.</Text>
        {contextDescription ? <Text style={styles.description}>{contextDescription}</Text> : null}
      </View>
      <V2BottomNavigation />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { flex: 1, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 24, gap: 12 },
  description: { color: colors.mutedText, fontSize: 15, lineHeight: 23 },
});
