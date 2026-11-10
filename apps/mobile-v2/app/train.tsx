import { useEffect, useMemo, useState } from 'react';
import { Link, Redirect, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../src/auth/AuthProvider';
import { useAccessGate } from '../src/auth/AccessGateProvider';
import { colors } from '../src/theme/tokens';
import {
  formatCalendarDay, formatCalendarMonth, firstOfMonth, monthCalendarWeeks,
  shiftCalendarDate, shiftCalendarMonth, weekDaysForDate, visibleCalendarReadRange,
  monthDayMarkerSummary, monthDayAccessibilityLabel, type CalendarWorkoutMarker,
} from '../src/features/training/calendarDayView';
import { validAthleteLocalDate } from '../src/features/training/manualActivityDraft';
import { combineCalendarReads, calendarDaySections } from '../src/features/training/trainingCalendarReadModel';

function todayOnDevice(): string {
  const now = new Date();
  return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
}
const weekdayLabels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
type CalendarLevel = 'month' | 'week';
// Canonical Training/Completed Activity readers are not yet approved or connected.
// The mounted view consumes the shared verified read model, never synthetic workouts.
const markerSymbols: Record<CalendarWorkoutMarker['kind'], string> = {
  running: 'Run', walking: 'Walk', cycling: 'Bike', swimming: 'Swim',
  strength: 'Lift', hiking: 'Hike', rucking: 'Ruck', rowing: 'Row',
  elliptical: 'Ellip', stair: 'Stair', yoga: 'Yoga', mobility: 'Move', other: 'Other',
  rest: 'Rest', recovery: 'Recover',
};

/**
 * ALL-246 opens current Week + today, switches to Month overview and back by day selection.
 * The Training and Completed Activity readers are NOT connected yet:
 * unavailable evidence is never represented as empty workouts.
 */
export default function TrainingCalendarScreen() {
  const { user, loading } = useAuth();
  const params = useLocalSearchParams<{ date?: string }>();
  const gate = useAccessGate();
  const initialDay = typeof params.date === 'string' && validAthleteLocalDate(params.date)
    ? params.date : todayOnDevice();
  const [day, setDay] = useState(initialDay);
  const [month, setMonth] = useState(firstOfMonth(initialDay) ?? initialDay);
  const [level, setLevel] = useState<CalendarLevel>('week');
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
        <Text accessibilityRole="header" style={styles.title}>Training Calendar</Text>
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
            <Text style={styles.note}>Tap a day to open its week and show that day's workouts. Sport/status markers will appear when verified scheduled and completed workout data is connected; the current calendar cannot load those records yet.</Text>
          </>
        ) : (
          <>
            <Pressable accessibilityRole="button" onPress={() => setLevel('month')} style={styles.back}>
              <Text style={styles.muted}>‹ Month view</Text>
            </Pressable>
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
            <View style={styles.card}>
              <Text style={styles.section}>Scheduled Workouts</Text>
              {daySections.scheduled.status === 'ready'
                ? daySections.scheduled.records.length
                  ? daySections.scheduled.records.map(item => (
                    <View key={item.id} style={styles.workoutRow}>
                      <Text style={styles.white}>{markerSymbols[item.sport]}</Text>
                      <Text style={styles.muted}>{item.state === 'planned' ? 'Scheduled' : item.state === 'missed' ? 'Missed' : item.state === 'rest' ? 'Rest day' : 'Recovery'} · {item.athleteLocalDate}</Text>
                    </View>
                  ))
                  : <Text style={styles.muted}>No scheduled workouts for this day in the verified plan.</Text>
                : <Text style={styles.muted}>Your accepted Training schedule is not connected yet. Workouts may exist; none are being marked complete or hidden as an empty plan.</Text>}
              <Link href={{ pathname: '/add-workout', params: { date: day } }} asChild>
                <Pressable accessibilityRole="button" style={styles.addButton}>
                  <Text style={styles.addText}>+ Add Workout</Text>
                </Pressable>
              </Link>
            </View>
            <View style={styles.card}>
              <Text style={styles.section}>Completed Activities</Text>
              {daySections.completed.status === 'ready'
                ? daySections.completed.records.length
                  ? daySections.completed.records.map(item => (
                    <View key={item.id} style={styles.workoutRow}>
                      <Text style={styles.white}>{markerSymbols[item.sport]}</Text>
                      <Text style={styles.muted}>Completed · {item.athleteLocalDate}</Text>
                    </View>
                  ))
                  : <Text style={styles.muted}>No completed activities for this day in the verified history.</Text>
                : <Text style={styles.muted}>The canonical activity reader is not connected yet. This is not an empty-history result.</Text>}
            </View>
          </>
        )}
        <Text style={styles.note}>Dates currently follow this device's local timezone. Athlete-profile timezone and real workout records remain pending.</Text>
      </ScrollView>
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
  workoutRow:{backgroundColor:colors.surfaceRaised,borderRadius:12,padding:12,gap:4},
  section:{fontSize:18,fontWeight:'800',color:colors.warmWhite},
  addButton:{minHeight:48,borderColor:colors.gold,borderWidth:1,borderRadius:14,justifyContent:'center',alignItems:'center',backgroundColor:colors.surfaceRaised},
  addText:{color:colors.goldSoft,fontSize:16,fontWeight:'800'},
  note:{color:colors.mutedText,fontSize:12,lineHeight:18},
});
