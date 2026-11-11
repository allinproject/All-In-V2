import { Redirect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../auth/AuthProvider';
import { useAccessGate } from '../auth/AccessGateProvider';
import { colors } from '../theme/tokens';
import { V2BottomNavigation } from './V2BottomNavigation';

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
        <Text style={styles.brand}>ALL IN <Text style={styles.gold}>365</Text></Text>
        <Text accessibilityRole="header" style={styles.title}>{title}</Text>
        <Text style={styles.description}>This workspace is part of the approved V2 navigation. Its account-owned features are not connected yet. No records or activity are being reported as empty or complete.</Text>
        {contextDescription ? <Text style={styles.description}>{contextDescription}</Text> : null}
      </View>
      <V2BottomNavigation />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { flex: 1, padding: 24, gap: 16 },
  brand: { color: colors.warmWhite, fontSize: 16, fontWeight: '800' },
  gold: { color: colors.gold },
  title: { color: colors.warmWhite, fontSize: 30, fontWeight: '800' },
  description: { color: colors.mutedText, fontSize: 15, lineHeight: 23 },
});
