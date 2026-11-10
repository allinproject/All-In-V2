import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Redirect, Link } from 'expo-router';
import { supabase } from '../src/lib/supabase';
import { useAuth } from '../src/auth/AuthProvider';
import { colors, radius, spacing } from '../src/theme/tokens';
import type { V2LegalDocument } from '../src/auth/accessGateClient';

function errorMessage(error: unknown) {
  if (error instanceof Error) {
    const text = error.message.toLowerCase();
    if (text.includes('already registered')) return 'An account already exists for that email. Sign in instead.';
    if (text.includes('password')) return 'Check the password requirements and try again.';
    if (text.includes('network') || text.includes('fetch')) return 'V2 could not reach the account service. Check your connection and retry.';
    return error.message;
  }
  return 'Account creation could not be completed. Try again.';
}

export default function SignUpScreen() {
  const { loading, user } = useAuth();
  const [documents, setDocuments] = useState<V2LegalDocument[]>([]);
  const [loadingDocuments, setLoadingDocuments] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [reviewed, setReviewed] = useState<Record<string, boolean>>({});
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const actionId = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    void supabase.from('v2_legal_documents')
      .select('document_key,version,title,content_markdown,content_sha256,effective_at')
      .eq('status', 'published')
      .lte('effective_at', new Date().toISOString())
      .then(({ data, error: readError }) => {
        if (!active) return;
        if (readError) {
          setError('The V2 legal documents could not be loaded. Signup remains unavailable.');
          return;
        }
        const rows = (data ?? []) as V2LegalDocument[];
        const required = ['terms', 'privacy', 'founder_beta_terms'];
        const valid = required.every(key => rows.filter(row => row.document_key === key).length === 1);
        if (!valid || rows.length !== 3) {
          setDocuments([]);
          setError('V2 signup is not open yet. The reviewed Terms, Privacy Policy and Founder Beta Terms must all be published first.');
          return;
        }
        setDocuments(rows);
        setError(null);
      })
      .catch(() => {
        if (active) setError('The V2 legal documents could not be loaded. Signup remains unavailable.');
      })
      .finally(() => {
        if (active) setLoadingDocuments(false);
      });
    return () => { active = false; };
  }, []);

  if (!loading && user) return <Redirect href="/" />;

  const allReviewed = documents.length === 3 && documents.every(doc => reviewed[doc.document_key]);
  const ready = !loadingDocuments && !submitting && documents.length === 3
    && allReviewed && ageConfirmed && email.trim().length > 0 && password.length >= 8;

  async function createAccount() {
    if (!ready || submitting || !documents.length) return;
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      const normalizedEmail = email.trim().toLowerCase();
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: normalizedEmail,
        password,
      });
      if (signUpError) throw signUpError;

      if (data.session) {
        const action = actionId.current ?? `signup-legal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
        actionId.current = action;
        const byKey = new Map(documents.map(doc => [doc.document_key, doc.version]));
        const { error: acceptanceError } = await supabase.rpc('v2_accept_legal_documents', {
          p_terms_version: byKey.get('terms'),
          p_privacy_version: byKey.get('privacy'),
          p_founder_beta_terms_version: byKey.get('founder_beta_terms'),
          p_age_18_confirmed: true,
          p_client_action_id: action,
        });
        if (acceptanceError) throw acceptanceError;
        setNotice('Your V2 account was created and the reviewed legal versions were recorded. Opening ALL IN 365…');
      } else {
        setNotice('Your V2 account request was accepted. Check your email to confirm the address, then sign in to finish the legal acceptance receipt before entering the app.');
      }
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.card}>
            <Text style={styles.brand}>ALL IN <Text style={styles.gold}>365</Text></Text>
            <Text accessibilityRole="header" style={styles.title}>Create your V2 account</Text>
            <Text style={styles.body}>This creates a fresh account in the dedicated ALL IN 365 V2 backend. V1 account credentials and personal history are not imported.</Text>
            {loadingDocuments ? <ActivityIndicator color={colors.gold} /> : null}
            {!loadingDocuments && documents.map(doc => (
              <View key={doc.document_key} style={styles.document}>
                <Text style={styles.documentTitle}>{doc.title} · {doc.version}</Text>
                <ScrollView nestedScrollEnabled style={styles.documentBody}>
                  <Text selectable style={styles.legalText}>{doc.content_markdown}</Text>
                </ScrollView>
                <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: !!reviewed[doc.document_key] }} onPress={() => setReviewed(old => ({ ...old, [doc.document_key]: !old[doc.document_key] }))} style={styles.reviewRow}>
                  <Text style={styles.checkbox}>{reviewed[doc.document_key] ? '☑' : '☐'}</Text>
                  <Text style={styles.reviewText}>I have read and reviewed this document</Text>
                </Pressable>
              </View>
            ))}
            {documents.length === 3 ? (
              <>
                <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: ageConfirmed }} onPress={() => setAgeConfirmed(value => !value)} style={styles.reviewRow}>
                  <Text style={styles.checkbox}>{ageConfirmed ? '☑' : '☐'}</Text>
                  <Text style={styles.reviewText}>I confirm that I am at least 18 years old.</Text>
                </Pressable>
                <TextInput accessibilityLabel="Email" autoCapitalize="none" autoComplete="email" keyboardType="email-address" placeholder="Email" placeholderTextColor={colors.mutedText} style={styles.input} value={email} onChangeText={setEmail} />
                <TextInput accessibilityLabel="Password (at least 8 characters)" autoCapitalize="none" autoComplete="new-password" secureTextEntry placeholder="Password (at least 8 characters)" placeholderTextColor={colors.mutedText} style={styles.input} value={password} onChangeText={setPassword} />
                <Pressable accessibilityRole="button" accessibilityState={{ disabled: !ready, busy: submitting }} disabled={!ready} onPress={() => void createAccount()} style={[styles.button, !ready && styles.disabled]}>
                  {submitting ? <ActivityIndicator color={colors.background} /> : <Text style={styles.buttonText}>Create V2 account</Text>}
                </Pressable>
              </>
            ) : null}
            {notice ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text> : null}
            {error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
            <Text style={styles.footer}>Already have a V2 account? <Link href="/sign-in" style={styles.link}>Sign in</Link></Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  content: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.lg },
  card: { width: '100%', maxWidth: 520, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.card, padding: spacing.lg, gap: spacing.md },
  brand: { color: colors.warmWhite, fontSize: 18, fontWeight: '800', letterSpacing: 1.5 },
  gold: { color: colors.gold },
  title: { color: colors.warmWhite, fontSize: 28, fontWeight: '800' },
  body: { color: colors.mutedText, fontSize: 14, lineHeight: 21 },
  document: { backgroundColor: colors.surfaceRaised, borderColor: colors.border, borderWidth: 1, borderRadius: radius.control, padding: spacing.md, gap: spacing.sm },
  documentTitle: { color: colors.warmWhite, fontSize: 15, fontWeight: '800' },
  documentBody: { maxHeight: 210 },
  legalText: { color: colors.mutedText, fontSize: 13, lineHeight: 20 },
  reviewRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 40 },
  checkbox: { color: colors.gold, fontSize: 22, width: 28 },
  reviewText: { flex: 1, color: colors.warmWhite, fontSize: 14, lineHeight: 20 },
  input: { backgroundColor: colors.surfaceRaised, borderColor: colors.border, borderWidth: 1, borderRadius: radius.control, color: colors.warmWhite, fontSize: 16, paddingHorizontal: 15, paddingVertical: 14 },
  button: { minHeight: 52, borderRadius: radius.control, backgroundColor: colors.gold, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.45 },
  buttonText: { color: colors.background, fontSize: 16, fontWeight: '800' },
  notice: { color: colors.goldSoft, fontSize: 14, lineHeight: 20 },
  error: { color: colors.danger, fontSize: 14, lineHeight: 20 },
  footer: { color: colors.mutedText, fontSize: 13, textAlign: 'center' },
  link: { color: colors.gold, textDecorationLine: 'underline', fontWeight: '700' }
});