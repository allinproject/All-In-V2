import { useCallback, useRef, useState } from 'react';
import { Link, Redirect, useFocusEffect } from 'expo-router';
import { ActivityIndicator, Platform, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../src/auth/AuthProvider';
import { useAccessGate } from '../../src/auth/AccessGateProvider';
import { v2AuthenticatedScreenKey } from '../../src/auth/authRoute';
import { assertV2SessionOwner } from '../../src/auth/accessGateClient';
import { prepareV2AccountExport } from '../../src/features/profile/accountExport';
import { supabase } from '../../src/lib/supabase';
import { colors } from '../../src/theme/tokens';

export default function AccountExportScreen() {
  const { user, sessionGeneration } = useAuth();
  return <OwnedAccountExport key={v2AuthenticatedScreenKey(user?.id ?? null, sessionGeneration)} />;
}

function OwnedAccountExport() {
  const { user, loading: authLoading } = useAuth();
  const gate = useAccessGate();
  const owner = user?.id ?? null;
  const mounted = useRef(false);
  const busy = useRef(false);
  const [confirming, setConfirming] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(useCallback(() => {
    mounted.current = true;
    setConfirming(false);
    setError(null);
    return () => { mounted.current = false; };
  }, [owner]));

  async function shareSnapshot() {
    if (!owner || !mounted.current || busy.current || sharing || !confirming || gate.status !== 'ready') return;
    if (Platform.OS === 'web') {
      setError('Native sharing is available in the mobile app. Secure file download is not available yet.');
      return;
    }
    busy.current = true;
    setSharing(true);
    setError(null);
    try {
      await assertV2SessionOwner(supabase, owner);
      const { data, error: rpcError } = await supabase.rpc('v2_export_my_account_snapshot', {
        p_expected_user_id: owner,
      });
      if (rpcError) throw rpcError;
      const json = prepareV2AccountExport(data, owner);
      // The account may have changed during the request; never release old-owner data.
      await assertV2SessionOwner(supabase, owner);
      if (!mounted.current) return;
      await Share.share({
        title: 'ALL IN 365 account data (JSON)',
        message: json,
      });
      if (mounted.current) setConfirming(false);
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : 'Could not prepare the account export.');
    } finally {
      busy.current = false;
      if (mounted.current) setSharing(false);
    }
  }

  if (!authLoading && !user) return <Redirect href="/sign-in" />;
  if (gate.status === 'legal_required') return <Redirect href="/legal-acceptance" />;
  if (gate.status === 'onboarding_required') return <Redirect href="/onboarding-required" />;
  if (authLoading || gate.status !== 'ready' || !user) return <Redirect href="/" />;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <Link href="/profile" asChild>
          <Pressable accessibilityRole="button" style={styles.back}>
            <Text style={styles.gold}>‹ Profile</Text>
          </Pressable>
        </Link>
        <Text accessibilityRole="header" style={styles.title}>Export my data</Text>
        <View style={styles.card}>
          <Text style={styles.heading}>Your ALL IN 365 data</Text>
          <Text style={styles.body}>You can share a JSON text snapshot of the account information currently stored in V2, including your profile, settings, onboarding, legal acceptance, and any health considerations you entered.</Text>
          <Text style={styles.body}>This is not a downloadable file or a complete long-term archive. It does not yet include future activity, media, or connected-service data. If more data types are added without export support, the export will refuse to proceed instead of silently leaving them out.</Text>
          <Text style={styles.body}>Your export may contain sensitive personal information. Only share it with an app or person you trust. ALL IN 365 does not save a local export file with this action.</Text>
        </View>
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        <View style={styles.card}>
          {!confirming ? (
            <Pressable accessibilityRole="button" style={styles.button} onPress={() => setConfirming(true)}>
              <Text style={styles.buttonText}>Review sharing confirmation</Text>
            </Pressable>
          ) : (
            <>
              <Text style={styles.heading}>Share private account data?</Text>
              <Text style={styles.body}>This will fetch your current account data and open your device's share sheet with the JSON text. You choose where it goes. Nothing is exported automatically.</Text>
              <Pressable accessibilityRole="button" accessibilityState={{disabled:sharing,busy:sharing}}
                disabled={sharing} style={styles.button} onPress={() => void shareSnapshot()}>
                {sharing ? <ActivityIndicator color={colors.gold} /> : <Text style={styles.buttonText}>Share JSON account data</Text>}
              </Pressable>
              <Pressable accessibilityRole="button" disabled={sharing} style={styles.button}
                onPress={() => setConfirming(false)}>
                <Text style={styles.buttonText}>Keep my data private</Text>
              </Pressable>
            </>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: 24, paddingBottom: 48, gap: 16 },
  back: { minHeight: 44, justifyContent: 'center' },
  gold: { color: colors.gold },
  title: { color: colors.warmWhite, fontSize: 28, fontWeight: '800' },
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: 16, backgroundColor: colors.surface, padding: 16, gap: 12 },
  heading: { color: colors.warmWhite, fontSize: 18, fontWeight: '800' },
  body: { color: colors.mutedText, fontSize: 14, lineHeight: 21 },
  error: { color: colors.danger, fontSize: 14, lineHeight: 20 },
  button: { minHeight: 48, padding: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 12, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.surfaceRaised },
  buttonText: { color: colors.warmWhite, fontWeight: '700' },
});
