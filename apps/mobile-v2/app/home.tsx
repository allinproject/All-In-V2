import { Redirect } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../src/auth/AuthProvider';
import { useAccessGate } from '../src/auth/AccessGateProvider';
import { colors } from '../src/theme/tokens';

export default function HomeScreen() {
  const { user, loading, signOut } = useAuth();
  const gate = useAccessGate();
  if (!loading && !user) return <Redirect href="/sign-in" />;
  if (gate.status === 'onboarding_required') return <Redirect href="/onboarding-required" />;
  if (gate.status !== 'ready') return <Redirect href="/" />;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.content}>
        <Text style={styles.brand}>ALL IN <Text style={styles.gold}>365</Text></Text>
        <Text accessibilityRole="header" style={styles.title}>V2 foundation</Text>
        <Text style={styles.body}>Your existing account is connected and its current access and onboarding checks have passed. This is the new app shell; Coach and recipe workflows will be added as the next verified slices.</Text>
        <Text style={styles.email}>{user?.email ?? 'Loading account…'}</Text>
        <Pressable accessibilityRole="button" onPress={() => void signOut()} style={styles.button}>
          <Text style={styles.buttonText}>Sign out</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { flex: 1, justifyContent: 'center', padding: 24, gap: 18 },
  brand: { color: colors.warmWhite, fontSize: 18, fontWeight: '800', letterSpacing: 1.4 },
  gold: { color: colors.gold },
  title: { color: colors.warmWhite, fontSize: 30, fontWeight: '800' },
  body: { color: colors.mutedText, fontSize: 15, lineHeight: 22 },
  email: { color: colors.gold, fontSize: 14 },
  button: { minHeight: 48, backgroundColor: colors.surfaceRaised, borderColor: colors.border, borderWidth: 1, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
  buttonText: { color: colors.warmWhite, fontWeight: '700' }
});