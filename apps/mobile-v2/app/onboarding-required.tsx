import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Redirect } from 'expo-router';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../src/auth/AuthProvider';
import { useAccessGate } from '../src/auth/AccessGateProvider';
import {
  assertV2SessionOwner,
  readV2OwnedProfileState,
  REQUIRED_V2_ONBOARDING_STEPS,
} from '../src/auth/accessGateClient';
import {
  EMPTY_ONBOARDING_ANSWERS,
  V2_ONBOARDING_FOCUS_OPTIONS,
  createOnboardingSaveGuard,
  firstIncompleteOnboardingStep,
  isOnboardingAnswerComplete,
  matchesOnboardingRetryScope,
  onboardingPreferenceWrite,
  type OnboardingActionScope,
  type OnboardingAnswers,
  type OnboardingStep,
  v2OnboardingScreenKey,
} from '../src/auth/onboardingFlow';
import { supabase } from '../src/lib/supabase';
import { colors, radius, spacing } from '../src/theme/tokens';
import type { Json } from '../src/types/database.types';

type Choice = { value: string; label: string; description?: string };

type PendingAction = OnboardingActionScope & {
  settingsActionId: string;
  progressActionId: string;
};

type ProfileStatePayload = {
  profile?: { user_id?: string } | null;
  onboarding?: {
    completed_steps?: unknown;
    skipped_steps?: unknown;
    version?: number;
  } | null;
  settings?: {
    settings?: unknown;
    version?: number;
  } | null;
};

const STEP_COPY: Record<OnboardingStep, { title: string; description: string }> = {
  focus: {
    title: 'What would you like to focus on first?',
    description: 'Choose where you would like to start—not your only goal. You can pursue multiple goals at once and change this later.',
  },
  training_pattern: {
    title: 'What kinds of training do you do now?',
    description: 'Select everything that is already part of your life. Starting from zero is completely fine.',
  },
  availability: {
    title: 'When are you usually available to train?',
    description: 'This is a starting preference, not a fixed schedule. You can change it any time.',
  },
  coach: {
    title: 'How would you like Coach to help?',
    description: 'Choose the style of guidance that feels useful. You stay in control of every plan change.',
  },
  food_safety: {
    title: 'Anything Coach should know about food safety?',
    description: 'Share only food allergies, sensitivities or preferences you want ALL IN 365 to consider. You can leave this unknown.',
  },
  proactivity: {
    title: 'How proactive should ALL IN 365 be?',
    description: 'Set the level of in-app guidance and reminders. Device permissions are requested later, only when a feature needs them.',
  },
};

const TRAINING_OPTIONS: Choice[] = [
  { value: 'running', label: 'Run' },
  { value: 'strength', label: 'Strength' },
  { value: 'cycling', label: 'Ride' },
  { value: 'swimming', label: 'Swim' },
  { value: 'elliptical', label: 'Elliptical' },
  { value: 'stair_stepper', label: 'Stair-stepper' },
  { value: 'walking', label: 'Walk' },
  { value: 'hiking_rucking', label: 'Hike / Ruck' },
  { value: 'mobility_yoga', label: 'Mobility / Yoga' },
  { value: 'not_currently_training', label: 'I am just getting started' },
];

const DAY_OPTIONS: Choice[] = [
  { value: 'monday', label: 'Mon' },
  { value: 'tuesday', label: 'Tue' },
  { value: 'wednesday', label: 'Wed' },
  { value: 'thursday', label: 'Thu' },
  { value: 'friday', label: 'Fri' },
  { value: 'saturday', label: 'Sat' },
  { value: 'sunday', label: 'Sun' },
  { value: 'flexible', label: 'My schedule changes' },
];

const COACH_OPTIONS: Choice[] = [
  { value: 'only_when_asked', label: 'When I ask', description: 'Keep Coach available, but let me lead.' },
  { value: 'balanced', label: 'Balanced', description: 'Offer useful guidance without crowding my day.' },
  { value: 'proactive', label: 'Proactive', description: 'Point out opportunities and decisions that may help.' },
];

const FOOD_OPTIONS: Choice[] = [
  { value: 'none', label: 'No known allergies or restrictions' },
  { value: 'allergies_or_sensitivities', label: 'Allergies or sensitivities' },
  { value: 'dietary_preferences', label: 'Dietary preferences or avoidances' },
  { value: 'both', label: 'Both' },
];

const PROACTIVITY_OPTIONS: Choice[] = [
  { value: 'critical_only', label: 'Only important reminders', description: 'Time-sensitive and safety-related items.' },
  { value: 'occasional', label: 'A few useful reminders', description: 'Helpful prompts when the timing matters.' },
  { value: 'proactive', label: 'Proactive suggestions', description: 'Surface relevant ideas when they can help.' },
];

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === 'string'))]
    : [];
}

function readAnswersFromSettings(value: unknown): OnboardingAnswers {
  const root = asRecord(value);
  const training = asRecord(root.training_preferences);
  const coach = asRecord(root.coach_preferences);
  const nutrition = asRecord(root.nutrition_preferences);
  const safety = asRecord(nutrition.food_safety);
  const notifications = asRecord(root.notification_preferences);

  return {
    primaryFocus: asString(training.primary_focus),
    currentSports: asStringArray(training.current_sports),
    availableDays: asStringArray(training.available_days),
    coachGuidance: asString(coach.guidance_style),
    foodSafety: asString(safety.selection),
    foodSafetyNotes: asString(safety.selection) === 'none' ? '' : asString(safety.notes),
    proactivity: asString(notifications.proactivity_level),
  };
}

function makeActionId(ownerId: string, step: OnboardingStep, kind: string): string {
  return ['onboarding', kind, ownerId, step, Date.now().toString(36), Math.random().toString(36).slice(2, 12)].join(':');
}

function toggleValue(current: string[], value: string, exclusiveValue?: string): string[] {
  if (value === exclusiveValue) return current.includes(value) ? [] : [value];
  const withoutExclusive = exclusiveValue ? current.filter(item => item !== exclusiveValue) : current;
  return withoutExclusive.includes(value)
    ? withoutExclusive.filter(item => item !== value)
    : [...withoutExclusive, value];
}

function ChoiceButton({
  option,
  selected,
  onPress,
  disabled,
  compact = false,
}: {
  option: Choice;
  selected: boolean;
  onPress: () => void;
  disabled: boolean;
  compact?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.choice,
        compact && styles.choiceCompact,
        selected && styles.choiceSelected,
        disabled && styles.disabled,
      ]}
    >
      <View style={styles.choiceCopy}>
        <Text style={[styles.choiceLabel, selected && styles.choiceLabelSelected]}>{option.label}</Text>
        {option.description ? <Text style={styles.choiceDescription}>{option.description}</Text> : null}
      </View>
      <View style={[styles.choiceIndicator, selected && styles.choiceIndicatorSelected]}>
        {selected ? <View style={styles.choiceIndicatorDot} /> : null}
      </View>
    </Pressable>
  );
}

export default function OnboardingRequiredScreen() {
  const { user, sessionGeneration } = useAuth();
  // A remount discards drafts, errors and retry IDs belonging to a prior session.
  return <OnboardingOwnerFlow key={v2OnboardingScreenKey(user?.id ?? null, sessionGeneration)} />;
}

function OnboardingOwnerFlow() {
  const { user, loading: authLoading } = useAuth();
  const gate = useAccessGate();
  const ownerId = user?.id ?? null;

  const [loadingState, setLoadingState] = useState(true);
  const [saving, setSaving] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<string[]>([]);
  const [skippedSteps, setSkippedSteps] = useState<string[]>([]);
  const [settingsVersion, setSettingsVersion] = useState<number | null>(null);
  const [progressVersion, setProgressVersion] = useState<number | null>(null);
  const [answers, setAnswers] = useState<OnboardingAnswers>({ ...EMPTY_ONBOARDING_ANSWERS });
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const saveGuard = useRef(createOnboardingSaveGuard());

  const readSnapshot = useCallback(async (preserveDraft: boolean, isCurrent: () => boolean = () => true): Promise<OnboardingStep | null> => {
    if (!ownerId) throw new Error('Your V2 account could not be verified. Please sign in again.');

    const state = await readV2OwnedProfileState(supabase, ownerId, isCurrent) as ProfileStatePayload;

    const onboarding = asRecord(state.onboarding);
    const settings = asRecord(state.settings);
    const nextProgressVersion = Number(onboarding.version);
    const nextSettingsVersion = Number(settings.version);
    if (!Number.isSafeInteger(nextProgressVersion) || nextProgressVersion < 1
      || !Number.isSafeInteger(nextSettingsVersion) || nextSettingsVersion < 1) {
      throw new Error('Your onboarding settings could not be verified. Please retry.');
    }

    const rootSettings = asRecord(settings.settings);
    const nextCompleted = asStringArray(onboarding.completed_steps);
    const nextSkipped = asStringArray(onboarding.skipped_steps);
    const nextStep = firstIncompleteOnboardingStep(nextCompleted, nextSkipped);

    setSettingsVersion(nextSettingsVersion);
    setProgressVersion(nextProgressVersion);
    setCompletedSteps(nextCompleted);
    setSkippedSteps(nextSkipped);
    if (!preserveDraft) setAnswers(readAnswersFromSettings(rootSettings));
    setActiveStepIndex(nextStep ? REQUIRED_V2_ONBOARDING_STEPS.indexOf(nextStep) : REQUIRED_V2_ONBOARDING_STEPS.length);
    setLoadError(null);

    return nextStep;
  }, [ownerId]);

  useEffect(() => {
    if (authLoading || !ownerId || gate.status !== 'onboarding_required') return;
    let active = true;
    setLoadingState(true);
    void readSnapshot(false, () => active).then(nextStep => {
      if (!active) return;
      if (!nextStep) {
        setFinishing(true);
        gate.retry();
      }
    }).catch(caught => {
      if (!active) return;
      setLoadError(caught instanceof Error ? caught.message : 'Onboarding could not be loaded. Private access remains closed.');
    }).finally(() => {
      if (active) setLoadingState(false);
    });
    return () => { active = false; };
  }, [authLoading, ownerId, gate.status, gate.retry, reloadToken, readSnapshot]);

  const activeStep = REQUIRED_V2_ONBOARDING_STEPS[activeStepIndex] ?? null;
  const stepNumber = activeStep ? activeStepIndex + 1 : REQUIRED_V2_ONBOARDING_STEPS.length;
  const stepCopy = activeStep ? STEP_COPY[activeStep] : null;
  const canComplete = activeStep ? isOnboardingAnswerComplete(activeStep, answers) : false;

  const updateAnswers = (update: (current: OnboardingAnswers) => OnboardingAnswers) => {
    if (saveGuard.current.isBusy()) return;
    setAnswers(current => update(current));
    setPendingAction(null);
    setActionError(null);
  };

  const saveStep = async (action: 'complete' | 'skip') => {
    if (!activeStep || !ownerId || settingsVersion === null || progressVersion === null) return;
    if (action === 'complete' && !isOnboardingAnswerComplete(activeStep, answers)) {
      setActionError('Choose an answer or skip this step for now. Skipped answers remain unknown.');
      return;
    }
    if (!saveGuard.current.tryEnter()) return;

    const scope: OnboardingActionScope = {
      ownerId,
      step: activeStep,
      action,
      settingsVersion,
      progressVersion,
    };
    const ids: PendingAction = matchesOnboardingRetryScope(pendingAction, scope)
      ? pendingAction!
      : {
          ...scope,
          settingsActionId: makeActionId(ownerId, activeStep, 'settings'),
          progressActionId: makeActionId(ownerId, activeStep, action),
        };
    setPendingAction(ids);
    setSaving(true);
    setActionError(null);

    try {
      await assertV2SessionOwner(supabase, ownerId);
      if (action === 'complete') {
        const write = onboardingPreferenceWrite(activeStep, answers);
        const { data: savedSettingsVersion, error: settingsError } = await supabase.rpc(
          'v2_patch_profile_settings_section',
          {
            p_expected_user_id: ownerId,
            p_section: write.section,
            p_patch: write.patch,
            p_expected_version: settingsVersion,
            p_client_action_id: ids.settingsActionId,
          },
        );
        if (settingsError) {
          if (settingsError.code === '40001') {
            setPendingAction(null);
            await readSnapshot(true);
          }
          throw settingsError;
        }
        if (!Number.isSafeInteger(Number(savedSettingsVersion)) || Number(savedSettingsVersion) < 1) {
          throw new Error('Your answer was not confirmed by the V2 profile service. Please retry.');
        }
      }

      await assertV2SessionOwner(supabase, ownerId);

      const { error: progressError } = await supabase.rpc('v2_set_onboarding_step', {
        p_expected_user_id: ownerId,
        p_step: activeStep,
        p_action: action,
        p_expected_version: progressVersion,
        p_client_action_id: ids.progressActionId,
      });
      if (progressError) {
        if (progressError.code === '40001') {
          setPendingAction(null);
          await readSnapshot(true);
        }
        throw progressError;
      }

      setPendingAction(null);
      const nextStep = await readSnapshot(true);
      if (!nextStep) {
        setFinishing(true);
        gate.retry();
      }
    } catch (caught) {
      setActionError(caught instanceof Error
        ? caught.message
        : 'Your answer could not be saved. Please retry; private access remains closed.');
    } finally {
      saveGuard.current.leave();
      setSaving(false);
    }
  };

  const renderBody = () => {
    if (!activeStep) return null;

    switch (activeStep) {
      case 'focus':
        return (
          <View style={styles.options}>
            {V2_ONBOARDING_FOCUS_OPTIONS.map(option => (
              <ChoiceButton
                key={option.value}
                option={option}
                selected={answers.primaryFocus === option.value}
                disabled={saving}
                onPress={() => updateAnswers(current => ({ ...current, primaryFocus: option.value }))}
              />
            ))}
          </View>
        );
      case 'training_pattern':
        return (
          <View style={styles.options}>
            <Text style={styles.helper}>Choose one or more. If you are new to training, select the last option.</Text>
            {TRAINING_OPTIONS.map(option => (
              <ChoiceButton
                key={option.value}
                option={option}
                selected={answers.currentSports.includes(option.value)}
                disabled={saving}
                onPress={() => updateAnswers(current => ({
                  ...current,
                  currentSports: toggleValue(current.currentSports, option.value, 'not_currently_training'),
                }))}
              />
            ))}
          </View>
        );
      case 'availability':
        return (
          <View style={styles.options}>
            <Text style={styles.helper}>Select the days that tend to work. This will not block you from training on other days.</Text>
            <View style={styles.dayGrid}>
              {DAY_OPTIONS.map(option => (
                <View key={option.value} style={styles.dayGridItem}>
                  <ChoiceButton
                    option={option}
                    compact
                    selected={answers.availableDays.includes(option.value)}
                    disabled={saving}
                    onPress={() => updateAnswers(current => ({
                      ...current,
                      availableDays: toggleValue(current.availableDays, option.value, 'flexible'),
                    }))}
                  />
                </View>
              ))}
            </View>
          </View>
        );
      case 'coach':
        return (
          <View style={styles.options}>
            {COACH_OPTIONS.map(option => (
              <ChoiceButton
                key={option.value}
                option={option}
                selected={answers.coachGuidance === option.value}
                disabled={saving}
                onPress={() => updateAnswers(current => ({ ...current, coachGuidance: option.value }))}
              />
            ))}
          </View>
        );
      case 'food_safety':
        return (
          <View style={styles.options}>
            {FOOD_OPTIONS.map(option => (
              <ChoiceButton
                key={option.value}
                option={option}
                selected={answers.foodSafety === option.value}
                disabled={saving}
                onPress={() => updateAnswers(current => ({
                  ...current,
                  foodSafety: option.value,
                  foodSafetyNotes: option.value === 'none' ? '' : current.foodSafetyNotes,
                }))}
              />
            ))}
            {answers.foodSafety && answers.foodSafety !== 'none' ? (
              <View style={styles.notesBlock}>
                <Text style={styles.helper}>Optional details</Text>
                <TextInput
                  accessibilityLabel="Food allergies, sensitivities or preferences"
                  editable={!saving}
                  multiline
                  onChangeText={value => updateAnswers(current => ({ ...current, foodSafetyNotes: value }))}
                  placeholder="Add only what you want Coach to consider"
                  placeholderTextColor={colors.mutedText}
                  style={styles.input}
                  value={answers.foodSafetyNotes}
                />
              </View>
            ) : null}
          </View>
        );
      case 'proactivity':
        return (
          <View style={styles.options}>
            {PROACTIVITY_OPTIONS.map(option => (
              <ChoiceButton
                key={option.value}
                option={option}
                selected={answers.proactivity === option.value}
                disabled={saving}
                onPress={() => updateAnswers(current => ({ ...current, proactivity: option.value }))}
              />
            ))}
          </View>
        );
    }
  };

  if (!authLoading && !user) return <Redirect href="/sign-in" />;
  if (gate.status === 'ready') return <Redirect href="/home" />;
  if (gate.status === 'legal_required') return <Redirect href="/legal-acceptance" />;
  if (gate.status !== 'onboarding_required') return <Redirect href="/" />;

  if (loadError) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.loading}>
          <Text accessibilityRole="header" style={styles.title}>Your setup is still protected</Text>
          <Text style={styles.body}>{loadError}</Text>
          <Pressable accessibilityRole="button" onPress={() => setReloadToken(value => value + 1)} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>Retry</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

 if (authLoading || loadingState || finishing || !activeStep) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.loading}>
          <ActivityIndicator color={colors.gold} />
          <Text style={styles.helper}>Preparing your V2 setup…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={styles.content}>
          <Text style={styles.brand}>ALL IN <Text style={styles.gold}>365</Text></Text>
          <View style={styles.stepRow}>
            <Text style={styles.stepLabel}>STEP {stepNumber} OF {REQUIRED_V2_ONBOARDING_STEPS.length}</Text>
            <Text style={styles.stepLabel}>{completedSteps.length + skippedSteps.length} SAVED</Text>
          </View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: (stepNumber / REQUIRED_V2_ONBOARDING_STEPS.length) * 100 + '%' }]} />
          </View>
          <Text accessibilityRole="header" style={styles.title}>{stepCopy?.title}</Text>
          <Text style={styles.body}>{stepCopy?.description}</Text>
          <View style={styles.card}>
            {renderBody()}
          </View>
          <Text style={styles.privacyNote}>Your answers are saved to your V2 profile and can be changed later. Skipping leaves that information unknown.</Text>
          {actionError ? <Text accessibilityRole="alert" style={styles.error}>{actionError}</Text> : null}
          <View style={styles.actions}>
            {activeStepIndex > 0 ? (
              <Pressable accessibilityRole="button" disabled={saving} onPress={() => { if (saveGuard.current.isBusy()) return; setActionError(null); setActiveStepIndex(index => Math.max(0, index - 1)); }} style={styles.secondaryButton}>
                <Text style={styles.secondaryButtonText}>Back</Text>
              </Pressable>
            ) : <View style={styles.secondarySpacer} />}
            <Pressable accessibilityRole="button" disabled={saving} onPress={() => void saveStep('skip')} style={styles.skipButton}>
              <Text style={styles.skipButtonText}>Skip for now</Text>
            </Pressable>
            <Pressable accessibilityRole="button" disabled={saving || !canComplete} onPress={() => void saveStep('complete')} style={[styles.primaryButton, (saving || !canComplete) && styles.disabled]}>
              {saving ? <ActivityIndicator color={colors.background} /> : <Text style={styles.primaryButtonText}>Continue</Text>}
            </Pressable>
          </View>
          <Text style={styles.footer}>Start where you are. Go as far as you want.</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
footer: { color: colors.mutedText, fontSize: 12, textAlign: 'center', marginTop: spacing.md },
  safe: { flex: 1, backgroundColor: colors.background },
  scrollContent: { flexGrow: 1 },
  content: { flex: 1, padding: spacing.lg, paddingTop: spacing.xl, gap: spacing.md },
  brand: { color: colors.warmWhite, fontSize: 18, fontWeight: '800', letterSpacing: 1.4, marginBottom: spacing.sm },
  gold: { color: colors.gold },
  stepRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  stepLabel: { color: colors.goldSoft, fontSize: 11, fontWeight: '800', letterSpacing: 1.1 },
  progressTrack: { height: 4, backgroundColor: colors.surfaceRaised, borderRadius: 4, overflow: 'hidden' },
  progressFill: { height: 4, backgroundColor: colors.gold, borderRadius: 4 },
  title: { color: colors.warmWhite, fontSize: 28, fontWeight: '800', lineHeight: 34, marginTop: spacing.sm },
  body: { color: colors.mutedText, fontSize: 15, lineHeight: 23 },
  helper: { color: colors.mutedText, fontSize: 13, lineHeight: 20 },
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.card, padding: spacing.md, marginTop: spacing.sm },
  options: { gap: spacing.sm },
  choice: { minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, padding: spacing.md, backgroundColor: colors.surfaceRaised, borderColor: colors.border, borderWidth: 1, borderRadius: radius.control },
  choiceCompact: { minHeight: 48, paddingHorizontal: spacing.sm, paddingVertical: spacing.sm },
  choiceSelected: { borderColor: colors.gold, backgroundColor: '#252117' },
  choiceCopy: { flex: 1, gap: 3 },
  choiceLabel: { color: colors.warmWhite, fontSize: 14, fontWeight: '700' },
  choiceLabelSelected: { color: colors.goldSoft },
  choiceDescription: { color: colors.mutedText, fontSize: 12, lineHeight: 17 },
  choiceIndicator: { width: 20, height: 20, borderRadius: 10, borderColor: colors.mutedText, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  choiceIndicatorSelected: { borderColor: colors.gold, backgroundColor: colors.gold },
  choiceIndicatorDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.background },
  dayGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  dayGridItem: { width: '48%' },
  notesBlock: { gap: spacing.xs, marginTop: spacing.sm },
  input: { minHeight: 88, color: colors.warmWhite, backgroundColor: colors.surfaceRaised, borderColor: colors.border, borderWidth: 1, borderRadius: radius.control, padding: spacing.md, textAlignVertical: 'top' },
  privacyNote: { color: colors.mutedText, fontSize: 12, lineHeight: 18, marginTop: spacing.xs },
  error: { color: colors.danger, fontSize: 13, lineHeight: 19 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.sm },
  primaryButton: { minHeight: 48, paddingHorizontal: spacing.md, backgroundColor: colors.gold, borderRadius: radius.control, alignItems: 'center', justifyContent: 'center', flex: 1 },
  primaryButtonText: { color: colors.background, fontWeight: '800', fontSize: 14 },
  secondaryButton: { minHeight: 48, paddingHorizontal: spacing.sm, backgroundColor: colors.surfaceRaised, borderColor: colors.border, borderWidth: 1, borderRadius: radius.control, alignItems: 'center', justifyContent: 'center' },
  secondaryButtonText: { color: colors.warmWhite, fontWeight: '700', fontSize: 13 },
  secondarySpacer: { width: 1 },
  skipButton: { minHeight: 48, paddingHorizontal: spacing.sm, alignItems: 'center', justifyContent: 'center' },
  skipButtonText: { color: colors.mutedText, fontWeight: '700', fontSize: 12 },
  disabled: { opacity: 0.45 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.md },
});
