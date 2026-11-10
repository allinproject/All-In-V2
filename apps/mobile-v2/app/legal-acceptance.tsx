import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Redirect } from 'expo-router';
import { useAuth } from '../src/auth/AuthProvider';
import { useAccessGate } from '../src/auth/AccessGateProvider';
import { supabase } from '../src/lib/supabase';
import { colors, radius, spacing } from '../src/theme/tokens';

export default function LegalAcceptanceScreen() {
  const { user, loading } = useAuth();
  const gate = useAccessGate();
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const actionId = useRef<string | null>(null);

  if (!loading && !user) return <Redirect href="/sign-in" />;
  if (gate.status === 'ready') return <Redirect href="/home" />;
  if (gate.status !== 'legal_required') return <Redirect href="/" />;

  const documents = gate.requiredLegalDocuments;
  const allReviewed = documents.length === 3 && documents.every(doc => checked[doc.document_key]);
  const canAccept = allReviewed && ageConfirmed && !submitting;

  async function acceptDocuments() {
    if (!user || !canAccept) return;
    setSubmitting(true);
    setMessage(null);
    try {
      const versions = new Map(documents.map(doc => [doc.document_key, doc.version]));
      const id = actionId.current ?? (globalThis.crypto?.randomUUID?.() ?? `accept-${user.id}-${Date.now()}`);
      actionId.current = id;
      const { error } = await supabase.rpc('v2_accept_legal_documents', {
        p_terms_version: versions.get('terms'),
        p_privacy_version: versions.get('privacy'),
        p_founder_beta_terms_version: versions.get('founder_beta_terms'),
        p_age_18_confirmed: true,
        p_client_action_id: id,
      });
      if (error) throw error;
      gate.retry();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : 'Legal acceptance could not be saved. Please retry.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.brand}>ALL IN <Text style={styles.gold}>365</Text></Text>
        <Text accessibilityRole="header" style={styles.title}>Review and accept</Text>
        <Text style={styles.body}>Your access is limited until you review the current published V2 legal documents and confirm your age.</Text>
        {documents.map(doc => (
          <View key={doc.document_key} style={styles.document}>
            <Text style={styles.documentTitle}>{doc.title} · {doc.version}</Text>
            <ScrollView nestedScrollEnabled style={styles.documentBody}>
              <Text selectable style={styles.legalText}>{doc.content_markdown}</Text>
            </ScrollView>
            <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: !!checked[doc.document_key] }} onPress={() => setChecked(old => ({ ...old, [doc.document_key]: !old[doc.document_key] }))} style={styles.reviewRow}>
              <Text style={styles.checkbox}>{checked[doc.document_key] ? '☑' : '☐'}</Text>
              <Text style={styles.reviewText}>I have read and reviewed this document</Text>
            </Pressable>
          </View>
        ))}
        <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: ageConfirmed }} onPress={() => setAgeConfirmed(value => !value)} style={styles.reviewRow}>
          <Text style={styles.checkbox}>{ageConfirmed ? '☑' : '☐'}</Text>
          <Text style={styles.reviewText}>I confirm that I am at least 18 years old.</Text>
        </Pressable>
        {message ? <Text accessibilityLiveRegion="polite" style={styles.error}>{message}</Text> : null}
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: !canAccept, busy: submitting }} disabled={!canAccept} onPress={() => void acceptDocuments()} style={[styles.button, !canAccept && styles.disabled]}>
          {submitting ? <ActivityIndicator color={colors.background} /> : <Text style={styles.buttonText}>Accept reviewed documents</Text>}
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { flexGrow: 1, padding: spacing.lg, gap: spacing.md },
  brand: { color: colors.warmWhite, fontSize: 18, fontWeight: '800', letterSpacing: 1.5 },
  gold: { color: colors.gold },
  title: { color: colors.warmWhite, fontSize: 28, fontWeight: '800' },
  body: { color: colors.mutedText, fontSize: 14, lineHeight: 21 },
  document: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.control, padding: spacing.md, gap: spacing.sm },
  documentTitle: { color: colors.warmWhite, fontSize: 15, fontWeight: '800' },
  documentBody: { maxHeight: 260 },
  legalText: { color: colors.mutedText, fontSize: 13, lineHeight: 20 },
  reviewRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 40 },
  checkbox: { color: colors.gold, fontSize: 22, width: 28 },
  reviewText: { flex: 1, color: colors.warmWhite, fontSize: 14, lineHeight: 20 },
  button: { minHeight: 52, borderRadius: radius.control, backgroundColor: colors.gold, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.45 },
  buttonText: { color: colors.background, fontSize: 15, fontWeight: '800' },
  error: { color: colors.danger, fontSize: 14, lineHeight: 20 }
});