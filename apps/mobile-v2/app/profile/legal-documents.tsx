import { useEffect, useState } from 'react';
import { Link, Redirect } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../src/auth/AuthProvider';
import { useAccessGate } from '../../src/auth/AccessGateProvider';
import { v2AuthenticatedScreenKey } from '../../src/auth/authRoute';
import { assertV2SessionOwner, parsePublishedV2LegalDocuments, type V2LegalDocument } from '../../src/auth/accessGateClient';
import { supabase } from '../../src/lib/supabase';
import { colors } from '../../src/theme/tokens';

/** Read-only exact current legal documents. No consent or publication writes. */
export default function LegalDocumentsScreen() {
  const { user, sessionGeneration } = useAuth();
  return <OwnedLegalDocumentsScreen key={v2AuthenticatedScreenKey(user?.id ?? null, sessionGeneration)} />;
}

function OwnedLegalDocumentsScreen() {
  const { user, loading: authLoading } = useAuth();
  const gate = useAccessGate();
  const ownerId = user?.id ?? null;
  const [documents, setDocuments] = useState<V2LegalDocument[] | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!ownerId || authLoading || gate.status !== 'ready') return;
    let active = true;
    setBusy(true);
    setError(null);
    setDocuments(null);
    void (async () => {
      await assertV2SessionOwner(supabase, ownerId);
      const { data, error: readError } = await supabase.from('v2_legal_documents')
        .select('document_key,version,title,content_markdown,content_sha256,effective_at')
        .eq('status', 'published')
        .lte('effective_at', new Date().toISOString());
      if (readError) throw new Error('Current legal documents could not be retrieved.');
      const current = parsePublishedV2LegalDocuments(data);
      await assertV2SessionOwner(supabase, ownerId);
      if (active) setDocuments(current);
    })().catch(cause => {
      if (active) setError(cause instanceof Error ? cause.message : 'Legal documents are unavailable.');
    }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [ownerId, authLoading, gate.status, retry]);

  if (!authLoading && !user) return <Redirect href="/sign-in" />;
  if (gate.status === 'legal_required') return <Redirect href="/legal-acceptance" />;
  if (gate.status === 'onboarding_required') return <Redirect href="/onboarding-required" />;
  if (authLoading || gate.status !== 'ready' || !ownerId) return <Redirect href="/" />;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <Link href="/profile" asChild>
          <Pressable accessibilityRole="button" style={styles.back}><Text style={styles.backText}>‹ Profile</Text></Pressable>
        </Link>
        <Text accessibilityRole="header" style={styles.title}>Current legal documents</Text>
        <Text style={styles.note}>These are the exact documents currently published for ALL IN 365 V2. Viewing them does not change your legal acceptance.</Text>
        {busy ? <ActivityIndicator accessibilityLabel="Loading legal documents" color={colors.gold} /> : null}
        {error ? (
          <View style={styles.card}>
            <Text accessibilityRole="alert" style={styles.warning}>{error}</Text>
            <Pressable accessibilityRole="button" style={styles.button} onPress={() => setRetry(n => n + 1)}>
              <Text style={styles.buttonText}>Retry</Text>
            </Pressable>
          </View>
        ) : null}
        {documents?.map(doc => (
          <View key={doc.document_key + ':' + doc.version} style={styles.card}>
            <Text accessibilityRole="header" style={styles.heading}>{doc.title}</Text>
            <Text style={styles.meta}>Version {doc.version} · Effective {doc.effective_at.slice(0, 10)}</Text>
            <Text selectable style={styles.body}>{doc.content_markdown}</Text>
          </View>
        ))}
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
  note: { color: colors.mutedText, lineHeight: 21, fontSize: 14 },
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: 16, backgroundColor: colors.surface, padding: 16, gap: 12 },
  heading: { color: colors.warmWhite, fontWeight: '800', fontSize: 19 },
  meta: { color: colors.goldSoft, fontSize: 12 },
  body: { color: colors.warmWhite, lineHeight: 21, fontSize: 14 },
  warning: { color: colors.danger, lineHeight: 21 },
  button: { paddingVertical: 14, borderWidth: 1, borderColor: colors.border, borderRadius: 12, alignItems: 'center' },
  buttonText: { color: colors.warmWhite, fontWeight: '700' },
});
