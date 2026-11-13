import { useRef, useState } from 'react';
import { ActivityIndicator, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Link } from 'expo-router';
import { getV2EmailAuthRedirectUrl } from '../src/auth/emailAuthRedirectRuntime';
import { supabase } from '../src/lib/supabase';
import { colors } from '../src/theme/tokens';
import { createV2AuthActionGuard } from '../src/auth/authRoute';

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const requestGuard = useRef(createV2AuthActionGuard());

  async function sendResetLink() {
    if (submitting) return;
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setError('Enter your email address.');
      return;
    }

    if (!requestGuard.current.tryEnter()) return;
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      const redirectTo = getV2EmailAuthRedirectUrl(true);
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
        redirectTo,
      });
      if (resetError) throw resetError;
      setNotice('If an account exists for that address, a password-reset link has been sent. Open it on this device to set a new password.');
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : '';
      setError(message || 'The reset link could not be sent. Check your connection and try again.');
    } finally {
      requestGuard.current.leave();
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.screen}>
            <Image source={require('../assets/all-in-365-circle.jpg')} accessibilityLabel="ALL IN 365 circular logo" resizeMode="contain" style={styles.logo} />
            <Text style={styles.slogan}>LIVE ALL IN.</Text>
            <Text accessibilityRole="header" style={styles.title}>Reset your password</Text>
            <Text style={styles.body}>Enter your account email. We'll send a secure link to help you choose a new password.</Text>
            <Text style={styles.fieldLabel}>Email address</Text>
            <TextInput
              accessibilityLabel="Email"
              editable={!submitting}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              placeholder="you@example.com"
              placeholderTextColor={colors.mutedText}
              style={styles.input}
              value={email}
              onChangeText={value => { if (requestGuard.current.isBusy()) return; setEmail(value); setError(null); setNotice(null); }}
            />
            {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
            {notice ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text> : null}
            <Pressable accessibilityRole="button" accessibilityState={{ disabled: submitting, busy: submitting }} disabled={submitting} onPress={() => void sendResetLink()} style={({pressed}) => [styles.button, submitting && styles.disabled, pressed && styles.pressed]}>
              {submitting ? <ActivityIndicator color={colors.background} /> : <Text style={styles.buttonText}>Send reset link</Text>}
            </Pressable>
            <Text style={styles.footer}><Link href="/sign-in" style={styles.link}>Back to sign in</Link></Text>
            <Text style={styles.footer}><Link href="/welcome" style={styles.backLink}>Back to welcome</Link></Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {flex: 1, backgroundColor: colors.background},
  flex: {flex: 1},
  content: {flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 26},
  screen: {width: '100%', maxWidth: 450, alignSelf: 'center', gap: 16},
  logo: {width: 116, height: 116, borderRadius: 58, alignSelf: 'center'},
  slogan: {color: colors.gold, textAlign: 'center', fontWeight: '800', fontSize: 13, letterSpacing: 2.4, marginBottom: 7},
  title: {color: colors.warmWhite, fontSize: 30, fontWeight: '900', textAlign: 'center'},
  body: {color: colors.mutedText, fontSize: 15, lineHeight: 23, textAlign: 'center', marginBottom: 15},
  fieldLabel: {color: colors.warmWhite, fontSize: 14, fontWeight: '700'},
  input: {backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 14, color: colors.warmWhite, fontSize: 16, paddingHorizontal: 16, minHeight: 54},
  error: {color: colors.danger, fontSize: 14, lineHeight: 20},
  notice: {color: colors.goldSoft, fontSize: 14, lineHeight: 21},
  button: {minHeight: 54, borderRadius: 14, backgroundColor: colors.gold, alignItems: 'center', justifyContent: 'center', marginTop: 7},
  disabled: {opacity: 0.65},
  pressed: {opacity: 0.85},
  buttonText: {color: colors.background, fontSize: 17, fontWeight: '800'},
  footer: {color: colors.mutedText, fontSize: 13, textAlign: 'center'},
  link: {color: colors.gold, textDecorationLine: 'underline', fontWeight: '700'},
  backLink: {color: colors.mutedText, textDecorationLine: 'underline'}
});
