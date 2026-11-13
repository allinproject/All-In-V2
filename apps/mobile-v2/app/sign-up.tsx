import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Redirect, Link } from 'expo-router';
import { getV2EmailAuthRedirectUrl } from '../src/auth/emailAuthRedirectRuntime';
import { supabase } from '../src/lib/supabase';
import { useAuth } from '../src/auth/AuthProvider';
import { canStartV2SignedOutAction, createV2AuthActionGuard } from '../src/auth/authRoute';
import { colors } from '../src/theme/tokens';
import { assertV2SessionOwner, assertV2SignupLegalSnapshotCurrent, parsePublishedV2LegalDocuments, v2LegalReviewKey, v2SignupAcceptanceRetryScope, v2SignupConsentScope, type V2LegalDocument } from '../src/auth/accessGateClient';
import { meetsV2PasswordMinimum } from '../src/auth/passwordPolicy';

function errorMessage(error: unknown) {
  if (error instanceof Error) {
    const text = error.message.toLowerCase();
    if (text.includes('already registered')) return 'An account already exists for that email. Sign in instead.';
    if (text.includes('password')) return 'Check the password requirements and try again.';
    if (text.includes('network') || text.includes('fetch')) return 'ALL IN 365 could not reach the account service. Check your connection and retry.';
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
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [reviewed, setReviewed] = useState<Record<string, boolean>>({});
  const [openDocument, setOpenDocument] = useState<V2LegalDocument | null>(null);
  const [ageConfirmedScope, setAgeConfirmedScope] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submittedRegistrationScope, setSubmittedRegistrationScope] = useState<string | null>(null);
  const pendingAcceptance = useRef<{ scope: string; id: string } | null>(null);
  const requestGuard = useRef(createV2AuthActionGuard());

  useEffect(() => {
    let active = true;
    void Promise.resolve(supabase.from('v2_legal_documents')
      .select('document_key,version,title,content_markdown,content_sha256,effective_at')
      .eq('status', 'published')
      .lte('effective_at', new Date().toISOString()))
      .then(({ data, error: readError }) => {
        if (!active) return;
        if (readError) {
          setError('Registration is temporarily unavailable. Please check back soon.');
          return;
        }
        try {
          setDocuments(parsePublishedV2LegalDocuments(data));
          setError(null);
        } catch {
          setDocuments([]);
          setError(null);
        }
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

  const reviewKey = (doc: V2LegalDocument) => v2LegalReviewKey('signup', doc);
  const reviewScope = v2SignupConsentScope(email, documents);
  const ageConfirmed = ageConfirmedScope === reviewScope;
  const allReviewed = documents.length === 3 && documents.every(doc => reviewed[reviewKey(doc)]);
  const ready = canStartV2SignedOutAction(loading, user?.id ?? null) && !loadingDocuments && !submitting
    && submittedRegistrationScope !== reviewScope && documents.length === 3
    && allReviewed && ageConfirmed && email.trim().length > 0 && meetsV2PasswordMinimum(password);

  async function createAccount() {
    if (!ready || submitting || !documents.length || !requestGuard.current.tryEnter()) return;
    const submittedEmail = email.trim().toLowerCase();
    const submittedPassword = password;
    const reviewedDocuments = documents;
    const submittedScope = reviewScope;
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      const { data: currentSession, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      if (currentSession.session) {
        throw new Error('An account is already signed in. Sign out before creating another account.');
      }

      // A publication may have changed since signup first displayed the legal text.
      // Never create an account using a stale consent snapshot.
      const { data: currentLegal, error: legalError } = await supabase.from('v2_legal_documents')
        .select('document_key,version,title,content_markdown,content_sha256,effective_at')
        .eq('status', 'published')
        .lte('effective_at', new Date().toISOString());
      if (legalError) throw new Error('The current V2 legal documents could not be verified. Check your connection and retry.');
      try {
        assertV2SignupLegalSnapshotCurrent(reviewedDocuments, currentLegal);
      } catch (legalSnapshotError) {
        // Refresh or close signup rather than allowing stale checkmarks to be submitted.
        try {
          setDocuments(parsePublishedV2LegalDocuments(currentLegal));
        } catch {
          setDocuments([]);
        }
        setReviewed({});
        setAgeConfirmedScope(null);
        throw legalSnapshotError;
      }

      const { data, error: signUpError } = await supabase.auth.signUp({
        email: submittedEmail,
        password: submittedPassword,
        options: {
          emailRedirectTo: getV2EmailAuthRedirectUrl(),
        },
      });
      if (signUpError) throw signUpError;

      if (data.session) {
        await assertV2SessionOwner(supabase, data.session.user.id);
        const acceptanceScope = v2SignupAcceptanceRetryScope(submittedScope, data.session.user.id);
        const action = pendingAcceptance.current?.scope === acceptanceScope
          ? pendingAcceptance.current.id
          : `signup-legal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
        pendingAcceptance.current = { scope: acceptanceScope, id: action };
        const byKey = new Map(reviewedDocuments.map(doc => [doc.document_key, doc.version]));
const termsVersion = byKey.get('terms');
const privacyVersion = byKey.get('privacy');
const founderBetaVersion = byKey.get('founder_beta_terms');

if (!termsVersion || !privacyVersion || !founderBetaVersion) {
  throw new Error('Required legal versions are missing.');
}
        const { error: acceptanceError } = await supabase.rpc('v2_accept_legal_documents', {
          p_expected_user_id: data.session.user.id,
          p_terms_version: termsVersion,
p_privacy_version: privacyVersion,
p_founder_beta_terms_version: founderBetaVersion,
          p_age_18_confirmed: true,
          p_client_action_id: action,
        });
        if (acceptanceError) throw acceptanceError;
        await assertV2SessionOwner(supabase, data.session.user.id);
        pendingAcceptance.current = null;
        setNotice('Your account was created and your legal acceptance was recorded. Opening ALL IN 365…');
      } else {
        setSubmittedRegistrationScope(submittedScope);
        setNotice('Check your email to confirm your account, then sign in to finish setup.');
      }
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      requestGuard.current.leave();
      setSubmitting(false);
    }
  }

  const registrationOpen = !loadingDocuments && documents.length === 3;
  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.screen}>
            <Image source={require('../assets/all-in-365-circle.jpg')} accessibilityLabel="ALL IN 365 circular logo" resizeMode="contain" style={styles.logo} />
            <Text style={styles.slogan}>LIVE ALL IN.</Text>
            <Text accessibilityRole="header" style={styles.title}>Create your account</Text>
            <Text style={styles.body}>Your whole fitness life in one place.</Text>

            {!registrationOpen && !loadingDocuments ? (
              <View style={styles.registrationNotice}>
                <Text style={styles.registrationTitle}>Registration isn't open yet.</Text>
                <Text style={styles.registrationDescription}>We're preparing ALL IN 365 for our first members. Account creation will be available soon.</Text>
              </View>
            ) : null}
            {loadingDocuments ? <ActivityIndicator accessibilityLabel="Checking registration availability" color={colors.gold} /> : null}

            <View style={styles.fields}>
              <Text style={styles.fieldLabel}>Email address</Text>
              <TextInput accessibilityLabel="Email" editable={!submitting} autoCapitalize="none" autoComplete="email" keyboardType="email-address" placeholder="you@example.com" placeholderTextColor={colors.mutedText} style={styles.input} value={email} onChangeText={value => { if (requestGuard.current.isBusy()) return; setEmail(value); }} />
              <Text style={styles.fieldLabel}>Password</Text>
              <View style={styles.passwordRow}>
                <TextInput accessibilityLabel="Password (at least 12 characters)" editable={!submitting} autoCapitalize="none" autoComplete="new-password" secureTextEntry={!passwordVisible} placeholder="At least 12 characters" placeholderTextColor={colors.mutedText} style={styles.passwordInput} value={password} onChangeText={value => { if (requestGuard.current.isBusy()) return; setPassword(value); }} />
                <Pressable accessibilityRole="button" accessibilityLabel={passwordVisible ? 'Hide password' : 'Show password'} disabled={submitting} accessibilityState={{disabled: submitting}} onPress={() => setPasswordVisible(value => !value)} style={styles.visibilityToggle}>
                  <Text style={styles.visibilityText}>{passwordVisible ? 'Hide' : 'Show'}</Text>
                </Pressable>
              </View>
              <Text style={styles.passwordHint}>Use at least 12 characters to protect your account.</Text>
            </View>

            {registrationOpen ? (
              <View style={styles.legalSection}>
                <Text style={styles.legalHeading}>Review and accept</Text>
                <Text style={styles.legalIntro}>Read each document before continuing. Your acceptance is required to create an account.</Text>
                {documents.map(doc => (
                  <View key={reviewKey(doc)} style={styles.legalLine}>
                    <Pressable accessibilityRole="checkbox" accessibilityLabel={`I agree to ${doc.title}`} accessibilityState={{ checked: !!reviewed[reviewKey(doc)], disabled: submitting }} disabled={submitting} onPress={() => { if (requestGuard.current.isBusy()) return; setReviewed(old => ({ ...old, [reviewKey(doc)]: !old[reviewKey(doc)] })); }} style={styles.reviewRow}>
                      <Text style={styles.checkbox}>{reviewed[reviewKey(doc)] ? '☑' : '☐'}</Text>
                      <Text style={styles.reviewText}>I agree to {doc.title}</Text>
                    </Pressable>
                    <Pressable accessibilityRole="button" accessibilityLabel={`Read ${doc.title}`} onPress={() => setOpenDocument(doc)} style={styles.readLink}>
                      <Text style={styles.readLinkText}>Read</Text>
                    </Pressable>
                  </View>
                ))}
                <Pressable accessibilityRole="checkbox" accessibilityState={{checked: ageConfirmed, disabled: submitting}} disabled={submitting} onPress={() => { if (requestGuard.current.isBusy()) return; setAgeConfirmedScope(current => current === reviewScope ? null : reviewScope); }} style={styles.reviewRow}>
                  <Text style={styles.checkbox}>{ageConfirmed ? '☑' : '☐'}</Text>
                  <Text style={styles.reviewText}>I confirm that I am at least 18 years old.</Text>
                </Pressable>
              </View>
            ) : null}
            <Pressable accessibilityRole="button" accessibilityState={{disabled: !ready, busy: submitting}} disabled={!ready} onPress={() => void createAccount()} style={({pressed}) => [styles.button, !ready && styles.disabled, pressed && styles.pressed]}>
              {submitting ? <ActivityIndicator color={colors.background} /> : <Text style={styles.buttonText}>Create account</Text>}
            </Pressable>
            {notice ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text> : null}
            {error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
            <Text style={styles.footer}>Already have an account? <Link href="/sign-in" style={styles.link}>Sign in</Link></Text>
            <Text style={styles.footer}><Link href="/welcome" style={styles.backLink}>Back to welcome</Link></Text>
          </View>
        </ScrollView>
        <Modal visible={!!openDocument} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setOpenDocument(null)}>
          <SafeAreaView style={styles.modalSafe}>
            <View style={styles.modalHeader}>
              <View style={styles.modalTitleGroup}>
                <Text accessibilityRole="header" style={styles.modalTitle}>{openDocument?.title}</Text>
                <Text style={styles.modalVersion}>{openDocument?.version}</Text>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel="Close legal document" onPress={() => setOpenDocument(null)} style={styles.modalClose}>
                <Text style={styles.modalCloseText}>Close</Text>
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.modalContent}>
              <Text selectable style={styles.legalText}>{openDocument?.content_markdown}</Text>
            </ScrollView>
          </SafeAreaView>
        </Modal>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {flex: 1, backgroundColor: colors.background},
  flex: {flex: 1},
  content: {flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 26},
  screen: {width: '100%', maxWidth: 450, alignSelf: 'center', gap: 14},
  logo: {width: 112, height: 112, borderRadius: 56, alignSelf: 'center'},
  slogan: {color: colors.gold, textAlign: 'center', fontWeight: '800', fontSize: 13, letterSpacing: 2.4, marginBottom: 12},
  title: {color: colors.warmWhite, textAlign: 'center', fontSize: 31, fontWeight: '900'},
  body: {color: colors.mutedText, textAlign: 'center', fontSize: 15, lineHeight: 22, marginBottom: 12},
  registrationNotice: {borderLeftWidth: 3, borderLeftColor: colors.gold, backgroundColor: colors.surface, padding: 16, borderRadius: 10, gap: 7},
  registrationTitle: {color: colors.warmWhite, fontSize: 16, fontWeight: '800'},
  registrationDescription: {color: colors.mutedText, fontSize: 14, lineHeight: 21},
  fields: {gap: 10},
  fieldLabel: {color: colors.warmWhite, fontWeight: '600', fontSize: 14},
  input: {minHeight: 54, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 14, color: colors.warmWhite, fontSize: 16, paddingHorizontal: 16, paddingVertical: 13},
  passwordRow: {minHeight: 54, flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 14},
  passwordInput: {flex: 1, minHeight: 52, color: colors.warmWhite, fontSize: 16, paddingHorizontal: 16, paddingVertical: 12},
  visibilityToggle: {minHeight: 48, minWidth: 56, justifyContent: 'center', alignItems: 'center', paddingRight: 8},
  visibilityText: {color: colors.goldSoft, fontWeight: '700', fontSize: 14},
  passwordHint: {color: colors.mutedText, fontSize: 12, lineHeight: 17},
  legalSection: {gap: 6, marginTop: 4},
  legalHeading: {color: colors.warmWhite, fontSize: 19, fontWeight: '800'},
  legalIntro: {color: colors.mutedText, fontSize: 12, lineHeight: 17, marginBottom: 4},
  legalLine: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8},
  readLink: {minHeight: 44, minWidth: 48, justifyContent: 'center', alignItems: 'center'},
  readLinkText: {color: colors.gold, textDecorationLine: 'underline', fontSize: 13, fontWeight: '700'},
  modalSafe: {flex: 1, backgroundColor: colors.background},
  modalHeader: {flexDirection: 'row', alignItems: 'center', padding: 20, gap: 12, borderBottomWidth: 1, borderBottomColor: colors.border},
  modalTitleGroup: {flex: 1, gap: 4},
  modalTitle: {color: colors.warmWhite, fontWeight: '800', fontSize: 18},
  modalVersion: {color: colors.mutedText, fontSize: 12},
  modalClose: {minHeight: 44, minWidth: 56, alignItems: 'center', justifyContent: 'center'},
  modalCloseText: {color: colors.gold, fontWeight: '700'},
  modalContent: {padding: 20, paddingBottom: 48},
  legalText: {color: colors.mutedText, fontSize: 13, lineHeight: 20},
  reviewRow: {flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, flexShrink: 1},
  checkbox: {color: colors.gold, fontSize: 22, width: 28},
  reviewText: {flex: 1, color: colors.warmWhite, fontSize: 14, lineHeight: 20},
  button: {minHeight: 54, borderRadius: 14, backgroundColor: colors.gold, alignItems: 'center', justifyContent: 'center'},
  disabled: {opacity: 0.45},
  pressed: {opacity: 0.85},
  buttonText: {color: colors.background, fontSize: 17, fontWeight: '800'},
  notice: {color: colors.goldSoft, fontSize: 14, lineHeight: 20},
  error: {color: colors.danger, fontSize: 14, lineHeight: 20},
  footer: {color: colors.mutedText, fontSize: 13, textAlign: 'center', marginTop: 3},
  link: {color: colors.gold, textDecorationLine: 'underline', fontWeight: '700'},
  backLink: {color: colors.mutedText, textDecorationLine: 'underline'}
});
