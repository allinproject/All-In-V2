import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Redirect, Link } from 'expo-router';
import * as Linking from 'expo-linking';
import { supabase } from '../src/lib/supabase';
import { useAuth } from '../src/auth/AuthProvider';
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
  const [confirmationPending, setConfirmationPending] = useState(false);
  const [resending, setResending] = useState(false);

  if (!loading && user) return <Redirect href="/home" />;

  async function signIn() {
    if (submitting || resending) return;
    const normalizedEmail = email.trim();
    if (!normalizedEmail || !password) {
      setError('Enter your email and password.');
      return;
    }

    setSubmitting(true);
    setError(null);
    setNotice(null);
    setConfirmationPending(false);
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });
      if (signInError) {
        const errorCode = (signInError as { code?: string }).code;
        if (errorCode === 'email_not_confirmed') {
          setConfirmationPending(true);
          setError('Your email has not been confirmed. You can request a new secure confirmation link.');
        } else {
          setConfirmationPending(false);
          setError(messageFor(signInError));
        }
      }
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setSubmitting(false);
    }
  }

  async function resendConfirmation() {
    if (resending || submitting) return;
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setError('Enter the email address for your V2 account.');
      return;
    }

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
      setConfirmationPending(false);
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setResending(false);
    }
  }

  const visibleError = error ?? authNotice;
  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.card}>
            <Text style={styles.brand}>ALL IN <Text style={styles.gold}>365</Text></Text>
            <Text accessibilityRole="header" style={styles.title}>Welcome back</Text>
            <Text style={styles.body}>Sign in to your ALL IN 365 V2 account.</Text>
            <TextInput accessibilityLabel="Email" autoCapitalize="none" autoComplete="email" keyboardType="email-address" placeholder="Email" placeholderTextColor="#929292" style={styles.input} value={email} onChangeText={setEmail} />
            <TextInput accessibilityLabel="Password" autoCapitalize="none" autoComplete="current-password" secureTextEntry placeholder="Password" placeholderTextColor="#929292" style={styles.input} value={password} onChangeText={setPassword} onSubmitEditing={() => void signIn()} />
            {visibleError ? <Text accessibilityLiveRegion="polite" style={styles.error}>{visibleError}</Text> : null}
            {notice ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text> : null}
            <Pressable accessibilityRole="button" accessibilityState={{ disabled: submitting || resending, busy: submitting || resending }} disabled={submitting || resending} onPress={() => void signIn()} style={({ pressed }) => [styles.button, pressed && styles.pressed, (submitting || resending) && styles.disabled]}>
              {submitting ? <ActivityIndicator color={colors.background} /> : <Text style={styles.buttonText}>Sign in</Text>}
            </Pressable>
            {confirmationPending ? (
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
  content: { flexGrow: 1, justifyContent: 'center', padding: 22 },
  card: { width: '100%', maxWidth: 460, alignSelf: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 22, padding: 28, gap: 16 },
  brand: { color: colors.warmWhite, fontSize: 18, fontWeight: '800', letterSpacing: 1.5 },
  gold: { color: colors.gold },
  title: { color: colors.warmWhite, fontSize: 30, fontWeight: '800', marginTop: 8 },
  body: { color: colors.mutedText, fontSize: 15, lineHeight: 21 },
  input: { backgroundColor: colors.surfaceRaised, borderColor: colors.border, borderWidth: 1, borderRadius: 14, color: colors.warmWhite, fontSize: 16, paddingHorizontal: 15, paddingVertical: 14 },
  error: { color: colors.danger, fontSize: 14, lineHeight: 19 },
  notice: { color: colors.goldSoft, fontSize: 14, lineHeight: 19 },
  resendButton: { minHeight: 40, alignItems: 'center', justifyContent: 'center' },
  button: { minHeight: 52, borderRadius: 14, backgroundColor: colors.gold, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.9 },
  disabled: { opacity: 0.65 },
  buttonText: { color: colors.background, fontSize: 16, fontWeight: '800' },
  note: { color: colors.mutedText, fontSize: 12, textAlign: 'center' },
  link: { color: colors.gold, textDecorationLine: 'underline', fontWeight: '700' }
});