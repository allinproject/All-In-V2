import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../../src/lib/supabase';
import { authCallbackRequestKey, resolveAuthCallback } from '../../src/auth/authCallback';
import { colors } from '../../src/theme/tokens';

export default function AuthCallbackScreen() {
  const params = useLocalSearchParams<{
    code?: string | string[];
    type?: string | string[];
    error?: string | string[];
    error_description?: string | string[];
  }>();
  const router = useRouter();
  const exchangeRef = useRef<{ key: string; result: ReturnType<typeof supabase.auth.exchangeCodeForSession> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestKey = authCallbackRequestKey(params);

  useEffect(() => {
    setError(null);
    const resolution = resolveAuthCallback(params);
    if (resolution.kind === 'error') {
      setError(resolution.message);
      return;
    }

    let active = true;
    // Reuse the same exchange across effect restarts (including React Strict Mode).
    // A different incoming link gets its own request and supersedes stale UI results.
    if (exchangeRef.current?.key !== requestKey) {
      exchangeRef.current = {
        key: requestKey,
        result: supabase.auth.exchangeCodeForSession(resolution.code),
      };
    }
    void exchangeRef.current.result
      .then(({ error: exchangeError }) => {
        if (!active) return;
        if (exchangeError) {
          setError('This email link is invalid or has expired. Request a new link and try again.');
          return;
        }
        router.replace(resolution.destination === 'reset-password' ? '/reset-password' : '/');
      })
      .catch(() => {
        if (active) setError('The email link could not be verified. Check your connection and request a new link if needed.');
      });
    return () => { active = false; };
  }, [requestKey, router]);

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
