import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Link } from 'expo-router';
import * as Linking from 'expo-linking';
import { supabase } from '../src/lib/supabase';
import { colors } from '../src/theme/tokens';

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function sendResetLink() {
    if (submitting) return;
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setError('Enter the email address for your V2 account.');
      return;
    }

    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      const redirectTo = Linking.createURL('/auth/callback', {
        queryParams: { type: 'recovery' },
      });
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
        redirectTo,
      });
      if (resetError) throw resetError;
      setNotice('If an account exists for that address, a password-reset link has been sent. Open it on this device to set a new password.');
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : '';
      setError(message || 'The reset link could not be sent. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.card}>
            <Text style={styles.brand}>ALL IN <Text style={styles.gold}>365</Text></Text>
            <Text accessibilityRole="header" style={styles.title}>Reset your password</Text>
            <Text style={styles.body}>Enter your V2 account email. We’ll send a secure reset link that opens back in ALL IN 365.</Text>
            <TextInput
              accessibilityLabel="Email"
              editable={!submitting}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              placeholder="Email"
              placeholderTextColor={colors.mutedText}
              style={styles.input}
              value={email}
              onChangeText={value => { setEmail(value); setError(null); setNotice(null); }}
            />
            {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
            {notice ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text> : null}
            <Pressable accessibilityRole="button" accessibilityState={{ disabled: submitting, busy: submitting }} disabled={submitting} onPress={() => void sendResetLink()} style={[styles.button, submitting && styles.disabled]}>
              {submitting ? <ActivityIndicator color={colors.background} /> : <Text style={styles.buttonText}>Send reset link</Text>}
            </Pressable>
            <Text style={styles.footer}><Link href="/sign-in" style={styles.link}>Back to sign in</Link></Text>
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
  notice: { color: colors.goldSoft, fontSize: 14, lineHeight: 20 },
  button: { minHeight: 52, borderRadius: 14, backgroundColor: colors.gold, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.65 },
  buttonText: { color: colors.background, fontSize: 16, fontWeight: '800' },
  footer: { color: colors.mutedText, fontSize: 13, textAlign: 'center' },
  link: { color: colors.gold, textDecorationLine: 'underline', fontWeight: '700' }
});
