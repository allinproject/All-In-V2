import { useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Redirect, useRouter } from 'expo-router';
import { useAuth } from '../src/auth/AuthProvider';
import { canStartV2SignedOutAction, createV2AuthActionGuard } from '../src/auth/authRoute';
import { startGoogleSignIn } from '../src/auth/googleSignIn';
import { colors } from '../src/theme/tokens';

const logo = require('../assets/all-in-365-circle.jpg');

export default function WelcomeScreen() {
  const router = useRouter();
  const { loading, user } = useAuth();
  const [googleBusy, setGoogleBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const actionGuard = useRef(createV2AuthActionGuard());
  const ready = canStartV2SignedOutAction(loading, user?.id ?? null);

  if (loading) {
    return <View style={styles.loading}><ActivityIndicator color={colors.gold} /></View>;
  }
  if (user) return <Redirect href="/" />;

  async function continueWithGoogle() {
    if (!ready || googleBusy || !actionGuard.current.tryEnter()) return;
    setGoogleBusy(true);
    setError(null);
    try {
      const outcome = await startGoogleSignIn();
      if (outcome === 'cancelled') setError('Google sign-in was cancelled. You can try again.');
    } catch {
      setError('Google sign-in could not start. Check your connection and try again.');
    } finally {
      actionGuard.current.leave();
      setGoogleBusy(false);
    }
  }

  return <SafeAreaView style={styles.safe}>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.brandArea}>
        <Image accessibilityLabel="ALL IN 365 circular logo" source={logo} style={styles.logo} resizeMode="contain" />
        <Text style={styles.slogan}>LIVE ALL IN.</Text>
        <View style={styles.accent} />
        <Text accessibilityRole="header" style={styles.headline}>Your whole fitness life in one place.</Text>
        <Text style={styles.subtitle}>Start where you are. Go as far as you want.</Text>
      </View>
      <View style={styles.actions}>
        <Pressable accessibilityRole="button" disabled={!ready} accessibilityState={{disabled: !ready}} onPress={() => router.push('/sign-up')} style={({pressed}) => [styles.primary, pressed && styles.pressed]}>
          <Text style={styles.primaryText}>Get started</Text>
        </Pressable>
        <Pressable accessibilityRole="button" disabled={!ready} accessibilityState={{disabled: !ready}} onPress={() => router.push('/sign-in')} style={({pressed}) => [styles.secondary, pressed && styles.pressed]}>
          <Text style={styles.secondaryText}>I already have an account</Text>
        </Pressable>
        <Pressable accessibilityRole="button" disabled={!ready || googleBusy} accessibilityState={{disabled: !ready || googleBusy, busy: googleBusy}} onPress={() => void continueWithGoogle()} style={styles.googleLink}>
          {googleBusy ? <ActivityIndicator color={colors.gold} /> : <Text style={styles.googleText}>Continue with Google</Text>}
        </Pressable>
        {error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
      </View>
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: {flex: 1, backgroundColor: colors.background},
  loading: {flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background},
  content: {flexGrow: 1, paddingHorizontal: 24, paddingVertical: 30, justifyContent: 'center', gap: 54, width: '100%', maxWidth: 500, alignSelf: 'center'},
  brandArea: {alignItems: 'center', gap: 18},
  logo: {width: 176, height: 176, borderRadius: 88},
  slogan: {fontSize: 34, color: colors.warmWhite, fontWeight: '900', fontStyle: 'italic', letterSpacing: 0.4, textAlign: 'center'},
  accent: {width: 60, height: 3, borderRadius: 3, backgroundColor: colors.gold, marginVertical: 8},
  headline: {fontSize: 23, fontWeight: '800', textAlign: 'center', lineHeight: 31, color: colors.warmWhite, marginTop: 12},
  subtitle: {fontSize: 15, textAlign: 'center', color: colors.mutedText, lineHeight: 22},
  actions: {gap: 16, width: '100%'},
  primary: {minHeight: 56, backgroundColor: colors.gold, borderRadius: 16, justifyContent: 'center', alignItems: 'center'},
  primaryText: {color: colors.background, fontSize: 18, fontWeight: '800'},
  secondary: {minHeight: 56, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 16, justifyContent: 'center', alignItems: 'center'},
  secondaryText: {color: colors.warmWhite, fontSize: 16, fontWeight: '700', textAlign: 'center'},
  googleLink: {minHeight: 48, justifyContent: 'center', alignItems: 'center'},
  googleText: {color: colors.gold, textDecorationLine: 'underline', fontSize: 15, fontWeight: '700'},
  pressed: {opacity: 0.85},
  error: {color: colors.danger, textAlign: 'center', fontSize: 14}
});
