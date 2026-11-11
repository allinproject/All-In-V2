import { useCallback, useRef, useState } from 'react';
import { Link, Redirect, useFocusEffect } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../src/auth/AuthProvider';
import { useAccessGate } from '../../src/auth/AccessGateProvider';
import { v2AuthenticatedScreenKey } from '../../src/auth/authRoute';
import { assertV2SessionOwner } from '../../src/auth/accessGateClient';
import { supabase } from '../../src/lib/supabase';
import { colors } from '../../src/theme/tokens';

type RequestStatus = 'none' | 'requested' | 'processing' | 'completed' | 'rejected';
type RequestSnapshot = { status: RequestStatus; requestId: string | null; requestedAt: string | null };

function parseRequest(value: unknown): RequestSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Deletion request status is unavailable.');
  const raw = value as Record<string, unknown>;
  const allowed = ['none', 'requested', 'processing', 'completed', 'rejected'];
  if (!allowed.includes(raw.status as string)) throw new Error('Deletion request status is invalid.');
  if (raw.status !== 'none' && (typeof raw.request_id !== 'string' || typeof raw.requested_at !== 'string')) {
    throw new Error('Deletion request receipt is incomplete.');
  }
  return {
    status: raw.status as RequestStatus,
    requestId: typeof raw.request_id === 'string' ? raw.request_id : null,
    requestedAt: typeof raw.requested_at === 'string' ? raw.requested_at : null,
  };
}

/** Intake and status only. Actual data erasure requires a separately verified processor. */
export default function AccountDeletionScreen() {
  const { user, sessionGeneration } = useAuth();
  return <OwnedAccountDeletionScreen key={v2AuthenticatedScreenKey(user?.id ?? null, sessionGeneration)} />;
}

function OwnedAccountDeletionScreen() {
  const { user, loading: authLoading } = useAuth();
  const gate = useAccessGate();
  const owner = user?.id ?? null;
  const mounted = useRef(false);
  const inFlight = useRef(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<RequestSnapshot | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [retry, setRetry] = useState(0);

  const readCurrent = useCallback(async (isCurrent: () => boolean) => {
    if (!owner) throw new Error('Sign in to view account deletion.');
    await assertV2SessionOwner(supabase, owner);
    const { data, error: readError } = await supabase.rpc('v2_my_account_deletion_request', { p_expected_user_id: owner });
    if (readError) throw readError;
    await assertV2SessionOwner(supabase, owner);
    if (isCurrent()) setStatus(parseRequest(data));
  }, [owner]);

  useFocusEffect(useCallback(() => {
    if (!owner || authLoading || gate.status !== 'ready') return;
    mounted.current = true;
    let active = true;
    setLoading(true);
    setStatus(null);
    setError(null);
    setReviewing(false);
    setConfirmation('');
    void readCurrent(() => active && mounted.current).catch(cause => {
      if (active && mounted.current) setError(cause instanceof Error ? cause.message : 'Could not load deletion request.');
    }).finally(() => {
      if (active && mounted.current) setLoading(false);
    });
    return () => { active = false; mounted.current = false; };
  }, [owner, authLoading, gate.status, retry, readCurrent]));

  async function submitRequest() {
    if (inFlight.current || saving || !owner || !reviewing || confirmation !== 'DELETE MY ACCOUNT' || status?.status !== 'none') return;
    inFlight.current = true;
    setSaving(true);
    setError(null);
    try {
      await assertV2SessionOwner(supabase, owner);
      const { data, error: writeError } = await supabase.rpc('v2_request_account_deletion', {
        p_expected_user_id: owner,
        p_confirm: confirmation,
      });
      if (writeError) throw writeError;
      await assertV2SessionOwner(supabase, owner);
      const receipt = parseRequest(data);
      if (receipt.status !== 'requested' && receipt.status !== 'processing') throw new Error('Request status requires review.');
      if (mounted.current) {
        setStatus(receipt);
        setReviewing(false);
        setConfirmation('');
      }
    } catch (cause) {
      // Lost responses can have committed the request; always reread before suggesting retry.
      try {
        await readCurrent(() => mounted.current);
      } catch {
        // Keep the error visible; do not issue a second write automatically.
      }
      if (mounted.current) setError(cause instanceof Error ? cause.message : 'Could not verify account deletion request. Reload before trying again.');
    } finally {
      inFlight.current = false;
      if (mounted.current) setSaving(false);
    }
  }

  if (!authLoading && !user) return <Redirect href="/sign-in" />;
  if (gate.status === 'legal_required') return <Redirect href="/legal-acceptance" />;
  if (gate.status === 'onboarding_required') return <Redirect href="/onboarding-required" />;
  if (authLoading || gate.status !== 'ready' || !user) return <Redirect href="/" />;

  const activeRequest = status && status.status !== 'none';
  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Link href="/profile" asChild>
          <Pressable accessibilityRole="button" style={styles.back}>
            <Text style={styles.backText}>‹ Profile</Text>
          </Pressable>
        </Link>
        <Text accessibilityRole="header" style={styles.title}>Delete account</Text>
        <View style={styles.card}>
          <Text style={styles.heading}>Understand what will happen</Text>
          <Text style={styles.body}>You can request permanent deletion of your ALL IN 365 V2 account and eligible personal data. You may lose access to your saved workouts, nutrition, settings, and progress once deletion is processed. Some information may be retained where legally required or otherwise permitted.</Text>
          <Text style={styles.body}>This action submits a deletion request. It does not immediately erase anything. The secure deletion processor is not enabled yet, and this beta flow is not validated for public release.</Text>
          <Text style={styles.body}>Questions or help: durbenventures@gmail.com</Text>
        </View>
        {loading ? <ActivityIndicator accessibilityLabel="Loading deletion status" color={colors.gold} /> : null}
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        {!loading && error ? (
          <Pressable accessibilityRole="button" style={styles.button} onPress={() => setRetry(n => n + 1)}>
            <Text style={styles.buttonText}>Reload request status</Text>
          </Pressable>
        ) : null}
        {!loading && activeRequest ? (
          <View style={styles.card}>
            <Text accessibilityRole="header" style={styles.heading}>Deletion request {status.status}</Text>
            <Text style={styles.body}>Your request is recorded. Your account and data have not been erased by this screen.</Text>
            {status.requestedAt ? <Text selectable style={styles.meta}>Requested: {status.requestedAt}</Text> : null}
            {status.requestId ? <Text selectable style={styles.meta}>Request ID: {status.requestId}</Text> : null}
          </View>
        ) : null}
        {!loading && status?.status === 'none' && !error ? (
          <View style={styles.card}>
            {!reviewing ? (
              <Pressable accessibilityRole="button" style={styles.button} onPress={() => setReviewing(true)}>
                <Text style={styles.buttonText}>Request account deletion</Text>
              </Pressable>
            ) : (
              <>
                <Text style={styles.heading}>Confirm deletion request</Text>
                <Text style={styles.body}>To submit your request, type DELETE MY ACCOUNT below. Nothing is deleted immediately.</Text>
                <TextInput
                  accessibilityLabel="Type DELETE MY ACCOUNT to confirm"
                  value={confirmation}
                  onChangeText={setConfirmation}
                  placeholder="DELETE MY ACCOUNT"
                  placeholderTextColor={colors.mutedText}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  style={styles.input}
                  editable={!saving}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ disabled: saving || confirmation !== 'DELETE MY ACCOUNT', busy: saving }}
                  disabled={saving || confirmation !== 'DELETE MY ACCOUNT'}
                  style={styles.button}
                  onPress={() => void submitRequest()}>
                  <Text style={styles.buttonText}>{saving ? 'Recording request…' : 'Submit deletion request'}</Text>
                </Pressable>
                <Pressable accessibilityRole="button" disabled={saving} style={styles.button} onPress={() => { setReviewing(false); setConfirmation(''); }}>
                  <Text style={styles.buttonText}>Cancel — keep my account</Text>
                </Pressable>
              </>
            )}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: 24, paddingBottom: 48, gap: 16 },
  back: { minHeight: 44, justifyContent: 'center' },
  backText: { color: colors.gold },
  title: { color: colors.warmWhite, fontSize: 28, fontWeight: '800' },
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: 16, backgroundColor: colors.surface, padding: 16, gap: 12 },
  heading: { color: colors.warmWhite, fontSize: 18, fontWeight: '800' },
  body: { color: colors.mutedText, fontSize: 14, lineHeight: 21 },
  meta: { color: colors.goldSoft, fontSize: 12, lineHeight: 18 },
  error: { color: colors.danger, fontSize: 14, lineHeight: 20 },
  button: { minHeight: 48, padding: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 12, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.surfaceRaised },
  buttonText: { color: colors.warmWhite, fontWeight: '700' },
  input: { minHeight: 48, borderRadius: 12, borderColor: colors.border, borderWidth: 1, paddingHorizontal: 14, color: colors.warmWhite, backgroundColor: colors.surfaceRaised },
});
