import { useEffect, useMemo, useState } from 'react';
import { Link, Redirect, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../src/auth/AuthProvider';
import { v2AuthenticatedScreenKey } from '../src/auth/authRoute';
import { useAccessGate } from '../src/auth/AccessGateProvider';
import { colors } from '../src/theme/tokens';
import { V2BottomNavigation } from '../src/navigation/V2BottomNavigation';
import {
  formatCalendarDay, formatCalendarMonth, firstOfMonth, monthCalendarWeeks,
  shiftCalendarDate, shiftCalendarMonth, weekDaysForDate, visibleCalendarReadRange,
  monthDayMarkerSummary, monthDayAccessibilityLabel, type CalendarWorkoutMarker,
} from '../src/features/training/calendarDayView';
import { validAthleteLocalDate } from '../src/features/training/manualActivityDraft';
import { combineCalendarReads, calendarDaySections } from '../src/features/training/trainingCalendarReadModel';
import {projectEventPlanOwnerSnapshot} from '../src/features/training/eventPlanOwnerPresentation';
import {EventPlanListContent} from '../src/features/training/EventPlanListContent';
import {TrainingPlanContent} from '../src/features/training/TrainingPlanContent';
import {projectAcceptedTrainingPlans} from '../src/features/training/trainingPlanOwnerProjection';
import {RoutesRoutinesContent} from '../src/features/training/RoutesRoutinesContent';

function todayOnDevice(): string {
  const now = new Date();
  return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
}
const weekdayLabels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
type CalendarLevel = 'month' | 'week';
type TrainTab = 'calendar' | 'plans' | 'routes_routines';
type PlansTab = 'training' | 'event';
// Canonical Training/Completed Activity readers are not yet approved or connected.
// The mounted view consumes the shared verified read model, never synthetic workouts.
const markerSymbols: Record<CalendarWorkoutMarker['kind'], string> = {
  running: 'Run', walking: 'Walk', cycling: 'Bike', swimming: 'Swim',
  strength: 'Lift', hiking: 'Hike', rucking: 'Ruck', rowing: 'Row',
  elliptical: 'Ellip', stair: 'Stair', yoga: 'Yoga', mobility: 'Move', other: 'Other',
  rest: 'Rest', recovery: 'Recover', unavailable: 'Unavailable',
  race: 'Race', review_required: 'Review',
};

/**
 * ALL-246 opens current Week + today, switches to Month overview and back by day selection.
 * The Training and Completed Activity readers are NOT connected yet:
 * unavailable evidence is never represented as empty workouts.
 */
export default function TrainingCalendarScreen() {
  const { user, sessionGeneration } = useAuth();
  return <TrainingCalendarOwnerScreen key={v2AuthenticatedScreenKey(user?.id ?? null, sessionGeneration)} />;
}

function TrainingCalendarOwnerScreen() {
  const { user, loading, sessionGeneration } = useAuth();
  const params = useLocalSearchParams<{ date?: string }>();
  const gate = useAccessGate();
  const initialDay = typeof params.date === 'string' && validAthleteLocalDate(params.date)
    ? params.date : todayOnDevice();
  const [day, setDay] = useState(initialDay);
  const [month, setMonth] = useState(firstOfMonth(initialDay) ?? initialDay);
  const [level, setLevel] = useState<CalendarLevel>('week');
  const [activeTab, setActiveTab] = useState<TrainTab>('calendar');
  const [plansTab, setPlansTab] = useState<PlansTab>('training');
  // A mounted Train route can receive a new date after Add Workout returns.
  // Only a valid explicit route-date change should select a different day.
  useEffect(() => {
    if (typeof params.date !== 'string' || !validAthleteLocalDate(params.date)) return;
    setDay(params.date);
    setMonth(firstOfMonth(params.date) ?? params.date);
    setLevel('week');
  }, [params.date]);
  const week = weekDaysForDate(day);
  const monthWeeks = monthCalendarWeeks(month);
  const visibleRange = visibleCalendarReadRange(level, level === 'month' ? month : day);
  const readModel = useMemo(() => combineCalendarReads({
    ownerId: user?.id ?? '',
    fromDate: visibleRange?.fromDate ?? '',
    throughDate: visibleRange?.throughDate ?? '',
    planned: {status:'unavailable'},
    completed: {status:'unavailable'},
  }), [user?.id, visibleRange?.fromDate, visibleRange?.throughDate]);
  const workoutEvidence = readModel.markers;
  const daySections = calendarDaySections(readModel, day);

  if (!loading && !user) return <Redirect href="/sign-in" />;
  if (gate.status === 'legal_required') return <Redirect href="/legal-acceptance" />;
  if (gate.status === 'onboarding_required') return <Redirect href="/onboarding-required" />;
  if (gate.status !== 'ready' || !user) return <Redirect href="/" />;

  function selectDate(selected: string) {
    setDay(selected);
    setMonth(firstOfMonth(selected) ?? month);
    setLevel('week');
  }
  function changeWeek(offset: number) {
    const next = shiftCalendarDate(day, offset * 7);
    if (next) {
      setDay(next);
      setMonth(firstOfMonth(next) ?? month);
    }
  }
  function changeMonth(offset: number) {
    const next = shiftCalendarMonth(month, offset);
    if (next) setMonth(next);
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <Link href="/home" asChild>
          <Pressable accessibilityRole="button" style={styles.back}>
            <Text style={styles.muted}>‹ Today</Text>
          </Pressable>
        </Link>
        <Text style={styles.brand}>ALL IN <Text style={styles.gold}>365</Text></Text>
        <Text accessibilityRole="header" style={styles.title}>Train</Text>
        <View style={styles.compactTabs} accessibilityRole="tablist">
          {([
            ['calendar', 'Calendar'], ['plans', 'Plans'], ['routes_routines', 'Routes/Routines'],
          ] as const).map(([tab, label]) => (
            <Pressable key={tab} accessibilityRole="tab" accessibilityState={{selected: activeTab === tab}}
              accessibilityLabel={label} onPress={() => setActiveTab(tab)}
              style={[styles.compactTab, activeTab === tab && styles.activeCompactTab]}>
              <Text style={[styles.compactTabText, activeTab === tab && styles.activeCompactTabText]}>{label}</Text>
            </Pressable>
          ))}
        </View>
        {activeTab === 'calendar' ? (
          <>
        <View style={styles.compactTabs} accessibilityRole="tablist">
          {([['month', 'Month'], ['week', 'Week']] as const).map(([choice, label]) => (
            <Pressable key={choice} accessibilityRole="tab"
              accessibilityState={{ selected: level === choice }}
              accessibilityLabel={label + ' calendar'}
              onPress={() => {
                if (choice === 'month') setMonth(firstOfMonth(day) ?? month);
                setLevel(choice);
              }}
              style={[styles.compactTab, level === choice && styles.activeCompactTab]}>
              <Text style={[styles.compactTabText, level === choice && styles.activeCompactTabText]}>{label}</Text>
            </Pressable>
          ))}
        </View>
        {level === 'month' ? (
          <>
            <View style={styles.header}>
              <Pressable accessibilityRole="button" accessibilityLabel="Previous month"
                onPress={() => changeMonth(-1)} style={styles.arrow}><Text style={styles.white}>‹</Text></Pressable>
              <Text style={styles.headerTitle}>{formatCalendarMonth(month)}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Next month"
                onPress={() => changeMonth(1)} style={styles.arrow}><Text style={styles.white}>›</Text></Pressable>
            </View>
            <View style={styles.week}>
              {weekdayLabels.map((label, i) => <Text key={i} style={[styles.weekdayLabel, styles.weekCell]}>{label}</Text>)}
            </View>
            {monthWeeks.map(days => (
              <View key={days[0]} style={styles.week}>
                {days.map(date => (
                  <Pressable key={date} accessibilityRole="button"
                    accessibilityLabel={monthDayAccessibilityLabel(workoutEvidence, date)}
                    onPress={() => selectDate(date)}
                    style={[styles.monthDay, date.slice(0,7) !== month.slice(0,7) && styles.outsideMonth]}>
                    <Text style={date.slice(0,7) === month.slice(0,7) ? styles.white : styles.muted}>{Number(date.slice(-2))}</Text>
                    {monthDayMarkerSummary(workoutEvidence, date).visible.map((item, index) => (
                      <Text key={index} style={styles.marker} accessibilityLabel={`${markerSymbols[item.kind]} ${item.status}`}>
                        {markerSymbols[item.kind]} {item.status === 'completed' ? '✓' : item.status === 'missed' ? '!' : item.status === 'rest' ? '–' : item.status === 'recovery' ? '~' : '•'}
                      </Text>
                    ))}
                    {monthDayMarkerSummary(workoutEvidence, date).additionalCount > 0 && (
                      <Text style={styles.marker} accessibilityLabel={`${monthDayMarkerSummary(workoutEvidence, date).additionalCount} additional activities`}>
                        +{monthDayMarkerSummary(workoutEvidence, date).additionalCount}
                      </Text>
                    )}
                  </Pressable>
                ))}
              </View>
            ))}
          </>
        ) : (
          <>
            <View style={styles.header}>
              <Pressable accessibilityRole="button" accessibilityLabel="Previous week"
                onPress={() => changeWeek(-1)} style={styles.arrow}><Text style={styles.white}>‹</Text></Pressable>
              <View style={styles.date}>
                <Text style={styles.headerTitle}>{formatCalendarMonth(day)}</Text>
                <Text style={styles.muted}>Week of {week[0] ? formatCalendarDay(week[0]) : 'Unknown'}</Text>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel="Next week"
                onPress={() => changeWeek(1)} style={styles.arrow}><Text style={styles.white}>›</Text></Pressable>
            </View>
            <View style={styles.week}>
              {week.map((date, i) => (
                <Pressable accessibilityRole="button" accessibilityLabel={formatCalendarDay(date)}
                  accessibilityState={{ selected: date === day }} onPress={() => setDay(date)} key={date}
                  style={[styles.weekDay, date === day && styles.selected]}>
                  <Text style={styles.muted}>{weekdayLabels[i]}</Text>
                  <Text style={styles.white}>{Number(date.slice(-2))}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.dayTitle}>{formatCalendarDay(day)}</Text>
            <View style={styles.activities}>
              <Text style={styles.section}>Activities</Text>
              {daySections.scheduled.status === 'ready'
                ? daySections.scheduled.records.map(item => (
                    <View key={'planned:' + item.id} style={styles.workoutRow}>
                      <Text style={styles.white}>{markerSymbols[item.sport]}</Text>
                      <Text style={styles.muted}>{item.state === 'planned' ? 'Scheduled' : item.state === 'missed' ? 'Missed' : item.state === 'rest' ? 'Rest day' : 'Recovery'}</Text>
                    </View>
                  ))
                : null}
              {daySections.completed.status === 'ready'
                ? daySections.completed.records.map(item => (
                    <View key={'completed:' + item.id} style={styles.workoutRow}>
                      <Text style={styles.white}>{markerSymbols[item.sport]}</Text>
                      <Text style={styles.muted}>Completed</Text>
                    </View>
                  ))
                : null}
              {daySections.scheduled.status !== 'ready' || daySections.completed.status !== 'ready'
                ? <Text style={styles.muted}>Workout history is not connected yet.</Text>
                : daySections.scheduled.records.length === 0 && daySections.completed.records.length === 0
                  ? <Text style={styles.muted}>No activities recorded for this day.</Text>
                  : null}
              <Link href={{ pathname: '/add-workout', params: { date: day } }} asChild>
                <Pressable accessibilityRole="button" style={styles.addButton}>
                  <Text style={styles.addText}>+ Add Workout</Text>
                </Pressable>
              </Link>
            </View>
          </>
        )}
          </>
        ) : activeTab === 'plans' ? (
          <>
            <View style={styles.compactTabs} accessibilityRole="tablist">
              {([['training', 'Training Plan'], ['event', 'Event Plan']] as const).map(([tab, label]) => (
                <Pressable key={tab} accessibilityRole="tab"
                  accessibilityState={{selected: plansTab === tab}}
                  onPress={() => setPlansTab(tab)}
                  style={[styles.compactTab, plansTab === tab && styles.activeCompactTab]}>
                  <Text style={[styles.compactTabText, plansTab === tab && styles.activeCompactTabText]}>{label}</Text>
                </Pressable>
              ))}
            </View>
            {plansTab === 'training' ? (
              <TrainingPlanContent evidence={projectAcceptedTrainingPlans(user.id, sessionGeneration, { status: 'unavailable' })} />
            ) : (
              <EventPlanListContent ownerId={user.id} sessionGeneration={sessionGeneration}
                projection={projectEventPlanOwnerSnapshot({
                expectedOwnerId:user.id,
                authenticatedOwnerId:user.id,
                sessionGeneration,
                accessGateReady:gate.status==='ready',
                // No certified Event owner reader yet. Do NOT fabricate a
                // complete empty snapshot or accept client-created event data.
                snapshot:null,
                today:todayOnDevice(),
              })}/>
            )}
          </>
        ) : (
          <RoutesRoutinesContent />
        )}
      </ScrollView>
      <V2BottomNavigation />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {flex:1,backgroundColor:colors.background},
  content:{padding:24,gap:16,paddingBottom:52},
  back:{minHeight:42,justifyContent:'center'},
  brand:{fontSize:16,fontWeight:'800',color:colors.warmWhite},
  gold:{color:colors.gold},
  title:{fontSize:30,fontWeight:'800',color:colors.warmWhite},
  muted:{color:colors.mutedText,fontSize:13,lineHeight:20},
  white:{color:colors.warmWhite,fontSize:15,fontWeight:'700'},
  header:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:8},
  headerTitle:{color:colors.warmWhite,fontSize:18,fontWeight:'800',textAlign:'center'},
  arrow:{backgroundColor:colors.surfaceRaised,borderRadius:10,paddingHorizontal:17,minHeight:44,justifyContent:'center'},
  date:{flex:1,alignItems:'center',gap:3},
  week:{flexDirection:'row',gap:4,justifyContent:'space-between'},
  weekdayLabel:{textAlign:'center',color:colors.mutedText,fontWeight:'700'},
  weekCell:{flex:1},
  monthDay:{flex:1,minHeight:56,alignItems:'center',justifyContent:'center',borderColor:colors.border,borderWidth:1,borderRadius:10,backgroundColor:colors.surface,gap:3},
  marker:{fontSize:9,color:colors.goldSoft,textAlign:'center'},
  outsideMonth:{backgroundColor:colors.background},
  weekDay:{flex:1,minHeight:62,alignItems:'center',justifyContent:'center',backgroundColor:colors.surface,borderColor:colors.border,borderWidth:1,borderRadius:10,gap:4},
  selected:{borderColor:colors.gold,borderWidth:2,backgroundColor:colors.surfaceRaised},
  dayTitle:{fontSize:18,color:colors.warmWhite,fontWeight:'800'},
  card:{backgroundColor:colors.surface,borderRadius:18,padding:18,gap:14,borderColor:colors.border,borderWidth:1},
  workoutRow:{paddingVertical:12,gap:4,borderBottomColor:colors.border,borderBottomWidth:1},
  activities:{paddingVertical:12,gap:10},
  section:{fontSize:18,fontWeight:'800',color:colors.warmWhite},
  addButton:{minHeight:48,borderColor:colors.gold,borderWidth:1,borderRadius:8,justifyContent:'center',alignItems:'center',backgroundColor:colors.background,marginTop:6},
  addText:{color:colors.goldSoft,fontSize:16,fontWeight:'800'},
  note:{color:colors.mutedText,fontSize:12,lineHeight:18},
  compactTabs:{flexDirection:'row',gap:4,alignItems:'stretch'},
  compactTab:{flex:1,minWidth:0,minHeight:44,alignItems:'center',justifyContent:'center',borderRadius:10,borderWidth:1,borderColor:colors.border,backgroundColor:colors.surface,paddingHorizontal:3},
  activeCompactTab:{borderColor:colors.gold,backgroundColor:colors.surfaceRaised},
  compactTabText:{fontSize:12,fontWeight:'600',color:colors.mutedText,textAlign:'center'},
  activeCompactTabText:{color:colors.goldSoft,fontWeight:'800'},
});
