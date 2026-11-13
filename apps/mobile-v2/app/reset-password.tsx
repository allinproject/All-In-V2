import { useRef, useState } from 'react';
import { ActivityIndicator, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../src/lib/supabase';
import { useAuth } from '../src/auth/AuthProvider';
import { assertV2SessionOwner } from '../src/auth/accessGateClient';
import { v2PasswordResetValidationError } from '../src/auth/passwordPolicy';
import { colors } from '../src/theme/tokens';
import { createV2AuthActionGuard } from '../src/auth/authRoute';

export default function ResetPasswordScreen() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [confirmationVisible, setConfirmationVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestGuard = useRef(createV2AuthActionGuard());

  if (!loading && !user) return <Redirect href="/sign-in" />;

  async function updatePassword() {
    if (submitting) return;
    const validationError = v2PasswordResetValidationError(password, confirmation);
    if (validationError) {
      setError(validationError);
      return;
    }
    if (!user) return;

    if (!requestGuard.current.tryEnter()) return;
    const ownerId = user.id;
    const submittedPassword = password;
    setSubmitting(true);
    setError(null);
    try {
      await assertV2SessionOwner(supabase, ownerId);
      const { error: updateError } = await supabase.auth.updateUser({ password: submittedPassword });
      if (updateError) throw updateError;
      await assertV2SessionOwner(supabase, ownerId);
      router.replace('/');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Your password could not be updated. Try again.');
    } finally {
      requestGuard.current.leave();
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.loading}><ActivityIndicator color={colors.gold} /><Text style={styles.body}>Restoring your secure session…</Text></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.screen}>
            <Image source={require('../assets/all-in-365-circle.jpg')} accessibilityLabel="ALL IN 365 circular logo" resizeMode="contain" style={styles.logo} />
            <Text style={styles.slogan}>LIVE ALL IN.</Text>
            <Text accessibilityRole="header" style={styles.title}>Choose a new password</Text>
            <Text style={styles.body}>Use at least 12 characters to keep your account secure.</Text>
            <Text style={styles.fieldLabel}>New password</Text>
            <View style={styles.passwordRow}>
              <TextInput accessibilityLabel="New password" editable={!submitting} autoCapitalize="none" autoComplete="new-password" secureTextEntry={!passwordVisible} placeholder="At least 12 characters" placeholderTextColor={colors.mutedText} style={styles.passwordInput} value={password} onChangeText={value => { if (requestGuard.current.isBusy()) return; setPassword(value); setError(null); }} />
              <Pressable accessibilityRole="button" accessibilityLabel={passwordVisible ? 'Hide new password' : 'Show new password'} accessibilityState={{disabled: submitting}} disabled={submitting} onPress={() => setPasswordVisible(value => !value)} style={styles.visibilityToggle}>
                <Text style={styles.visibilityText}>{passwordVisible ? 'Hide' : 'Show'}</Text>
              </Pressable>
            </View>
            <Text style={styles.fieldLabel}>Confirm new password</Text>
            <View style={styles.passwordRow}>
              <TextInput accessibilityLabel="Confirm new password" editable={!submitting} autoCapitalize="none" autoComplete="new-password" secureTextEntry={!confirmationVisible} placeholder="Repeat your new password" placeholderTextColor={colors.mutedText} style={styles.passwordInput} value={confirmation} onChangeText={value => { if (requestGuard.current.isBusy()) return; setConfirmation(value); setError(null); }} onSubmitEditing={() => void updatePassword()} />
              <Pressable accessibilityRole="button" accessibilityLabel={confirmationVisible ? 'Hide confirmed password' : 'Show confirmed password'} accessibilityState={{disabled: submitting}} disabled={submitting} onPress={() => setConfirmationVisible(value => !value)} style={styles.visibilityToggle}>
                <Text style={styles.visibilityText}>{confirmationVisible ? 'Hide' : 'Show'}</Text>
              </Pressable>
            </View>
            {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
            <Pressable accessibilityRole="button" accessibilityState={{ disabled: submitting, busy: submitting }} disabled={submitting} onPress={() => void updatePassword()} style={({pressed}) => [styles.button, submitting && styles.disabled, pressed && styles.pressed]}>
              {submitting ? <ActivityIndicator color={colors.background} /> : <Text style={styles.buttonText}>Save new password</Text>}
            </Pressable>
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
  loading: {flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16},
  logo: {width: 116, height: 116, borderRadius: 58, alignSelf: 'center'},
  slogan: {color: colors.gold, textAlign: 'center', fontWeight: '800', fontSize: 13, letterSpacing: 2.4, marginBottom: 7},
  title: {color: colors.warmWhite, fontSize: 30, fontWeight: '900', textAlign: 'center'},
  body: {color: colors.mutedText, fontSize: 15, lineHeight: 22, textAlign: 'center', marginBottom: 12},
  fieldLabel: {color: colors.warmWhite, fontSize: 14, fontWeight: '700'},
  passwordRow: {minHeight: 54, flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 14},
  passwordInput: {flex: 1, minHeight: 52, color: colors.warmWhite, fontSize: 16, paddingHorizontal: 16, paddingVertical: 12},
  visibilityToggle: {minHeight: 48, minWidth: 56, justifyContent: 'center', alignItems: 'center', paddingRight: 8},
  visibilityText: {color: colors.goldSoft, fontWeight: '700', fontSize: 14},
  error: {color: colors.danger, fontSize: 14, lineHeight: 20},
  button: {minHeight: 54, borderRadius: 14, backgroundColor: colors.gold, alignItems: 'center', justifyContent: 'center', marginTop: 8},
  disabled: {opacity: 0.65},
  pressed: {opacity: 0.85},
  buttonText: {color: colors.background, fontSize: 17, fontWeight: '800'}
});
