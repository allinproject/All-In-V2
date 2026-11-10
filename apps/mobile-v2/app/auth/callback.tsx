import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../../src/lib/supabase';
import { colors } from '../../src/theme/tokens';

export default function AuthCallbackScreen() {
  const params = useLocalSearchParams<{
    code?: string | string[];
    type?: string | string[];
    error?: string | string[];
    error_description?: string | string[];
  }>();
  const router = useRouter();
  const processed = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (processed.current) return;
    const code = Array.isArray(params.code) ? params.code[0] : params.code;
    const type = Array.isArray(params.type) ? params.type[0] : params.type;
    const callbackError = Array.isArray(params.error_description)
      ? params.error_description[0]
      : (Array.isArray(params.error) ? params.error[0] : (params.error_description ?? params.error));

    if (callbackError) {
      processed.current = true;
      setError('The email link could not be verified. Request a new link and try again.');
      return;
    }
    if (!code) {
      processed.current = true;
      setError('This email link is missing its verification code. Request a new link and open it on this device.');
      return;
    }

    processed.current = true;
    let active = true;
    void supabase.auth.exchangeCodeForSession(code)
      .then(({ error: exchangeError }) => {
        if (!active) return;
        if (exchangeError) {
          setError('This email link is invalid or has expired. Request a new link and try again.');
          return;
        }
        router.replace(type === 'recovery' ? '/reset-password' : '/');
      })
      .catch(() => {
        if (active) setError('The email link could not be verified. Check your connection and request a new link if needed.');
      });
    return () => { active = false; };
  }, [params.code, params.error, params.error_description, params.type, router]);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.content}>
        <Text style={styles.brand}>ALL IN <Text style={styles.gold}>365</Text></Text>
        {error ? (
          <>
            <Text accessibilityRole="header" style={styles.title}>Link verification failed</Text>
            <Text accessibilityRole="alert" style={styles.body}>{error}</Text>
            <Pressable accessibilityRole="button" onPress={() => router.replace('/sign-in')} style={styles.button}>
              <Text style={styles.buttonText}>Back to sign in</Text>
            </Pressable>
          </>
        ) : (
          <>
            <ActivityIndicator color={colors.gold} />
            <Text style={styles.body}>Verifying your secure ALL IN 365 link…</Text>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { flex: 1, justifyContent: 'center', padding: 24, gap: 18 },
  brand: { color: colors.warmWhite, fontSize: 18, fontWeight: '800', letterSpacing: 1.5 },
  gold: { color: colors.gold },
  title: { color: colors.warmWhite, fontSize: 26, fontWeight: '800' },
  body: { color: colors.mutedText, fontSize: 15, lineHeight: 22, textAlign: 'center' },
  button: { minHeight: 50, backgroundColor: colors.gold, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: colors.background, fontWeight: '800' }
});
