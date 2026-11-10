import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../src/lib/supabase';
import { useAuth } from '../src/auth/AuthProvider';
import { assertV2SessionOwner } from '../src/auth/accessGateClient';
import { colors } from '../src/theme/tokens';

export default function ResetPasswordScreen() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!loading && !user) return <Redirect href="/sign-in" />;

  async function updatePassword() {
    if (submitting) return;
    if (password.length < 8) {
      setError('Use a password with at least 8 characters.');
      return;
    }
    if (password !== confirmation) {
      setError('The passwords do not match.');
      return;
    }
    if (!user) return;

    const ownerId = user.id;
    setSubmitting(true);
    setError(null);
    try {
      await assertV2SessionOwner(supabase, ownerId);
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      await assertV2SessionOwner(supabase, ownerId);
      router.replace('/');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Your password could not be updated. Try again.');
    } finally {
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
          <View style={styles.card}>
            <Text style={styles.brand}>ALL IN <Text style={styles.gold}>365</Text></Text>
            <Text accessibilityRole="header" style={styles.title}>Choose a new password</Text>
            <Text style={styles.body}>Use at least 8 characters. Your V2 account and training history stay the same.</Text>
            <TextInput accessibilityLabel="New password" autoCapitalize="none" autoComplete="new-password" secureTextEntry placeholder="New password" placeholderTextColor={colors.mutedText} style={styles.input} value={password} onChangeText={setPassword} />
            <TextInput accessibilityLabel="Confirm new password" autoCapitalize="none" autoComplete="new-password" secureTextEntry placeholder="Confirm new password" placeholderTextColor={colors.mutedText} style={styles.input} value={confirmation} onChangeText={setConfirmation} onSubmitEditing={() => void updatePassword()} />
            {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
            <Pressable accessibilityRole="button" accessibilityState={{ disabled: submitting, busy: submitting }} disabled={submitting} onPress={() => void updatePassword()} style={[styles.button, submitting && styles.disabled]}>
              {submitting ? <ActivityIndicator color={colors.background} /> : <Text style={styles.buttonText}>Save new password</Text>}
            </Pressable>
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
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
  brand: { color: colors.warmWhite, fontSize: 18, fontWeight: '800', letterSpacing: 1.5 },
  gold: { color: colors.gold },
  title: { color: colors.warmWhite, fontSize: 28, fontWeight: '800' },
  body: { color: colors.mutedText, fontSize: 15, lineHeight: 22 },
  input: { backgroundColor: colors.surfaceRaised, borderColor: colors.border, borderWidth: 1, borderRadius: 14, color: colors.warmWhite, fontSize: 16, paddingHorizontal: 15, paddingVertical: 14 },
  error: { color: colors.danger, fontSize: 14, lineHeight: 19 },
  button: { minHeight: 52, borderRadius: 14, backgroundColor: colors.gold, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.65 },
  buttonText: { color: colors.background, fontSize: 16, fontWeight: '800' }
});
