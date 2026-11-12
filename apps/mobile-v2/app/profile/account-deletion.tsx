import { useCallback, useRef, useState } from 'react';
import { Link, Redirect, useFocusEffect } from 'expo-router';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../src/auth/AuthProvider';
import { v2AuthenticatedScreenKey } from '../../src/auth/authRoute';
import { assertV2SessionOwner } from '../../src/auth/accessGateClient';
import { supabase } from '../../src/lib/supabase';
import { colors } from '../../src/theme/tokens';

type RequestStatus = 'none' | 'requested' | 'processing' | 'completed' | 'rejected' | 'cancelled';
type RequestSnapshot = { status: RequestStatus; requestId: string | null; requestedAt: string | null };

function parseRequest(value: unknown): RequestSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Deletion request status is unavailable.');
  const raw = value as Record<string, unknown>;
  const allowed = ['none', 'requested', 'processing', 'completed', 'rejected', 'cancelled'];
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
  const { user, loading: authLoading, signOut } = useAuth();
  const owner = user?.id ?? null;
  const mounted = useRef(false);
  const inFlight = useRef(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<RequestSnapshot | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [cancelReviewing, setCancelReviewing] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [retry, setRetry] = useState(0);

  const readCurrent = useCallback(async (isCurrent: () => boolean) => {
    if (!owner) throw new Error('Sign in to view account deletion.');
    await assertV2SessionOwner(supabase, owner);
    const { data, error: readError } = await supabase.rpc('v2_my_account_deletion_request', { p_expected_user_id: owner });
    if (readError) throw readError;
    await assertV2SessionOwner(supabase, owner);
    const snapshot = parseRequest(data);
    if (isCurrent()) setStatus(snapshot);
    return snapshot;
  }, [owner]);

  useFocusEffect(useCallback(() => {
    if (!owner || authLoading) return;
    mounted.current = true;
    let active = true;
    setLoading(true);
    setStatus(null);
    setError(null);
    setReviewing(false);
    setCancelReviewing(false);
    setConfirmation('');
    void readCurrent(() => active && mounted.current).catch(cause => {
      if (active && mounted.current) setError(cause instanceof Error ? cause.message : 'Could not load deletion request.');
    }).finally(() => {
      if (active && mounted.current) setLoading(false);
    });
    return () => { active = false; mounted.current = false; };
  }, [owner, authLoading, retry, readCurrent]));

  async function submitRequest() {
    if (inFlight.current || saving || !owner || !reviewing || confirmation !== 'DELETE MY ACCOUNT' || !['none', 'rejected', 'cancelled'].includes(status?.status ?? '')) return;
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
      // If the write committed but the response was lost, a fresh owner-bound
      // status read is authoritative. Do not show a false failure or retry.
      let reconciled = false;
      try {
        const latest = await readCurrent(() => mounted.current);
        reconciled = latest.status === 'requested' || latest.status === 'processing';
      } catch {
        // Uncertain outcome stays visible; no automatic write retry.
      }
      if (mounted.current && reconciled) {
        setReviewing(false);
        setConfirmation('');
      } else if (mounted.current) {
        setError(cause instanceof Error ? cause.message : 'Could not verify account deletion request. Reload before trying again.');
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setSaving(false);
    }
  }

  async function cancelRequest() {
    const requestId = status?.requestId;
    if (inFlight.current || saving || !owner || !requestId || status?.status !== 'requested' || !cancelReviewing) return;
    inFlight.current = true;
    setSaving(true);
    setError(null);
    try {
      await assertV2SessionOwner(supabase, owner);
      const { data, error: cancelError } = await supabase.rpc('v2_cancel_account_deletion_request', {
        p_expected_user_id: owner,
        p_expected_request_id: requestId,
      });
      if (cancelError) throw cancelError;
      await assertV2SessionOwner(supabase, owner);
      const receipt = parseRequest(data);
      if (receipt.status !== 'cancelled' || receipt.requestId !== requestId) {
        throw new Error('Cancellation status requires review.');
      }
      if (mounted.current) {
        setStatus(receipt);
        setCancelReviewing(false);
      }
    } catch (cause) {
      // A cancelled receipt can be lost; reconcile exact owner and request ID.
      let reconciled = false;
      try {
        const latest = await readCurrent(() => mounted.current);
        reconciled = latest.status === 'cancelled' && latest.requestId === requestId;
      } catch { /* No automatic retry. */ }
      if (mounted.current && reconciled) {
        setCancelReviewing(false);
      } else if (mounted.current) {
        setError(cause instanceof Error ? cause.message : 'Cancellation status uncertain. Reload before retrying.');
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setSaving(false);
    }
  }

  if (!authLoading && !user) return <Redirect href="/sign-in" />;
  if (authLoading || !user) return <Redirect href="/" />;

  const activeRequest = status && status.status !== 'none';
  const canRequest = status?.status === 'none' || status?.status === 'cancelled' || status?.status === 'rejected';
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
          <Text style={styles.body}>Deleting your ALL IN 365 account does not cancel an Apple App Store or Google Play subscription. Those subscriptions can continue billing until you cancel them with the store. You can request account deletion now without waiting for the subscription to end.</Text>
          <Pressable accessibilityRole="link" style={styles.button} onPress={() => void Linking.openURL('https://apps.apple.com/account/subscriptions').catch(() => setError('Could not open Apple subscription management.'))}>
            <Text style={styles.buttonText}>Manage Apple subscriptions</Text>
          </Pressable>
          <Pressable accessibilityRole="link" style={styles.button} onPress={() => void Linking.openURL('https://play.google.com/store/account/subscriptions').catch(() => setError('Could not open Google Play subscriptions.'))}>
            <Text style={styles.buttonText}>Manage Google Play subscriptions</Text>
          </Pressable>
          <Text style={styles.body}>Web subscriptions require separate cancellation confirmation; contact support if you have one. Retained payment records are limited to justified financial and legal needs. Deletion will not restore a deleted account or its fitness history.</Text>
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
        {!loading && error ? (
          <Pressable accessibilityRole="button" style={styles.button} onPress={() => void signOut().catch(() => setError('Could not sign out. Try again from the sign-in screen.'))}>
            <Text style={styles.buttonText}>Sign out</Text>
          </Pressable>
        ) : null}
        {!loading && activeRequest ? (
          <View style={styles.card}>
            <Text accessibilityRole="header" style={styles.heading}>Deletion request {status.status}</Text>
            <Text style={styles.body}>
              {status.status === 'completed'
                ? 'The deletion processor reports that this request is complete. You may need to sign out before using another account.'
                : status.status === 'processing'
                  ? 'Deletion processing has started. Cancellation is no longer available.'
                  : status.status === 'requested'
                    ? 'Your deletion request has been recorded. Your account has not yet been erased.'
                    : status.status === 'cancelled'
                      ? 'This deletion request was cancelled. Your account is unchanged.'
                      : 'This request was rejected. Your account has not been erased.'}
            </Text>
            {status.requestedAt ? <Text selectable style={styles.meta}>Requested: {status.requestedAt}</Text> : null}
            {status.requestId ? <Text selectable style={styles.meta}>Request ID: {status.requestId}</Text> : null}
            {status.status === 'requested' ? (
              cancelReviewing ? (
                <>
                  <Text style={styles.body}>Cancel this pending request? Cancellation is only allowed before processing starts. A newer request cannot be cancelled with this request ID.</Text>
                  <Pressable accessibilityRole="button"
                    accessibilityState={{ disabled: saving, busy: saving }} disabled={saving}
                    style={styles.button} onPress={() => void cancelRequest()}>
                    <Text style={styles.buttonText}>{saving ? 'Checking cancellation…' : 'Confirm cancellation'}</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" disabled={saving} style={styles.button}
                    onPress={() => setCancelReviewing(false)}>
                    <Text style={styles.buttonText}>Keep deletion request</Text>
                  </Pressable>
                </>
              ) : (
                <Pressable accessibilityRole="button" disabled={saving} style={styles.button}
                  onPress={() => setCancelReviewing(true)}>
                  <Text style={styles.buttonText}>Cancel pending deletion request</Text>
                </Pressable>
              )
            ) : null}
            {status.status === 'cancelled' ? <Text style={styles.body}>This request was cancelled before processing. You can submit a new request below if needed.</Text> : null}
            {status.status === 'rejected' ? <Text style={styles.body}>This request was not accepted for processing. You can submit a new request below if needed.</Text> : null}
          </View>
        ) : null}
        {!loading && canRequest && !error ? (
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
