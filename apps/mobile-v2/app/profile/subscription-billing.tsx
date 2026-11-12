import { useCallback, useState } from 'react';
import { Link, Redirect, useFocusEffect } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../src/auth/AuthProvider';
import { useAccessGate } from '../../src/auth/AccessGateProvider';
import { v2AuthenticatedScreenKey } from '../../src/auth/authRoute';
import { createNativeBillingServerClient } from '../../src/features/subscriptions/nativeBillingServerClient';
import { NativeBillingActions } from '../../src/features/subscriptions/NativeBillingActions';
import { nativeBillingReleaseGate } from '../../src/features/subscriptions/nativeBillingRuntime';
import { supabase } from '../../src/lib/supabase';
import { colors } from '../../src/theme/tokens';

/**
 * ALL-252: account-owned, read-only subscription status.
 * Checkout, restore and store management are intentionally not exposed until
 * ALL-222/264/265/266 release gates and installed-device acceptance pass.
 * Only the trusted billing endpoint can indicate entitlement.
 */
export default function SubscriptionBillingScreen() {
  const { user, sessionGeneration } = useAuth();
  return <OwnedSubscriptionBillingScreen key={v2AuthenticatedScreenKey(user?.id ?? null, sessionGeneration)} />;
}

function OwnedSubscriptionBillingScreen() {
  const { user, loading: authLoading } = useAuth();
  const gate = useAccessGate();
  const ownerId = user?.id ?? null;
  const [status, setStatus] = useState<'checking' | 'entitled' | 'not_entitled' | 'unavailable'>('checking');
  const [retry, setRetry] = useState(0);

  useFocusEffect(useCallback(() => {
    if (!ownerId || authLoading || gate.status !== 'ready') return;
    let active = true;
    setStatus('checking');
    const billing = createNativeBillingServerClient({
      client: supabase.functions,
      getOwner: () => active ? ownerId : null,
    });
    void billing.readOwnerEntitlement(ownerId).then(result => {
      if (active) setStatus(result.entitled ? 'entitled' : 'not_entitled');
    }).catch(() => {
      if (active) setStatus('unavailable');
    });
    return () => { active = false; };
  }, [ownerId, authLoading, gate.status, retry]));

  if (!authLoading && !user) return <Redirect href="/sign-in" />;
  if (gate.status === 'legal_required') return <Redirect href="/legal-acceptance" />;
  if (gate.status === 'onboarding_required') return <Redirect href="/onboarding-required" />;
  if (authLoading || gate.status !== 'ready' || !ownerId) return <Redirect href="/" />;

  const description = status === 'entitled'
    ? 'Your account currently has server-confirmed subscription access.'
    : status === 'not_entitled'
    ? 'No active subscription access was confirmed for this account.'
    : 'Billing status is unavailable. This does not mean your subscription has expired.';

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <Link href="/profile" asChild>
          <Pressable accessibilityRole="button" style={styles.back}>
            <Text style={styles.backText}>‹ Profile</Text>
          </Pressable>
        </Link>
        <Text accessibilityRole="header" style={styles.title}>Subscription & Billing</Text>
        <View style={styles.card}>
          <Text style={styles.heading}>Account access</Text>
          {status === 'checking' ? <ActivityIndicator color={colors.gold} accessibilityLabel="Checking subscription status" /> :
            <Text accessibilityRole="alert" style={styles.body}>{description}</Text>}
          {status !== 'checking' ? (
            <Pressable style={styles.button} accessibilityRole="button" onPress={() => setRetry(n => n + 1)}>
              <Text style={styles.buttonText}>Refresh subscription status</Text>
            </Pressable>
          ) : null}
        </View>
        <View style={styles.card}>
          <Text style={styles.heading}>ALL IN 365 membership</Text>
          <Text style={styles.price}>$9.99 per month</Text>
          <Text style={styles.body}>Eligible new subscribers receive a 7-day free trial. After the trial, the monthly plan renews automatically unless canceled. Taxes and exact storefront terms are shown by the store before purchase.</Text>
          <Text style={styles.body}>Trial eligibility and subscription access must be confirmed by the store and our secure billing service. Returning subscribers are not guaranteed another trial.</Text>
        </View>
        <View style={styles.card}>
          <Text style={styles.heading}>Purchases and restoration</Text>
          <Text style={styles.body}>Native purchases and Restore Purchases are not yet available in this build. No charge can be initiated from this screen.</Text>
          <Text style={styles.body}>Once enabled, iPhone subscriptions will be managed through Apple and Android subscriptions through Google Play. Restoring a purchase will require verification against the original account.</Text>
          {nativeBillingReleaseGate.enabled &&
           nativeBillingReleaseGate.signedNativeBuild &&
           nativeBillingReleaseGate.storeCatalogApproved &&
           nativeBillingReleaseGate.serverSecurityApproved ? (
            <NativeBillingActions ownerId={ownerId}
              onVerified={() => setRetry(value => value + 1)} />
          ) : null}
          <Text style={styles.note}>Your training, nutrition and account data are not deleted simply because subscription access changes.</Text>
        </View>
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
  heading: { color: colors.warmWhite, fontWeight: '800', fontSize: 19 },
  price: { color: colors.goldSoft, fontWeight: '800', fontSize: 24 },
  body: { color: colors.warmWhite, lineHeight: 21, fontSize: 14 },
  note: { color: colors.mutedText, lineHeight: 21, fontSize: 13 },
  button: { minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: colors.warmWhite, fontWeight: '700' },
});
