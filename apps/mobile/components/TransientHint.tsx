import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text } from 'react-native';

type Props = {
  message: string;
  /** true olanda toast kimi gəlib gedir */
  active: boolean;
  durationMs?: number;
  onHidden?: () => void;
};

/** Məlumat toast-u — fade ilə gəlir/gedir, düymə kimi görünmür. */
export function TransientHint({
  message,
  active,
  durationMs = 2400,
  onHidden,
}: Props) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(10)).current;
  const [mounted, setMounted] = useState(false);
  const onHiddenRef = useRef(onHidden);
  onHiddenRef.current = onHidden;

  useEffect(() => {
    let hideTimer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    if (!active || !message) {
      setMounted(false);
      opacity.setValue(0);
      return;
    }

    setMounted(true);
    opacity.setValue(0);
    translateY.setValue(12);

    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 220,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: 220,
        useNativeDriver: true,
      }),
    ]).start();

    hideTimer = setTimeout(() => {
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 0,
          duration: 280,
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: -8,
          duration: 280,
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (!cancelled && finished) {
          setMounted(false);
          onHiddenRef.current?.();
        }
      });
    }, durationMs);

    return () => {
      cancelled = true;
      if (hideTimer) {
        clearTimeout(hideTimer);
      }
    };
  }, [active, durationMs, message, opacity, translateY]);

  if (!mounted || !message) {
    return null;
  }

  return (
    <Animated.View
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      style={[
        styles.toast,
        {
          opacity,
          transform: [{ translateY }],
        },
      ]}
    >
      <Text style={styles.text}>{message}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  toast: {
    alignSelf: 'center',
    maxWidth: '88%',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 999,
    backgroundColor: 'rgba(36, 38, 44, 0.88)',
  },
  text: {
    fontSize: 13,
    fontWeight: '500',
    color: '#FFFFFF',
    textAlign: 'center',
  },
});
