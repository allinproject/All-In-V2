import { useRef, useState } from 'react';
import { Link, Redirect } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../src/auth/AuthProvider';
import { createV2AuthActionGuard, v2AuthenticatedScreenKey } from '../src/auth/authRoute';
import { useAccessGate } from '../src/auth/AccessGateProvider';
import { colors } from '../src/theme/tokens';

export default function HomeScreen() {
  const { user, sessionGeneration } = useAuth();
  return <HomeOwnerScreen key={v2AuthenticatedScreenKey(user?.id ?? null, sessionGeneration)} />;
}

function HomeOwnerScreen() {
  const { user, loading, signOut } = useAuth();
  const gate = useAccessGate();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const signOutGuard = useRef(createV2AuthActionGuard());

  async function handleSignOut() {
    if (!signOutGuard.current.tryEnter()) return;
    setSigningOut(true);
    setSignOutError(null);
    try {
      await signOut();
    } catch (error) {
      setSignOutError(error instanceof Error ? error.message : 'Could not sign out. Please retry.');
    } finally {
      signOutGuard.current.leave();
      setSigningOut(false);
    }
  }
  if (!loading && !user) return <Redirect href="/sign-in" />;
  if (gate.status === 'legal_required') return <Redirect href="/legal-acceptance" />;
  if (gate.status === 'onboarding_required') return <Redirect href="/onboarding-required" />;
  if (gate.status !== 'ready') return <Redirect href="/" />;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.content}>
        <Text style={styles.brand}>ALL IN <Text style={styles.gold}>365</Text></Text>
        <Text accessibilityRole="header" style={styles.title}>V2 foundation</Text>
        <Text style={styles.body}>Your existing account is connected and its current access and onboarding checks have passed. This is the new app shell; Coach and recipe workflows will be added as the next verified slices.</Text>
        <Text style={styles.email}>{user?.email ?? 'Loading account…'}</Text>
        <Link href="/add-workout" asChild>
          <Pressable accessibilityRole="button" style={styles.button}>
            <Text style={styles.buttonText}>+ Add Workout</Text>
          </Pressable>
        </Link>
        {signOutError ? <Text accessibilityRole="alert" style={styles.error}>{signOutError}</Text> : null}
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: signingOut, busy: signingOut }} disabled={signingOut} onPress={() => void handleSignOut()} style={styles.button}>
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
  error: { color: colors.danger, fontSize: 14, lineHeight: 20 },
  button: { minHeight: 48, backgroundColor: colors.surfaceRaised, borderColor: colors.border, borderWidth: 1, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
  buttonText: { color: colors.warmWhite, fontWeight: '700' }
});