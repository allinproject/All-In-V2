import { useEffect, useRef, useState } from 'react';
import { Link, Redirect } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../src/auth/AuthProvider';
import { useAccessGate } from '../../src/auth/AccessGateProvider';
import { assertV2SessionOwner, readV2OwnedProfileState } from '../../src/auth/accessGateClient';
import { v2AuthenticatedScreenKey } from '../../src/auth/authRoute';
import { normalizeV2DisplayName, profileOwnerMatches } from '../../src/auth/profileEditor';
import { supabase } from '../../src/lib/supabase';
import { colors } from '../../src/theme/tokens';

type OwnedIdentity = { user_id: string; display_name: string | null; avatar_path: string | null };

export default function EditProfileRoute() {
  const { user, sessionGeneration } = useAuth();
  return <OwnedEditProfile key={v2AuthenticatedScreenKey(user?.id ?? null, sessionGeneration)} />;
}

function OwnedEditProfile() {
  const { user, loading: authLoading } = useAuth();
  const gate = useAccessGate();
  const ownerId = user?.id ?? null;
  const [profile, setProfile] = useState<OwnedIdentity | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const live = useRef(true);
  const busy = useRef(false);

  useEffect(() => {
    live.current = true;
    return () => { live.current = false; };
  }, []);

  useEffect(() => {
    if (!ownerId || authLoading || gate.status !== 'ready') return;
    let active = true;
    setProfile(null);
    setLoading(true);
    setError(null);
    setNotice(null);
    void readV2OwnedProfileState(supabase, ownerId, () => active && live.current)
      .then(state => {
        if (!active || !live.current) return;
        const candidate = state.profile;
        if (!profileOwnerMatches(candidate, ownerId)) throw new Error('The profile does not match the signed-in account.');
        const owned = candidate as OwnedIdentity;
        setProfile(owned);
        setDisplayName(owned.display_name ?? '');
      }).catch(cause => {
        if (active && live.current) setError(cause instanceof Error ? cause.message : 'Profile could not be loaded.');
      }).finally(() => { if (active && live.current) setLoading(false); });
    return () => { active = false; };
  }, [ownerId, authLoading, gate.status, retry]);

  async function save() {
    if (!ownerId || !profile || busy.current) return;
    busy.current = true;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const name = normalizeV2DisplayName(displayName);
      await assertV2SessionOwner(supabase, ownerId);
      const { data, error: updateError } = await supabase.from('v2_profiles')
        .update({ display_name: name })
        .eq('user_id', ownerId)
        .select('user_id, display_name, avatar_path')
        .single();
      if (updateError) throw updateError;
      if (!profileOwnerMatches(data, ownerId)) throw new Error('Could not verify the updated profile owner.');
      await assertV2SessionOwner(supabase, ownerId);
      if (!live.current) return;
      setProfile(data);
      setDisplayName(data.display_name ?? '');
      setNotice('Display name saved to your account.');
    } catch (cause) {
      if (live.current) setError(cause instanceof Error ? cause.message : 'Profile could not be saved.');
    } finally {
      busy.current = false;
      if (live.current) setSaving(false);
    }
  }

  if (!authLoading && !user) return <Redirect href="/sign-in" />;
  if (gate.status === 'legal_required') return <Redirect href="/legal-acceptance" />;
  if (gate.status === 'onboarding_required') return <Redirect href="/onboarding-required" />;
  if (authLoading || gate.status !== 'ready' || !ownerId) return <Redirect href="/" />;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Link href="/profile" asChild><Pressable accessibilityRole="button" style={styles.back}><Text style={styles.gold}>‹ Profile</Text></Pressable></Link>
        <Text accessibilityRole="header" style={styles.title}>Edit Profile</Text>
        {loading ? <ActivityIndicator color={colors.gold} accessibilityLabel="Loading account profile" /> : null}
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        {!loading && !profile ? <Pressable accessibilityRole="button" style={styles.secondary} onPress={() => setRetry(n => n + 1)}><Text style={styles.white}>Retry loading</Text></Pressable> : null}
        {!loading && profile ? (
          <>
            <View style={styles.photoSection}>
              <View style={styles.avatar}><Text style={styles.avatarText}>{(profile.display_name ?? user.email ?? 'A').trim().charAt(0).toUpperCase() || 'A'}</Text></View>
              <Text style={styles.gold}>Change Profile Photo</Text>
              <Text style={styles.small}>Photo upload and removal will be enabled when the private V2 avatar storage flow is connected.</Text>
            </View>
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Personal Information</Text>
              <Text style={styles.label}>Display Name</Text>
              <TextInput accessibilityLabel="Display Name" style={styles.input} maxLength={80} autoCapitalize="words"
                placeholder="Your athlete name" placeholderTextColor={colors.mutedText} value={displayName}
                editable={!saving} onChangeText={setDisplayName} />
              <Text style={styles.label}>Bio</Text>
              <View style={styles.unavailable}><Text style={styles.muted}>Bio editing is not connected to V2 yet.</Text></View>
              <Text style={styles.label}>Location (optional)</Text>
              <View style={styles.unavailable}><Text style={styles.muted}>General location is not stored or shared by this screen yet.</Text></View>
            </View>
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Community Visibility</Text>
              <SettingRow title="Private Account" detail="Follower and shared-content privacy controls are not connected yet." />
              <View style={styles.rule}/>
              <SettingRow title="Race Visibility" detail="Public, followers and private race visibility will use the canonical Community and RaceHub rules." />
              <View style={styles.rule}/>
              <SettingRow title="Show Location" detail="Off until optional general-area storage and explicit sharing controls are available." />
            </View>
            {notice ? <Text accessibilityRole="text" style={styles.gold}>{notice}</Text> : null}
            <Pressable accessibilityRole="button" accessibilityState={{ disabled: saving, busy: saving }}
              disabled={saving} style={styles.saveButton} onPress={() => void save()}>
              <Text style={styles.saveText}>{saving ? 'Saving…' : 'Save Display Name'}</Text>
            </Pressable>
            <Text style={styles.small}>Only Display Name is currently saved. The other approved controls remain visible for implementation review, but do not collect or change data.</Text>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function SettingRow({ title, detail }: { title: string; detail: string }) {
  return (
    <View accessibilityLabel={title + ', not yet available'} style={styles.setting}>
      <View style={styles.settingCopy}><Text style={styles.white}>{title}</Text><Text style={styles.small}>{detail}</Text></View>
      <Text style={styles.unavailableLabel}>Coming later</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: 24, paddingBottom: 48, gap: 18 },
  back: { minHeight: 44, justifyContent: 'center' },
  title: { fontSize: 30, fontWeight: '800', color: colors.warmWhite },
  photoSection: { alignItems: 'center', gap: 10, paddingVertical: 8 },
  avatar: { width: 88, height: 88, borderRadius: 44, borderWidth: 1, borderColor: colors.gold, backgroundColor: colors.surfaceRaised, justifyContent: 'center', alignItems: 'center' },
  avatarText: { color: colors.goldSoft, fontWeight: '800', fontSize: 30 },
  card: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: 18, padding: 18, gap: 12 },
  sectionTitle: { color: colors.warmWhite, fontSize: 18, fontWeight: '800' },
  label: { color: colors.mutedText, fontSize: 12, fontWeight: '700' },
  white: { color: colors.warmWhite, fontWeight: '600' },
  gold: { color: colors.goldSoft, fontWeight: '700' },
  muted: { color: colors.mutedText, fontSize: 14 },
  small: { color: colors.mutedText, fontSize: 12, lineHeight: 19, textAlign: 'left' },
  input: { minHeight: 48, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, borderColor: colors.border, color: colors.warmWhite, backgroundColor: colors.surfaceRaised },
  unavailable: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12, backgroundColor: colors.surfaceRaised },
  setting: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 54 },
  settingCopy: { flex: 1, gap: 4 },
  unavailableLabel: { color: colors.mutedText, fontSize: 11 },
  rule: { height: 1, backgroundColor: colors.border },
  saveButton: { minHeight: 48, borderRadius: 14, backgroundColor: colors.gold, alignItems: 'center', justifyContent: 'center' },
  saveText: { color: colors.background, fontWeight: '800' },
  error: { color: colors.danger, fontSize: 14 },
  secondary: { minHeight: 48, backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
});
