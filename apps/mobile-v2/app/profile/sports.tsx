import { useCallback, useRef, useState } from 'react';
import { Link, Redirect, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../src/auth/AuthProvider';
import { useAccessGate } from '../../src/auth/AccessGateProvider';
import { assertV2SessionOwner, readV2OwnedProfileState } from '../../src/auth/accessGateClient';
import { v2AuthenticatedScreenKey } from '../../src/auth/authRoute';
import {
  SPORTS_ACTIVITY_OPTIONS, SPORTS_FOCUS_OPTIONS, NOT_TRAINING_YET,
  chooseSportsFocus, parseSportsPreferences, setStartingFromZero,
  sportsPreferencesPatch, toggleActiveSport, type SportsPreferences,
} from '../../src/features/training/sportsPreferences';
import { supabase } from '../../src/lib/supabase';
import { colors } from '../../src/theme/tokens';
import { GuidedTourPanel } from '../../src/features/tutorials/GuidedTourPanel';
import { SPORTS_GUIDE_STEPS, sportsGuideTarget, type SportsGuideTarget } from '../../src/features/tutorials/sportsGuide';
import type { GuidePosition } from '../../src/features/tutorials/profileGuide';

type SettingsSnapshot = { version?: number; settings?: unknown };
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}
function newActionId(owner: string): string {
  return ['sports', owner, Date.now().toString(36), Math.random().toString(36).slice(2, 12)].join(':');
}

export default function SportsRoute() {
  const { user, sessionGeneration } = useAuth();
  return <SportsOwnerRoute key={v2AuthenticatedScreenKey(user?.id ?? null, sessionGeneration)} />;
}

function SportsOwnerRoute() {
  const { user, loading: authLoading } = useAuth();
  const gate = useAccessGate();
  const { tutorial } = useLocalSearchParams<{tutorial?:string}>();
  const router = useRouter();
  const ownerId = user?.id ?? null;
  const [draft, setDraft] = useState<SportsPreferences>({ primaryFocus: '', currentSports: [] });
  const [settingsVersion, setSettingsVersion] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const busy = useRef(false);
  const scroller=useRef<ScrollView>(null);
  const targets=useRef<Partial<Record<SportsGuideTarget,number>>>({});
  const activeTarget=useRef<SportsGuideTarget|null>(null);
  const [highlighted,setHighlighted]=useState<SportsGuideTarget|null>(null);
  const onGuidePosition=useCallback((position:GuidePosition)=>{
    const target=sportsGuideTarget(position);
    activeTarget.current=target;
    setHighlighted(target);
    if(target){const y=targets.current[target];if(y!==undefined)scroller.current?.scrollTo({y:Math.max(0,y-16),animated:true});}
  },[]);
  const onTargetLayout=useCallback((target:SportsGuideTarget)=>(event:LayoutChangeEvent)=>{
    targets.current[target]=event.nativeEvent.layout.y;
    if(activeTarget.current===target)scroller.current?.scrollTo({y:Math.max(0,event.nativeEvent.layout.y-16),animated:true});
  },[]);
  const pendingSave = useRef<{ version: number; patch: string; id: string } | null>(null);

  const readSettings = useCallback(async (isCurrent: () => boolean, preserveDraft: boolean) => {
    if (!ownerId) throw new Error('Sign in to edit your sports.');
    const state = await readV2OwnedProfileState(supabase, ownerId, isCurrent);
    const settings = state.settings as SettingsSnapshot | null;
    const version = settings?.version;
    if (!Number.isSafeInteger(version) || !version || version < 1) throw new Error('Training settings version is unavailable.');
    const training = record(record(settings?.settings).training_preferences);
    if (!isCurrent()) return;
    setSettingsVersion(version);
    if (!preserveDraft) setDraft(parseSportsPreferences(training));
  }, [ownerId]);

  useFocusEffect(useCallback(() => {
    if (!ownerId || authLoading || gate.status !== 'ready') return;
    let active = true;
    setLoading(true); setError(null); setNotice(null); pendingSave.current = null;
    void readSettings(() => active, false)
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'Could not load your sports.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [ownerId, authLoading, gate.status, readSettings, reload]));

  function edit(change: (old: SportsPreferences) => SportsPreferences) {
    if (busy.current) return;
    pendingSave.current = null;
    setDraft(change);
    setNotice(null);
    setError(null);
  }

  async function save() {
    if (!ownerId || settingsVersion === null || busy.current || loading) return;
    busy.current = true; setSaving(true); setError(null); setNotice(null);
    try {
      const patch = sportsPreferencesPatch(draft);
      const serialized = JSON.stringify(patch);
      const previous = pendingSave.current;
      const actionId = previous?.version === settingsVersion && previous.patch === serialized
        ? previous.id : newActionId(ownerId);
      pendingSave.current = { version: settingsVersion, patch: serialized, id: actionId };
      await assertV2SessionOwner(supabase, ownerId);
      const { data: savedVersion, error: writeError } = await supabase.rpc('v2_patch_profile_settings_section', {
        p_expected_user_id: ownerId,
        p_section: 'training_preferences',
        p_patch: patch,
        p_expected_version: settingsVersion,
        p_client_action_id: actionId,
      });
      if (writeError) {
        if (writeError.code === '40001') {
          pendingSave.current = null;
          // Reject stale writes; reload the server state rather than overwrite newer changes.
          await readSettings(() => true, false);
        }
        throw writeError;
      }
      await assertV2SessionOwner(supabase, ownerId);
      if (!Number.isSafeInteger(savedVersion) || !savedVersion || savedVersion < 1) throw new Error('Could not verify that preferences were saved.');
      // Refresh the canonical current settings version, including any concurrent changes.
      await readSettings(() => true, false);
      pendingSave.current = null;
      setNotice('Sports & Interests saved.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Your preferences could not be saved.');
    } finally {
      busy.current = false; setSaving(false);
    }
  }

  if (!authLoading && !user) return <Redirect href="/sign-in" />;
  if (gate.status === 'legal_required') return <Redirect href="/legal-acceptance" />;
  if (gate.status === 'onboarding_required') return <Redirect href="/onboarding-required" />;
  if (authLoading || gate.status !== 'ready' || !ownerId) return <Redirect href="/" />;

  return <SafeAreaView style={styles.safe}>
    {tutorial==='sports' && !loading && settingsVersion!==null ? <GuidedTourPanel key={ownerId} title="Sports & Interests guide"
      steps={SPORTS_GUIDE_STEPS} onExit={()=>router.replace('/profile/tutorials')} onPositionChange={onGuidePosition}/> : null}
    <ScrollView ref={scroller} contentContainerStyle={styles.content}>
      <Link href="/profile" asChild><Pressable accessibilityRole="button" style={styles.back}><Text style={styles.gold}>‹ Profile</Text></Pressable></Link>
      <Text accessibilityRole="header" style={styles.title}>Sports & Interests</Text>
      <Text style={styles.helper}>Personalize your training experience. You can always explore other activities.</Text>
      {loading ? <ActivityIndicator color={colors.gold} accessibilityLabel="Loading sports preferences" /> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {!loading && settingsVersion === null ?
        <Pressable style={styles.save} accessibilityRole="button" onPress={() => setReload(n => n + 1)}><Text style={styles.saveText}>Retry loading</Text></Pressable> : null}
      {!loading && settingsVersion !== null ? <>
        <View onLayout={onTargetLayout('focus')} style={[styles.card,highlighted==='focus'&&styles.tourTarget]}>
          <Text style={styles.heading}>Training Focus</Text>
          <Text style={styles.helper}>What are you prioritizing right now? Optional. Choosing a focus never restricts other activities.</Text>
          <View style={styles.chips}>{SPORTS_FOCUS_OPTIONS.map(option => <Chip
            key={option.value} label={option.label} selected={draft.primaryFocus === option.value}
            disabled={saving} onPress={() => edit(old => chooseSportsFocus(old, option.value))} />)}</View>
          {draft.primaryFocus ? <Pressable accessibilityRole="button" onPress={() => edit(old => chooseSportsFocus(old, ''))} disabled={saving}>
            <Text style={styles.gold}>Clear Training Focus</Text>
          </Pressable> : null}
        </View>
        <View onLayout={onTargetLayout('activities')} style={[styles.card,highlighted==='activities'&&styles.tourTarget]}>
          <Text style={styles.heading}>Active Activities</Text>
          <Text style={styles.helper}>Select everything you currently do. You can always start any supported activity, selected or not.</Text>
          <View style={styles.chips}>{SPORTS_ACTIVITY_OPTIONS.map(option => <Chip
            key={option.value} label={option.label} selected={draft.currentSports.includes(option.value)}
            disabled={saving} onPress={() => edit(old => toggleActiveSport(old, option.value))} />)}</View>
          <Chip label="I'm just getting started" selected={draft.currentSports.includes(NOT_TRAINING_YET)}
            disabled={saving} onPress={() => edit(setStartingFromZero)} />
        </View>
        {notice ? <Text accessibilityRole="text" style={styles.gold}>{notice}</Text> : null}
        <Pressable onLayout={onTargetLayout('save')} accessibilityRole="button" accessibilityState={{ disabled: saving, busy: saving }} disabled={saving}
          style={[styles.save, saving && styles.dim, highlighted==='save'&&styles.tourTarget]} onPress={() => void save()}>
          <Text style={styles.saveText}>{saving ? 'Saving…' : 'Save Preferences'}</Text>
        </Pressable>
      </> : null}
    </ScrollView>
  </SafeAreaView>;
}

function Chip({ label, selected, disabled, onPress }: { label: string; selected: boolean; disabled: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected, disabled }} disabled={disabled}
    onPress={onPress} style={[styles.chip, selected && styles.chipSelected]}>
    <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{selected ? '✓ ' : ''}{label}</Text>
  </Pressable>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: 24, paddingBottom: 48, gap: 18 },
  back: { minHeight: 44, justifyContent: 'center' },
  gold: { color: colors.goldSoft, fontWeight: '700' },
  title: { color: colors.warmWhite, fontSize: 28, fontWeight: '800' },
  helper: { color: colors.mutedText, fontSize: 14, lineHeight: 21 },
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 18, padding: 18, gap: 12 },
  tourTarget:{borderColor:colors.goldSoft,borderWidth:2},
  heading: { color: colors.warmWhite, fontSize: 19, fontWeight: '800' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  chip: { paddingVertical: 10, paddingHorizontal: 13, borderColor: colors.border, borderWidth: 1, backgroundColor: colors.surfaceRaised, borderRadius: 999 },
  chipSelected: { backgroundColor: colors.gold, borderColor: colors.gold },
  chipText: { color: colors.warmWhite, fontWeight: '700' },
  chipTextSelected: { color: colors.background },
  save: { minHeight: 48, borderRadius: 14, backgroundColor: colors.gold, alignItems: 'center', justifyContent: 'center' },
  saveText: { color: colors.background, fontWeight: '800' },
  error: { color: colors.danger, fontSize: 14 },
  dim: { opacity: 0.6 },
});
