import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TripPointWordmark } from './TripPointWordmark';

const FOREST = '#0D2C24';
const GOLD = '#D4AF37';

type Props = {
  /** When true, animates a demo progress bar (cold start). */
  animateProgress?: boolean;
  subtitle?: string;
};

/** Premium forest + gold splash used on cold-start loading. */
export function BrandSplash({
  animateProgress = true,
  subtitle = 'Azərbaycanı kəşf et',
}: Props) {
  const insets = useSafeAreaInsets();
  const progress = useRef(new Animated.Value(0.12)).current;
  const [pct, setPct] = useState(12);

  useEffect(() => {
    if (!animateProgress) {
      return;
    }
    const id = progress.addListener(({ value }) => {
      setPct(Math.round(value * 100));
    });
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(progress, {
          toValue: 0.72,
          duration: 2200,
          useNativeDriver: false,
        }),
        Animated.timing(progress, {
          toValue: 0.28,
          duration: 1400,
          useNativeDriver: false,
        }),
      ])
    );
    loop.start();
    return () => {
      loop.stop();
      progress.removeListener(id);
    };
  }, [animateProgress, progress]);

  const widthInterp = progress.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  return (
    <View
      style={[
        styles.root,
        {
          paddingTop: Math.max(insets.top, 24),
          paddingBottom: Math.max(insets.bottom, 24),
        },
      ]}
    >
      {/* Decorative arcs — behind content, never intercept layout */}
      <View style={styles.topoWrap} pointerEvents="none">
        {[0, 1, 2].map((i) => (
          <View
            key={i}
            style={[
              styles.topoArc,
              {
                width: 220 + i * 56,
                height: 220 + i * 56,
                opacity: 0.07 + i * 0.03,
              },
            ]}
          />
        ))}
      </View>

      <View style={styles.centerBlock}>
        <View style={styles.logoMark}>
          <Ionicons name="compass" size={48} color={GOLD} />
        </View>

        <TripPointWordmark size={32} onDarkSplash style={styles.wordmark} />

        <Text style={styles.tagline} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>

      {animateProgress ? (
        <View style={styles.progressWrap}>
          <View style={styles.progressTrack}>
            <Animated.View style={[styles.progressFill, { width: widthInterp }]}>
              <Text style={styles.progressPct}>{pct}%</Text>
            </Animated.View>
          </View>
        </View>
      ) : (
        <View style={styles.progressSpacer} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: FOREST,
    paddingHorizontal: 28,
  },
  topoWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 0,
  },
  topoArc: {
    position: 'absolute',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: GOLD,
  },
  centerBlock: {
    flex: 1,
    zIndex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    paddingBottom: 24,
  },
  logoMark: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 2,
    borderColor: GOLD,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(21, 46, 40, 0.92)',
  },
  wordmark: {
    marginTop: 4,
  },
  tagline: {
    fontSize: 15,
    fontWeight: '600',
    color: GOLD,
    letterSpacing: 0.2,
    textAlign: 'center',
  },
  progressWrap: {
    zIndex: 1,
    width: '100%',
    paddingBottom: 12,
  },
  progressSpacer: {
    height: 40,
  },
  progressTrack: {
    height: 28,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.12)',
    overflow: 'hidden',
    justifyContent: 'center',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: GOLD,
    justifyContent: 'center',
    paddingHorizontal: 12,
    minWidth: 52,
  },
  progressPct: {
    color: '#0D2C24',
    fontSize: 12,
    fontWeight: '800',
  },
});
