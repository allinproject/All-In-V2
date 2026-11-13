import { useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Redirect, Link } from 'expo-router';
import * as Linking from 'expo-linking';
import { supabase } from '../src/lib/supabase';
import { useAuth } from '../src/auth/AuthProvider';
import { startGoogleSignIn } from '../src/auth/googleSignIn';
import { canStartV2SignedOutAction, createV2AuthActionGuard, shouldOfferV2ConfirmationResend } from '../src/auth/authRoute';
import { colors } from '../src/theme/tokens';

function messageFor(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  const lower = message.toLowerCase();
  if (lower.includes('network') || lower.includes('fetch failed')) {
    return 'ALL IN 365 could not reach the sign-in service. Check your connection and try again.';
  }
  return message || 'Sign in could not be completed. Try again.';
}

export default function SignInScreen() {
  const { loading, user, authNotice } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmationPendingEmail, setConfirmationPendingEmail] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const requestGuard = useRef(createV2AuthActionGuard());
  const signedOutReady = canStartV2SignedOutAction(loading, user?.id ?? null);

  if (!loading && user) return <Redirect href="/home" />;

  async function signIn() {
    if (!signedOutReady || submitting || resending) return;
    const normalizedEmail = email.trim();
    if (!normalizedEmail || !password) {
      setError('Enter your email and password.');
      return;
    }

    if (!requestGuard.current.tryEnter()) return;
    const submittedPassword = password;
    setSubmitting(true);
    setError(null);
    setNotice(null);
    setConfirmationPendingEmail(null);
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password: submittedPassword,
      });
      if (signInError) {
        const errorCode = (signInError as { code?: string }).code;
        if (errorCode === 'email_not_confirmed') {
          setConfirmationPendingEmail(normalizedEmail.trim().toLowerCase());
          setError('Your email has not been confirmed. You can request a new secure confirmation link.');
        } else {
          setConfirmationPendingEmail(null);
          setError(messageFor(signInError));
        }
      }
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      requestGuard.current.leave();
      setSubmitting(false);
    }
  }

  async function signInGoogle() {
    if (!signedOutReady || submitting || resending) return;
    if (!requestGuard.current.tryEnter()) return;
    setSubmitting(true);
    setError(null);
    setNotice(null);
    setConfirmationPendingEmail(null);
    try {
      const result = await startGoogleSignIn();
      if (result === 'cancelled') setNotice('Google sign-in was cancelled. You can try again.');
      // Successful redirects are handled only by /auth/callback to avoid
      // consuming one-time PKCE codes twice.
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      requestGuard.current.leave();
      setSubmitting(false);
    }
  }

  async function resendConfirmation() {
    if (!signedOutReady || resending || submitting) return;
    const normalizedEmail = email.trim().toLowerCase();
    if (!shouldOfferV2ConfirmationResend(confirmationPendingEmail, normalizedEmail)) {
      setError('Sign in with the unconfirmed email address before requesting a new link.');
      return;
    }
    if (!normalizedEmail) {
      setError('Enter the email address for your V2 account.');
      return;
    }

    if (!requestGuard.current.tryEnter()) return;
    setResending(true);
    setError(null);
    setNotice(null);
    try {
      const { data: currentSession, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      if (currentSession.session) {
        throw new Error('A V2 account is already signed in. Sign out before resending a confirmation link.');
      }

      const { error: resendError } = await supabase.auth.resend({
        type: 'signup',
        email: normalizedEmail,
        options: {
          emailRedirectTo: Linking.createURL('/auth/callback'),
        },
      });
      if (resendError) throw resendError;
      setNotice('If this V2 account is awaiting email confirmation, a new link has been sent. Open it on this device.');
      setConfirmationPendingEmail(null);
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      requestGuard.current.leave();
      setResending(false);
    }
  }

  const visibleError = error ?? authNotice;
  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.card}>
            <View style={styles.brandHeader}>
              <Text style={styles.brand}>ALL IN <Text style={styles.gold}>365</Text></Text>
              <Text style={styles.tagline}>LIVE ALL IN.</Text>
            </View>
            <Text accessibilityRole="header" style={styles.title}>Welcome back.</Text>
            <Text style={styles.body}>Your whole fitness life in one place.</Text>
            <TextInput accessibilityLabel="Email" editable={!submitting && !resending} autoCapitalize="none" autoComplete="email" keyboardType="email-address" placeholder="Email" placeholderTextColor="#929292" style={styles.input} value={email} onChangeText={value => { if (requestGuard.current.isBusy()) return; setEmail(value); setConfirmationPendingEmail(null); setError(null); setNotice(null); }} />
            <TextInput accessibilityLabel="Password" editable={!submitting && !resending} autoCapitalize="none" autoComplete="current-password" secureTextEntry placeholder="Password" placeholderTextColor="#929292" style={styles.input} value={password} onChangeText={value => { if (requestGuard.current.isBusy()) return; setPassword(value); }} onSubmitEditing={() => void signIn()} />
            {visibleError ? <Text accessibilityLiveRegion="polite" style={styles.error}>{visibleError}</Text> : null}
            {notice ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text> : null}
            <Pressable accessibilityRole="button" accessibilityState={{ disabled: !signedOutReady || submitting || resending, busy: submitting || resending }} disabled={!signedOutReady || submitting || resending} onPress={() => void signIn()} style={({ pressed }) => [styles.button, pressed && styles.pressed, (submitting || resending) && styles.disabled]}>
              {submitting ? <ActivityIndicator color={colors.background} /> : <Text style={styles.buttonText}>Sign in</Text>}
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Continue with Google" accessibilityState={{ disabled: !signedOutReady || submitting || resending, busy: submitting || resending }} disabled={!signedOutReady || submitting || resending} onPress={() => void signInGoogle()} style={({ pressed }) => [styles.googleButton, pressed && styles.pressed, (submitting || resending) && styles.disabled]}>
              <Text style={styles.googleButtonText}>Continue with Google</Text>
            </Pressable>
            {signedOutReady && shouldOfferV2ConfirmationResend(confirmationPendingEmail, email) ? (
              <Pressable accessibilityRole="button" disabled={resending} onPress={() => void resendConfirmation()} style={styles.resendButton}>
                {resending ? <ActivityIndicator color={colors.gold} /> : <Text style={styles.link}>Resend confirmation email</Text>}
              </Pressable>
            ) : null}
            <Text style={styles.note}><Link href="/forgot-password" style={styles.link}>Forgot password?</Link></Text>
            <Text style={styles.note}>New to ALL IN 365 V2? <Link href="/sign-up" style={styles.link}>Create your V2 account</Link></Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  content: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 28, paddingVertical: 48 },
  card: { width: '100%', maxWidth: 460, alignSelf: 'center', gap: 16 },
  brandHeader: { alignItems: 'center', paddingBottom: 56, gap: 9 },
  tagline: { color: colors.goldSoft, fontSize: 11, fontWeight: '800', letterSpacing: 4 },
  brand: { color: colors.warmWhite, fontSize: 43, fontWeight: '900', letterSpacing: -1.5 },
  gold: { color: colors.gold },
  title: { color: colors.warmWhite, fontSize: 34, fontWeight: '900', letterSpacing: -0.8 },
  body: { color: colors.mutedText, fontSize: 15, lineHeight: 22, marginBottom: 12 },
  input: { backgroundColor: colors.background, borderColor: '#514B3E', borderWidth: 1, borderRadius: 12, color: colors.warmWhite, fontSize: 16, paddingHorizontal: 16, paddingVertical: 16 },
  error: { color: colors.danger, fontSize: 14, lineHeight: 19 },
  notice: { color: colors.goldSoft, fontSize: 14, lineHeight: 19 },
  googleButton: { minHeight: 54, borderRadius: 12, backgroundColor: colors.background, borderColor: '#514B3E', borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  googleButtonText: { color: colors.warmWhite, fontWeight: '800', fontSize: 16 },
  resendButton: { minHeight: 40, alignItems: 'center', justifyContent: 'center' },
  button: { minHeight: 56, borderRadius: 12, backgroundColor: colors.gold, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.9 },
  disabled: { opacity: 0.65 },
  buttonText: { color: colors.background, fontSize: 16, fontWeight: '800' },
  note: { color: colors.mutedText, fontSize: 12, textAlign: 'center' },
  link: { color: colors.gold, textDecorationLine: 'underline', fontWeight: '700' }
});