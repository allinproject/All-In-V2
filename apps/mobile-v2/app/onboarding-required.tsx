import { Redirect } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../src/auth/AuthProvider';
import { useAccessGate } from '../src/auth/AccessGateProvider';
import { colors } from '../src/theme/tokens';

export default function OnboardingRequiredScreen() {
  const { user, loading } = useAuth();
  const gate = useAccessGate();
  if (!loading && !user) return <Redirect href="/sign-in" />;
  if (gate.status === 'ready') return <Redirect href="/home" />;
  if (gate.status !== 'onboarding_required') return <Redirect href="/" />;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.content}>
        <Text style={styles.brand}>ALL IN <Text style={styles.gold}>365</Text></Text>
        <Text accessibilityRole="header" style={styles.title}>Finish setting up your account</Text>
        <Text style={styles.body}>This account still has required ALL IN 365 onboarding to complete. Finish setup in the current ALL IN 365 app before using this V2 preview. V2 will not skip or overwrite your existing onboarding state.</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { flex: 1, justifyContent: 'center', padding: 24, gap: 18 },
  brand: { color: colors.warmWhite, fontSize: 18, fontWeight: '800', letterSpacing: 1.4 },
  gold: { color: colors.gold },
  title: { color: colors.warmWhite, fontSize: 28, fontWeight: '800' },
  body: { color: colors.mutedText, fontSize: 15, lineHeight: 23 },
});