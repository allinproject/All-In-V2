import { useEffect, useState } from 'react';
import { AccessibilityInfo, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { colors } from '../../theme/tokens';
import { advanceGuide, guideProgress, initialGuidePosition, rewindGuide, type GuidedStep, type GuidePosition } from './profileGuide';

type Props = { title: string; steps: readonly GuidedStep[]; onExit: () => void; onPositionChange?: (position:GuidePosition) => void };
/** Reusable in-screen tutorial controller. It never interacts with domain actions. */
export function GuidedTourPanel({ title, steps, onExit, onPositionChange }: Props) {
  const [position, setPosition] = useState(initialGuidePosition);
  const { height: windowHeight } = useWindowDimensions();
  useEffect(() => { onPositionChange?.(position); }, [position, onPositionChange]);
  const announcedStep = steps.length ? steps[Math.max(0, Math.min(position.index, steps.length-1))] : null;
  useEffect(() => {
    if (!announcedStep) return;
    const message = position.done ? `${title}: guide complete.` : `${title}: ${announcedStep.title}. ${announcedStep.body}`;
    void AccessibilityInfo.announceForAccessibility(message);
  }, [announcedStep, position.done, title]);
  if (!steps.length) return null;
  const current = guideProgress(position, steps.length);
  const step = steps[current.index];
  return <View accessibilityLabel={title} style={[styles.panel,{maxHeight: Math.max(220,windowHeight * 0.52)}]}>
    <View style={styles.row}>
      <Text style={styles.eyebrow}>{title} · {current.index + 1} of {steps.length}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Exit tutorial" onPress={onExit} style={styles.smallButton}>
        <Text style={styles.link}>Exit</Text>
      </Pressable>
    </View>
    <Text accessibilityRole="header" accessibilityLiveRegion="polite" style={styles.heading}>{current.done ? 'Guide complete' : step.title}</Text>
    <ScrollView style={styles.copyScroll} nestedScrollEnabled accessibilityLabel="Tutorial instructions">
      <Text style={styles.body}>
        {current.done ? 'You can use the real controls when you are ready. This guide did not change any of your data.' : step.body}
      </Text>
    </ScrollView>
    <View style={styles.row}>
      {!current.done && current.index > 0
        ? <Pressable accessibilityRole="button" style={styles.secondary} onPress={() => setPosition(old => rewindGuide(old,steps.length))}><Text style={styles.secondaryText}>Back</Text></Pressable>
        : <View />}
      {current.done
        ? <Pressable accessibilityRole="button" style={styles.primary} onPress={onExit}><Text style={styles.primaryText}>Close</Text></Pressable>
        : <Pressable accessibilityRole="button" style={styles.primary} onPress={() => setPosition(old => advanceGuide(old,steps.length))}><Text style={styles.primaryText}>{current.index===steps.length-1?'Finish':'Next'}</Text></Pressable>}
    </View>
  </View>;
}
const styles=StyleSheet.create({
  panel:{backgroundColor:colors.surfaceRaised,borderWidth:1,borderColor:colors.gold,borderRadius:16,padding:16,gap:12},
  row:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:12},
  eyebrow:{color:colors.goldSoft,fontSize:12,fontWeight:'800',flexShrink:1},
  heading:{color:colors.warmWhite,fontSize:19,fontWeight:'800'},
  body:{color:colors.warmWhite,fontSize:14,lineHeight:21},
  copyScroll:{flexShrink:1},
  link:{color:colors.goldSoft,fontWeight:'800'},
  smallButton:{paddingVertical:8,paddingHorizontal:10},
  secondary:{borderWidth:1,borderColor:colors.border,borderRadius:12,paddingHorizontal:16,paddingVertical:11},
  secondaryText:{color:colors.warmWhite,fontWeight:'800'},
  primary:{backgroundColor:colors.gold,borderRadius:12,paddingHorizontal:20,paddingVertical:12},
  primaryText:{color:colors.background,fontWeight:'800'},
});
