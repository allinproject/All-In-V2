import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Redirect } from 'expo-router';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
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

const ACCESS_OPTIONS: Choice[] = [
  {value: 'home', label: 'At home'}, {value: 'gym', label: 'Gym'}, {value: 'outdoors', label: 'Outdoors'}, {value: 'mixed', label: 'A mix / depends'},
];

const FREQUENCY_OPTIONS: Choice[] = [
  {value: '1_2', label: '1–2 days/week'}, {value: '3_4', label: '3–4 days/week'}, {value: '5_plus', label: '5+ days/week'}, {value: 'varies', label: 'It varies'},
];
const TIME_OPTIONS: Choice[] = [
  {value: 'morning', label: 'Morning'}, {value: 'midday', label: 'Midday'}, {value: 'evening', label: 'Evening'}, {value: 'flexible', label: 'Flexible'},
];
const DURATION_OPTIONS: Choice[] = [
  {value: 'under_30', label: '< 30 min'}, {value: '30_60', label: '30–60 min'}, {value: '60_90', label: '60–90 min'}, {value: '90_plus', label: '90+ min'}, {value: 'varies', label: 'Varies'},
];
const DETAIL_OPTIONS: Choice[] = [
  {value: 'concise',label: 'Concise'}, {value: 'normal',label: 'Normal'}, {value: 'detailed',label: 'Detailed'},
];
const TONE_OPTIONS: Choice[] = [
  {value: 'supportive',label: 'Supportive'}, {value: 'neutral',label: 'Balanced'}, {value: 'direct',label: 'Direct'},
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
    eventGoal: asString(training.event_goal),
    trainingFrequency: asString(training.training_frequency),
    trainingVolume: asString(training.weekly_volume),
    preferredTime: asString(training.preferred_time),
    sessionLength: asString(training.session_length),
    scheduleNotes: asString(training.schedule_notes),
    trainingAccess: asString(training.training_access),
    constraintNotes: asString(training.constraint_notes),
    foodPreferences: asString(nutrition.food_preferences),
    fuelingNotes: asString(nutrition.fueling_notes),
    mealPrep: nutrition.meal_prep === true ? 'yes' : nutrition.meal_prep === false ? 'no' : '',
    coachDetail: asString(coach.detail_level) || 'normal',
    coachTone: asString(coach.tone) || 'neutral',
    currentSports: asStringArray(training.current_sports),
    availableDays: asStringArray(training.available_days),
    coachGuidance: asString(coach.guidance_style),
    foodSafety: asString(safety.selection),
    foodSafetyNotes: asString(safety.selection) === 'none' ? '' : asString(safety.notes),
    proactivity: asString(coach.guidance_style) || asString(notifications.proactivity_level),
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

export default function OnboardingRequiredScreen() {
  const { user, sessionGeneration } = useAuth();
  // A remount discards drafts, errors and retry IDs belonging to a prior session.
  return <OnboardingOwnerFlow key={v2OnboardingScreenKey(user?.id ?? null, sessionGeneration)} />;
}

function OnboardingOwnerFlow() {
  const { user, loading: authLoading } = useAuth();
  const gate = useAccessGate();
  const { height: windowHeight } = useWindowDimensions();
  const compactDevice = windowHeight < 735;
  const ownerId = user?.id ?? null;

  const [loadingState, setLoadingState] = useState(true);
  const [saving, setSaving] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [, setCompletedSteps] = useState<string[]>([]);
  const [, setSkippedSteps] = useState<string[]>([]);
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

  const stepOptions: readonly Choice[] = activeStep === 'focus' ? V2_ONBOARDING_FOCUS_OPTIONS
    : activeStep === 'training_pattern' ? TRAINING_OPTIONS
    : activeStep === 'availability' ? DAY_OPTIONS
    : activeStep === 'coach' ? ACCESS_OPTIONS
    : activeStep === 'food_safety' ? FOOD_OPTIONS
    : activeStep === 'proactivity' ? PROACTIVITY_OPTIONS
    : [];

  const isChoiceSelected = (value: string) => {
    switch (activeStep) {
      case 'focus': return answers.primaryFocus === value;
      case 'training_pattern': return answers.currentSports.includes(value);
      case 'availability': return answers.availableDays.includes(value);
      case 'coach': return answers.trainingAccess === value;
      case 'food_safety': return answers.foodSafety === value;
      case 'proactivity': return answers.proactivity === value;
      default: return false;
    }
  };

  const selectChoice = (value: string) => updateAnswers(current => {
    switch (activeStep) {
      case 'focus': return { ...current, primaryFocus: value };
      case 'training_pattern': return { ...current, currentSports: toggleValue(current.currentSports, value, 'not_currently_training') };
      case 'availability': return { ...current, availableDays: toggleValue(current.availableDays, value, 'flexible') };
      case 'coach': return { ...current, trainingAccess: value };
      case 'food_safety': return { ...current, foodSafety: value, foodSafetyNotes: value === 'none' ? '' : current.foodSafetyNotes };
      case 'proactivity': return { ...current, proactivity: value };
      default: return current;
    }
  });

  const stepPresentation: Record<OnboardingStep, { heading: string; subtitle: string; intro: string }> = {
    focus: { heading: 'What are you working toward?', subtitle: 'Your outcome, not your sport. You can add more goals later.', intro: "LET'S GET YOU STARTED" },
    training_pattern: { heading: 'What do you do now?', subtitle: 'Your current routine, not an ideal week. Coach will build from here.', intro: 'YOUR BASELINE' },
    availability: { heading: 'What fits your week?', subtitle: 'Real life first. Coach can adapt your plan around it.', intro: 'YOUR SCHEDULE' },
    coach: { heading: 'What should Coach work around?', subtitle: 'Equipment, access, and practical constraints.', intro: 'YOUR RESOURCES' },
    food_safety: { heading: 'How do you eat and fuel?', subtitle: 'Hard exclusions first, then preferences and Fuel.', intro: 'YOUR NUTRITION' },
    proactivity: { heading: 'How should Coach help?', subtitle: 'Choose the tone, detail, and initiative that work for you.', intro: 'YOUR COACH' },
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

  const presentation = stepPresentation[activeStep];
  const isDenseStep = activeStep === 'focus' || activeStep === 'training_pattern' || activeStep === 'availability';
  const isCompact = compactDevice || windowHeight < 860;
  const extraFields = activeStep === 'focus' && answers.primaryFocus === 'prepare_event'
    || activeStep === 'training_pattern' || activeStep === 'availability'
    || activeStep === 'coach' || activeStep === 'food_safety' || activeStep === 'proactivity';
  const renderMiniChoices = (label: string, options: readonly Choice[], selected: string, onSelect: (value: string) => void) => (
    <View style={styles.miniGroup}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.miniGrid}>
        {options.map(option => <Pressable
          key={option.value} accessibilityRole="radio" accessibilityState={{selected: selected === option.value}}
          disabled={saving} onPress={() => onSelect(option.value)}
          style={[styles.miniChip, selected === option.value && styles.focusOptionSelected]}
        ><Text numberOfLines={2} style={[styles.miniChipText, selected === option.value && styles.focusOptionTextSelected]}>{option.label}</Text></Pressable>)}
      </View>
    </View>
  );
  const renderTextField = (label: string, value: string, key: keyof OnboardingAnswers, placeholder: string, multiline = false) => (
    <View style={styles.miniGroup}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        accessibilityLabel={label} editable={!saving} multiline={multiline}
        value={value} onChangeText={text => updateAnswers(current => ({...current, [key]: text}))}
        placeholder={placeholder} placeholderTextColor={colors.mutedText}
        style={[styles.compactInput, !multiline && styles.singleInput]}
      />
    </View>
  );
  const chooser = (
    <View style={[styles.focusGrid, !isDenseStep && styles.stackedChoices]}>
      {stepOptions.map(option => {
        const selected = isChoiceSelected(option.value);
        return (
          <Pressable
            key={option.value}
            accessibilityRole={activeStep === 'training_pattern' || activeStep === 'availability' ? 'checkbox' : 'radio'}
            accessibilityState={{ selected, checked: selected, disabled: saving }}
            disabled={saving}
            onPress={() => selectChoice(option.value)}
            style={[
              styles.focusOption,
              !isDenseStep && styles.fullWidthOption,
              isCompact && styles.focusOptionCompact,
              selected && styles.focusOptionSelected,
            ]}
          >
            <View style={styles.choiceCopy}>
              <Text numberOfLines={2} style={[styles.focusOptionText, selected && styles.focusOptionTextSelected]}>{option.label}</Text>
              {option.description ? <Text numberOfLines={2} style={styles.optionDescription}>{option.description}</Text> : null}
            </View>
            {selected ? <Text style={styles.focusCheck}>✓</Text> : null}
          </Pressable>
        );
      })}
    </View>
  );

  const mainContent = (
    <View style={[styles.focusScreen, isCompact && styles.focusScreenCompact]}>
      <View style={styles.focusBrand}>
        <Image source={require('../assets/all-in-365-circle.jpg')} style={[styles.focusLogo, isCompact && styles.focusLogoCompact]} resizeMode="contain" accessibilityLabel="ALL IN 365 logo" />
        <Text style={styles.focusSlogan}>LIVE ALL IN.</Text>
      </View>
      <View style={styles.focusProgress}>
        <View style={styles.stepRow}>
          <Text style={styles.stepLabel}>{presentation.intro}</Text>
          <Text style={styles.stepLabel}>{String(stepNumber).padStart(2, '0')} / 06</Text>
        </View>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${(stepNumber / REQUIRED_V2_ONBOARDING_STEPS.length) * 100}%` }]} />
        </View>
      </View>
      <View style={styles.focusHeading}>
        <Text accessibilityRole="header" style={[styles.focusTitle, isCompact && styles.focusTitleCompact]}>{presentation.heading}</Text>
        <Text style={styles.focusDescription}>{presentation.subtitle}</Text>
      </View>
      {chooser}
      {activeStep === 'focus' && answers.primaryFocus === 'prepare_event'
        ? renderTextField('Race or event (optional)', answers.eventGoal, 'eventGoal', 'Event name / date') : null}
      {activeStep === 'training_pattern' ? (
        <View style={styles.extraGroup}>
          {renderMiniChoices('How often?', FREQUENCY_OPTIONS, answers.trainingFrequency, value => updateAnswers(current => ({...current, trainingFrequency: value})))}
          {renderTextField('Weekly volume (optional)', answers.trainingVolume, 'trainingVolume', 'e.g. 30 miles/week')}
        </View>
      ) : null}
      {activeStep === 'availability' ? (
        <View style={styles.extraGroup}>
          {renderMiniChoices('Usually what time?', TIME_OPTIONS, answers.preferredTime, value => updateAnswers(current => ({...current, preferredTime: value})))}
          {renderMiniChoices('Typical session length', DURATION_OPTIONS, answers.sessionLength, value => updateAnswers(current => ({...current, sessionLength: value})))}
          {renderTextField('Schedule constraints (optional)', answers.scheduleNotes, 'scheduleNotes', 'Shifts, travel, long-run days')}
        </View>
      ) : null}
      {activeStep === 'coach' ? renderTextField('Anything Coach should work around? (optional)', answers.constraintNotes, 'constraintNotes', 'Equipment, access or practical limitations', true) : null}
      {activeStep === 'food_safety' ? (
        <View style={styles.extraGroup}>
          {renderTextField('Hard exclusions or allergies (optional)', answers.foodSafetyNotes, 'foodSafetyNotes', 'Leave blank if none')}
          {renderTextField('Food preferences (optional)', answers.foodPreferences, 'foodPreferences', 'Foods you like or avoid')}
          {renderTextField('Training fuel (optional)', answers.fuelingNotes, 'fuelingNotes', 'What works during long sessions')}
          {renderMiniChoices('Do you meal prep?', [{value:'yes',label:'Yes'},{value:'no',label:'No'}], answers.mealPrep, value => updateAnswers(current => ({...current, mealPrep:value})))}
        </View>
      ) : null}
      {activeStep === 'proactivity' ? (
        <View style={styles.extraGroup}>
          {renderMiniChoices('Detail', DETAIL_OPTIONS, answers.coachDetail, value => updateAnswers(current => ({...current, coachDetail:value})))}
          {renderMiniChoices('Tone', TONE_OPTIONS, answers.coachTone, value => updateAnswers(current => ({...current, coachTone:value})))}
        </View>
      ) : null}
      <View style={styles.focusBottom}>
        {actionError ? <Text accessibilityRole="alert" style={styles.error}>{actionError}</Text> : null}
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: saving || !canComplete, busy: saving }}
          disabled={saving || !canComplete}
          onPress={() => void saveStep('complete')}
          style={[styles.focusContinue, (saving || !canComplete) && styles.disabled]}
        >
          {saving ? <ActivityIndicator color={colors.background} /> : <Text style={styles.focusContinueText}>{stepNumber === 6 ? 'Finish setup' : 'Continue'}</Text>}
        </Pressable>
        <View style={styles.bottomLinks}>
          {activeStepIndex > 0 ? (
            <Pressable accessibilityRole="button" disabled={saving} onPress={() => { if (saveGuard.current.isBusy()) return; setActionError(null); setActiveStepIndex(index => Math.max(0, index - 1)); }} style={styles.smallBack}>
              <Text style={styles.skipButtonText}>Back</Text>
            </Pressable>
          ) : <View style={styles.smallBack} />}
          <Pressable accessibilityRole="button" disabled={saving} onPress={() => void saveStep('skip')} style={styles.smallSkip}>
            <Text style={styles.skipButtonText}>I'll decide later</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.safe}>
      {extraFields ? (
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.notesScrollContent} keyboardShouldPersistTaps="handled">
            {mainContent}
          </ScrollView>
        </KeyboardAvoidingView>
      ) : mainContent}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {flex: 1, backgroundColor: colors.background},
  flex: {flex: 1},
  focusScreen: {flex: 1, paddingHorizontal: 22, paddingTop: 8, paddingBottom: 4, justifyContent: 'space-between', gap: 8},
  focusScreenCompact: {paddingHorizontal: 18, paddingTop: 2, gap: 4},
  focusBrand: {alignItems: 'center', gap: 1},
  focusLogo: {width: 76, height: 76, borderRadius: 38},
  focusLogoCompact: {width: 58, height: 58, borderRadius: 29},
  focusSlogan: {color: colors.gold, letterSpacing: 2.1, fontSize: 11, fontWeight: '900'},
  focusProgress: {gap: 8},
  stepRow: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'},
  stepLabel: {color: colors.goldSoft, fontSize: 11, fontWeight: '800', letterSpacing: 1.1},
  progressTrack: {height: 4, backgroundColor: colors.surfaceRaised, borderRadius: 4, overflow: 'hidden'},
  progressFill: {height: 4, backgroundColor: colors.gold, borderRadius: 4},
  focusHeading: {gap: 4},
  focusTitle: {fontSize: 31, fontWeight: '900', lineHeight: 36, color: colors.warmWhite},
  focusTitleCompact: {fontSize: 27, lineHeight: 31},
  focusDescription: {color: colors.mutedText, fontSize: 13, lineHeight: 19},
  focusGrid: {flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8},
  stackedChoices: {gap: 9},
  focusOption: {width: '48.6%', minHeight: 52, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: 11, paddingVertical: 7, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 3},
  fullWidthOption: {width: '100%', minHeight: 68, paddingHorizontal: 16},
  focusOptionCompact: {minHeight: 43, paddingVertical: 4, paddingHorizontal: 9},
  focusOptionSelected: {borderColor: colors.gold, backgroundColor: '#252117'},
  choiceCopy: {flex: 1, gap: 3},
  focusOptionText: {color: colors.warmWhite, fontSize: 13, lineHeight: 17, fontWeight: '700', flexShrink: 1},
  focusOptionTextSelected: {color: colors.goldSoft},
  optionDescription: {color: colors.mutedText, fontSize: 12, lineHeight: 17},
  focusCheck: {color: colors.gold, fontWeight: '900', fontSize: 16},
  fieldLabel: {fontSize: 12, fontWeight: '700', color: colors.warmWhite},
  compactNotes: {gap: 5},
  compactInput: {minHeight: 65, maxHeight: 100, color: colors.warmWhite, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 11, textAlignVertical: 'top', fontSize: 13},
  notesScrollContent: {flexGrow: 1, paddingBottom: 12},
  extraGroup: {gap: 8},
  miniGroup: {gap: 5},
  miniGrid: {flexDirection: 'row', flexWrap: 'wrap', gap: 6},
  miniChip: {minHeight: 35, paddingHorizontal: 10, paddingVertical: 7, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: 9, justifyContent: 'center'},
  miniChipText: {color: colors.warmWhite, fontSize: 12, fontWeight: '700'},
  singleInput: {minHeight: 40, maxHeight: 44},
  focusBottom: {gap: 6},
  focusContinue: {minHeight: 49, borderRadius: radius.control, backgroundColor: colors.gold, alignItems: 'center', justifyContent: 'center'},
  focusContinueText: {fontSize: 16, fontWeight: '900', color: colors.background},
  bottomLinks: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  smallBack: {minHeight: 36, minWidth: 82, alignItems: 'flex-start', justifyContent: 'center'},
  smallSkip: {minHeight: 36, minWidth: 110, alignItems: 'flex-end', justifyContent: 'center'},
  skipButtonText: {color: colors.mutedText, fontWeight: '700', fontSize: 12},
  disabled: {opacity: 0.45},
  error: {color: colors.danger, fontSize: 13, lineHeight: 19},
  loading: {flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.md},
  title: {color: colors.warmWhite, fontSize: 28, fontWeight: '800'},
  body: {color: colors.mutedText, fontSize: 15, lineHeight: 22},
  primaryButton: {minHeight: 48, paddingHorizontal: spacing.md, backgroundColor: colors.gold, borderRadius: radius.control, alignItems: 'center', justifyContent: 'center'},
  primaryButtonText: {color: colors.background, fontWeight: '800', fontSize: 14},
  helper: {color: colors.mutedText, fontSize: 13, lineHeight: 20},
});
