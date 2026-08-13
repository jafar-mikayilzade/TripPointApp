import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { ThemeColors } from '../constants/theme';
import { hasSeenFirstRunCoach, markFirstRunCoachSeen } from '../lib/firstRunCoach';
import { useThemeColors } from '../theme/ThemeProvider';

type Spot = { x: number; y: number; w: number; h: number };

type Step = {
  id: 'planla' | 'aiPlan' | 'icma' | 'menu';
  title: string;
  body: string;
  spot: Spot;
  tooltipAbove: boolean;
};

type Props = {
  tabBarHeight: number;
};

function buildSteps(width: number, height: number, tabBarHeight: number, topInset: number): Step[] {
  const slot = width / 5;
  const tabSpot = (index: number): Spot => {
    const w = Math.min(70, slot - 6);
    return {
      x: slot * index + (slot - w) / 2,
      y: height - tabBarHeight + 4,
      w,
      h: Math.max(48, tabBarHeight - 14),
    };
  };

  return [
    {
      id: 'planla',
      title: 'Planla',
      body: 'Öz marşrutunuzu əl ilə qurun. Xəritədən və ya siyahıdan yer seçin.',
      spot: tabSpot(1),
      tooltipAbove: true,
    },
    {
      id: 'aiPlan',
      title: 'AI Plan',
      body: 'Region, gün və maraqları seçin — AI sizin üçün marşrut hazırlasın.',
      spot: tabSpot(2),
      tooltipAbove: true,
    },
    {
      id: 'icma',
      title: 'İcma',
      body: 'Tur, carpool və yerli xidmət elanlarına baxın, qoşulun və ya elan paylaşın.',
      spot: tabSpot(3),
      tooltipAbove: true,
    },
    {
      id: 'menu',
      title: 'Menyu',
      body: 'Profil, bildirişlər, marşrutlar və abunələr hamburger düyməsindədir (sağ yuxarı).',
      spot: {
        x: width - 52,
        y: topInset + 8,
        w: 42,
        h: 42,
      },
      tooltipAbove: false,
    },
  ];
}

export function FirstRunCoach({ tabBarHeight }: Props) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const { width, height } = Dimensions.get('window');

  const [ready, setReady] = useState(false);
  const [visible, setVisible] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);

  const pulse = useRef(new Animated.Value(1)).current;

  const steps = useMemo(
    () => buildSteps(width, height, tabBarHeight, insets.top),
    [width, height, tabBarHeight, insets.top]
  );
  const step = steps[stepIndex];

  useEffect(() => {
    let cancelled = false;
    void hasSeenFirstRunCoach().then((seen) => {
      if (cancelled || seen) {
        setReady(true);
        return;
      }
      setVisible(true);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!visible || revealed) {
      pulse.stopAnimation();
      pulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.08, duration: 650, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 650, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [visible, revealed, pulse, stepIndex]);

  async function finish() {
    setVisible(false);
    await markFirstRunCoachSeen();
  }

  function goNext() {
    if (stepIndex >= steps.length - 1) {
      void finish();
      return;
    }
    setRevealed(false);
    setStepIndex((i) => i + 1);
  }

  if (!ready || !visible || !step) {
    return null;
  }

  const s = step.spot;
  const tooltipTop = step.tooltipAbove
    ? s.y - 118
    : s.y + s.h + 12;

  return (
    <Modal transparent visible animationType="fade" statusBarTranslucent>
      <View style={styles.root}>
        {/* Punch a hole so the real control stays visible */}
        <View style={[styles.dim, { top: 0, left: 0, right: 0, height: s.y }]} />
        <View style={[styles.dim, { top: s.y, left: 0, width: s.x, height: s.h }]} />
        <View
          style={[
            styles.dim,
            { top: s.y, left: s.x + s.w, right: 0, height: s.h },
          ]}
        />
        <View style={[styles.dim, { top: s.y + s.h, left: 0, right: 0, bottom: 0 }]} />

        <Animated.View
          style={[
            styles.spot,
            {
              left: s.x,
              top: s.y,
              width: s.w,
              height: s.h,
              transform: [{ scale: revealed ? 1 : pulse }],
            },
          ]}
        >
          <Pressable
            style={styles.spotHit}
            onPress={() => setRevealed(true)}
            accessibilityLabel={step.title}
          />
        </Animated.View>

        {revealed ? (
          <View
            style={[
              styles.tooltip,
              { top: Math.max(insets.top + 8, tooltipTop), left: 16, right: 16 },
            ]}
          >
            <Text style={styles.tooltipTitle}>{step.title}</Text>
            <Text style={styles.tooltipBody}>{step.body}</Text>
            <View style={styles.tooltipRow}>
              <Pressable onPress={() => void finish()} hitSlop={8}>
                <Text style={styles.skip}>Keç</Text>
              </Pressable>
              <Pressable style={styles.nextBtn} onPress={goNext}>
                <Text style={styles.nextText}>
                  {stepIndex >= steps.length - 1 ? 'Başa düşdüm' : 'Növbəti'}
                </Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <View style={[styles.hintWrap, { bottom: tabBarHeight + 12 }]} pointerEvents="box-none">
            <Text style={styles.tapHint}>İşarələnən yerə toxunun</Text>
            <Pressable onPress={() => void finish()} hitSlop={8}>
              <Text style={styles.skipLight}>Keç</Text>
            </Pressable>
          </View>
        )}
      </View>
    </Modal>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: {
      flex: 1,
    },
    dim: {
      position: 'absolute',
      backgroundColor: 'rgba(8, 18, 16, 0.55)',
    },
    spot: {
      position: 'absolute',
      borderRadius: 14,
      borderWidth: 2.5,
      borderColor: colors.accent,
      backgroundColor: 'transparent',
    },
    spotHit: {
      flex: 1,
    },
    tooltip: {
      position: 'absolute',
      backgroundColor: colors.surface,
      borderRadius: 14,
      paddingHorizontal: 14,
      paddingVertical: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    tooltipTitle: {
      fontSize: 15,
      fontWeight: '800',
      color: colors.text,
    },
    tooltipBody: {
      marginTop: 4,
      fontSize: 13,
      lineHeight: 18,
      color: colors.textSecondary,
      fontWeight: '500',
    },
    tooltipRow: {
      marginTop: 12,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    skip: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textMuted,
    },
    skipLight: {
      fontSize: 13,
      fontWeight: '600',
      color: '#FFFFFF',
      opacity: 0.85,
    },
    nextBtn: {
      backgroundColor: colors.brand,
      borderRadius: 10,
      paddingHorizontal: 14,
      paddingVertical: 8,
    },
    nextText: {
      color: colors.textOnAccent,
      fontWeight: '700',
      fontSize: 13,
    },
    hintWrap: {
      position: 'absolute',
      left: 0,
      right: 0,
      alignItems: 'center',
      gap: 8,
    },
    tapHint: {
      color: '#FFFFFF',
      fontSize: 13,
      fontWeight: '700',
    },
  });
}
