import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Redirect } from 'expo-router';
import { supabase } from '../src/lib/supabase';
import { useAuth } from '../src/auth/AuthProvider';

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

  if (!loading && user) return <Redirect href="/home" />;

  async function signIn() {
    if (submitting) return;
    const normalizedEmail = email.trim();
    if (!normalizedEmail || !password) {
      setError('Enter your email and password.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });
      if (signInError) setError(messageFor(signInError));
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setSubmitting(false);
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
            <Pressable accessibilityRole="button" accessibilityState={{ disabled: submitting, busy: submitting }} disabled={submitting} onPress={() => void signIn()} style={({ pressed }) => [styles.button, pressed && styles.pressed, submitting && styles.disabled]}>
              {submitting ? <ActivityIndicator color="#090909" /> : <Text style={styles.buttonText}>Sign in</Text>}
            </Pressable>
            <Text style={styles.note}>V2 foundation preview · existing accounts only</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#090909' },
  flex: { flex: 1 },
  content: { flexGrow: 1, justifyContent: 'center', padding: 22 },
  card: { width: '100%', maxWidth: 460, alignSelf: 'center', backgroundColor: '#171717', borderColor: '#343434', borderWidth: 1, borderRadius: 22, padding: 28, gap: 16 },
  brand: { color: '#F5F1E8', fontSize: 18, fontWeight: '800', letterSpacing: 1.5 },
  gold: { color: '#B99A58' },
  title: { color: '#F5F1E8', fontSize: 30, fontWeight: '800', marginTop: 8 },
  body: { color: '#B4B0A8', fontSize: 15, lineHeight: 21 },
  input: { backgroundColor: '#222222', borderColor: '#414141', borderWidth: 1, borderRadius: 14, color: '#F5F1E8', fontSize: 16, paddingHorizontal: 15, paddingVertical: 14 },
  error: { color: '#F07F75', fontSize: 14, lineHeight: 19 },
  button: { minHeight: 52, borderRadius: 14, backgroundColor: '#B99A58', alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.9 },
  disabled: { opacity: 0.65 },
  buttonText: { color: '#090909', fontSize: 16, fontWeight: '800' },
  note: { color: '#878787', fontSize: 12, textAlign: 'center' }
});