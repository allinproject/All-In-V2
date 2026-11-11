import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Redirect, useFocusEffect } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../src/auth/AuthProvider';
import { useAccessGate } from '../src/auth/AccessGateProvider';
import { readV2OwnedProfileState } from '../src/auth/accessGateClient';
import { v2AuthenticatedScreenKey } from '../src/auth/authRoute';
import { profileOwnerMatches } from '../src/auth/profileEditor';
import { supabase } from '../src/lib/supabase';
import { colors } from '../src/theme/tokens';

type ProfileSnapshot = {
  profile?: { user_id?: string; display_name?: string | null } | null;
  latest_legal_acceptance?: {
    terms_version?: string; privacy_version?: string; founder_beta_terms_version?: string;
  } | null;
};

export default function ProfileScreen() {
  const { user, sessionGeneration } = useAuth();
  return <OwnedProfileScreen key={v2AuthenticatedScreenKey(user?.id ?? null, sessionGeneration)} />;
}

function OwnedProfileScreen() {
  const { user, loading: authLoading, signOut } = useAuth();
  const gate = useAccessGate();
  const ownerId = user?.id ?? null;
  const [snapshot, setSnapshot] = useState<ProfileSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const mounted = useRef(true);
  const busy = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useFocusEffect(useCallback(() => {
    if (!ownerId || authLoading || gate.status !== 'ready') return;
    let active = true;
    setLoading(true);
    setError(null);
    void readV2OwnedProfileState(supabase, ownerId, () => active && mounted.current)
      .then(raw => {
        if (!active || !mounted.current) return;
        const data = raw as ProfileSnapshot;
        if (!profileOwnerMatches(data.profile, ownerId)) throw new Error('Profile owner does not match your active account.');
        setSnapshot(data);
      }).catch(cause => {
        if (active && mounted.current) setError(cause instanceof Error ? cause.message : 'Could not load this account.');
      }).finally(() => {
        if (active && mounted.current) setLoading(false);
      });
    return () => { active = false; };
  }, [ownerId, authLoading, gate.status, retry]));

  async function handleSignOut() {
    if (busy.current) return;
    busy.current = true;
    setSigningOut(true);
    setError(null);
    try { await signOut(); }
    catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : 'Could not sign out.');
    } finally {
      busy.current = false;
      if (mounted.current) setSigningOut(false);
    }
  }

  if (!authLoading && !user) return <Redirect href="/sign-in" />;
  if (gate.status === 'legal_required') return <Redirect href="/legal-acceptance" />;
  if (gate.status === 'onboarding_required') return <Redirect href="/onboarding-required" />;
  if (authLoading || gate.status !== 'ready' || !ownerId) return <Redirect href="/" />;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Link href="/home" asChild>
          <Pressable accessibilityRole="button" style={styles.back}><Text style={styles.gold}>‹ Today</Text></Pressable>
        </Link>
        <Text style={styles.brand}>ALL IN <Text style={styles.gold}>365</Text></Text>
        <Text accessibilityRole="header" style={styles.title}>Profile</Text>
        {loading ? <ActivityIndicator color={colors.gold} accessibilityLabel="Loading profile" /> : null}
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        {!loading && !snapshot ? (
          <Pressable accessibilityRole="button" style={styles.button} onPress={() => setRetry(n => n + 1)}>
            <Text style={styles.buttonText}>Retry profile</Text>
          </Pressable>
        ) : null}
        {!loading && snapshot ? (
          <>
            <View style={styles.card}>
              <Text style={styles.label}>ACCOUNT EMAIL</Text>
              <Text style={styles.white}>{user.email ?? 'Email unavailable'}</Text>
              <Text style={styles.label}>DISPLAY NAME</Text>
              <Text style={styles.white}>{snapshot.profile?.display_name || 'Not set'}</Text>
              <Link href="/profile/edit" asChild>
                <Pressable accessibilityRole="button" style={styles.primaryButton}>
                  <Text style={styles.primaryText}>Edit Profile</Text>
                </Pressable>
              </Link>
            </View>
            <View style={styles.card}>
              <Text style={styles.section}>Personalize ALL IN</Text>
              <Link href="/profile/sports" asChild>
                <Pressable accessibilityRole="button" style={styles.button}>
                  <Text style={styles.buttonText}>Sports & Interests</Text>
                </Pressable>
              </Link>
              <Text style={styles.muted}>Training Focus and Active Activities</Text>
              <Link href="/profile/kitchen" asChild>
                <Pressable accessibilityRole="button" style={styles.button}>
                  <Text style={styles.buttonText}>Kitchen</Text>
                </Pressable>
              </Link>
              <Text style={styles.muted}>Home equipment, work reheating, and meal-prep constraints</Text>
            </View>
            <View style={styles.card}>
              <Text style={styles.section}>Legal acceptance</Text>
              <Text style={styles.muted}>Accepted versions for this account</Text>
              <Text style={styles.white}>Terms: {snapshot.latest_legal_acceptance?.terms_version ?? 'Not available'}</Text>
              <Text style={styles.white}>Privacy: {snapshot.latest_legal_acceptance?.privacy_version ?? 'Not available'}</Text>
              <Text style={styles.white}>Founder Beta: {snapshot.latest_legal_acceptance?.founder_beta_terms_version ?? 'Not available'}</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityState={{ disabled: signingOut, busy: signingOut }}
              disabled={signingOut} style={styles.button} onPress={() => void handleSignOut()}>
              <Text style={styles.buttonText}>{signingOut ? 'Signing out…' : 'Sign out'}</Text>
            </Pressable>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: 24, paddingBottom: 48, gap: 16 },
  back: { minHeight: 44, justifyContent: 'center' },
  brand: { color: colors.warmWhite, fontWeight: '800', fontSize: 16 },
  gold: { color: colors.goldSoft },
  title: { fontSize: 30, fontWeight: '800', color: colors.warmWhite },
  card: { padding: 18, gap: 12, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  section: { fontSize: 19, fontWeight: '800', color: colors.warmWhite },
  label: { color: colors.mutedText, fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  white: { color: colors.warmWhite, fontSize: 14 },
  muted: { color: colors.mutedText, fontSize: 13 },
  primaryButton: { minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.gold },
  primaryText: { color: colors.background, fontWeight: '800' },
  button: { minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderColor: colors.border, borderWidth: 1, backgroundColor: colors.surfaceRaised },
  buttonText: { color: colors.warmWhite, fontWeight: '700' },
  error: { color: colors.danger, lineHeight: 21 },
});
