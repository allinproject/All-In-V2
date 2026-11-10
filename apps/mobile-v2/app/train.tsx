import { useState } from 'react';
import { Link, Redirect } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../src/auth/AuthProvider';
import { useAccessGate } from '../src/auth/AccessGateProvider';
import { colors } from '../src/theme/tokens';
import { formatCalendarDay, shiftCalendarDate, weekDaysForDate } from '../src/features/training/calendarDayView';

function todayOnDevice(): string {
  const now = new Date();
  return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
}

/**
 * ALL-246 first mounted calendar/day entry point.
 * No canonical schedule or completed-activity reader is connected yet.
 * Never render the absence of a reader as an empty workout history.
 */
export default function TrainingCalendarScreen() {
  const { user, loading } = useAuth();
  const gate = useAccessGate();
  const [day, setDay] = useState(todayOnDevice);
  const week = weekDaysForDate(day);

  if (!loading && !user) return <Redirect href="/sign-in" />;
  if (gate.status === 'legal_required') return <Redirect href="/legal-acceptance" />;
  if (gate.status === 'onboarding_required') return <Redirect href="/onboarding-required" />;
  if (gate.status !== 'ready' || !user) return <Redirect href="/" />;

  function changeDay(offset: number) {
    const next = shiftCalendarDate(day, offset);
    if (next) setDay(next);
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
        <View style={styles.dayHeader}>
          <Pressable accessibilityRole="button" accessibilityLabel="Previous day" onPress={() => changeDay(-1)} style={styles.arrow}><Text style={styles.white}>‹</Text></Pressable>
          <View style={styles.date}>
            <Text style={styles.white}>{formatCalendarDay(day)}</Text>
            <Text style={styles.muted}>Select a day below</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Next day" onPress={() => changeDay(1)} style={styles.arrow}><Text style={styles.white}>›</Text></Pressable>
        </View>
        <View style={styles.week}>
          {week.map(date => (
            <Pressable accessibilityRole="button" accessibilityLabel={formatCalendarDay(date)}
              accessibilityState={{ selected: date === day }} onPress={() => setDay(date)} key={date}
              style={[styles.dayButton, date === day && styles.selected]}>
              <Text style={styles.muted}>{['M','T','W','T','F','S','S'][week.indexOf(date)]}</Text>
              <Text style={styles.white}>{Number(date.slice(-2))}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.card}>
          <Text style={styles.section}>Scheduled Workouts</Text>
          <Text style={styles.muted}>Your accepted Training schedule is not connected to this screen yet. No planned workouts are being hidden or marked complete.</Text>
          <Link href={{ pathname: '/add-workout', params: { date: day } }} asChild>
            <Pressable accessibilityRole="button" style={styles.addButton}>
              <Text style={styles.addText}>+ Add Workout</Text>
            </Pressable>
          </Link>
        </View>
        <View style={styles.card}>
          <Text style={styles.section}>Completed Activities</Text>
          <Text style={styles.muted}>Your recorded activities will appear here when the canonical Completed Activity reader is connected. This is not an empty-history result.</Text>
        </View>
        <Text style={styles.note}>Calendar dates currently use this device's local timezone. Athlete-profile timezone authority and verified workout lists remain pending.</Text>
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
  dayHeader:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',gap:8},
  arrow:{backgroundColor:colors.surfaceRaised,borderRadius:10,paddingHorizontal:17,minHeight:44,justifyContent:'center'},
  date:{alignItems:'center',gap:3,flex:1},
  week:{flexDirection:'row',gap:4,justifyContent:'space-between'},
  dayButton:{flex:1,minHeight:62,alignItems:'center',justifyContent:'center',backgroundColor:colors.surface,borderColor:colors.border,borderWidth:1,borderRadius:10,gap:4},
  selected:{borderColor:colors.gold,borderWidth:2,backgroundColor:colors.surfaceRaised},
  card:{backgroundColor:colors.surface,borderRadius:18,padding:18,gap:14,borderColor:colors.border,borderWidth:1},
  section:{fontSize:18,fontWeight:'800',color:colors.warmWhite},
  addButton:{minHeight:48,borderColor:colors.gold,borderWidth:1,borderRadius:14,justifyContent:'center',alignItems:'center',backgroundColor:colors.surfaceRaised},
  addText:{color:colors.goldSoft,fontSize:16,fontWeight:'800'},
  note:{color:colors.mutedText,fontSize:12,lineHeight:18},
});
