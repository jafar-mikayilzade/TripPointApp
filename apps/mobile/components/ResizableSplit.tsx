import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  PanResponder,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { colors } from '../constants/theme';

/** Hit area for drag; visually only a thin blue line is shown */
const HANDLE_HIT = 24;
const PILL_HEIGHT = 4;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

type ResizableSplitProps = {
  /** Top pane (usually map) */
  top: ReactNode;
  /** Bottom pane (list / form) */
  bottom: ReactNode;
  /** Fraction of height for the top pane (0–1) */
  initialTopRatio?: number;
  minTopRatio?: number;
  maxTopRatio?: number;
  /** Persist ratio across launches */
  storageKey?: string;
  style?: StyleProp<ViewStyle>;
};

/**
 * Vertical split with a floating draggable handle (no reserved grey strip).
 * Drag down → enlarge top (map). Drag up → enlarge bottom (content).
 */
export function ResizableSplit({
  top,
  bottom,
  initialTopRatio = 0.5,
  minTopRatio = 0.22,
  maxTopRatio = 0.78,
  storageKey,
  style,
}: ResizableSplitProps) {
  const [containerHeight, setContainerHeight] = useState(0);
  const [topRatio, setTopRatio] = useState(initialTopRatio);

  const topRatioRef = useRef(topRatio);
  const startRatioRef = useRef(topRatio);
  const containerHeightRef = useRef(0);
  const minRef = useRef(minTopRatio);
  const maxRef = useRef(maxTopRatio);

  useEffect(() => {
    topRatioRef.current = topRatio;
  }, [topRatio]);

  useEffect(() => {
    minRef.current = minTopRatio;
    maxRef.current = maxTopRatio;
  }, [minTopRatio, maxTopRatio]);

  useEffect(() => {
    if (!storageKey) {
      return;
    }
    let cancelled = false;
    void AsyncStorage.getItem(storageKey).then((raw) => {
      if (cancelled || raw == null) {
        return;
      }
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) {
        return;
      }
      const next = clamp(parsed, minRef.current, maxRef.current);
      topRatioRef.current = next;
      setTopRatio(next);
    });
    return () => {
      cancelled = true;
    };
  }, [storageKey]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dy) > 2,
        onPanResponderTerminationRequest: () => false,
        onShouldBlockNativeResponder: () => true,
        onPanResponderGrant: () => {
          startRatioRef.current = topRatioRef.current;
        },
        onPanResponderMove: (_, gesture) => {
          const height = containerHeightRef.current;
          if (height <= 0) {
            return;
          }
          const next = clamp(
            startRatioRef.current + gesture.dy / height,
            minRef.current,
            maxRef.current
          );
          topRatioRef.current = next;
          setTopRatio(next);
        },
        onPanResponderRelease: () => {
          if (!storageKey) {
            return;
          }
          void AsyncStorage.setItem(storageKey, String(topRatioRef.current));
        },
        onPanResponderTerminate: () => {
          if (!storageKey) {
            return;
          }
          void AsyncStorage.setItem(storageKey, String(topRatioRef.current));
        },
      }),
    [storageKey]
  );

  function handleLayout(event: LayoutChangeEvent) {
    const height = event.nativeEvent.layout.height;
    containerHeightRef.current = height;
    setContainerHeight(height);
  }

  const topHeight = containerHeight > 0 ? containerHeight * topRatio : undefined;
  const bottomHeight = containerHeight > 0 ? containerHeight * (1 - topRatio) : undefined;
  const handleTop =
    topHeight != null ? Math.max(0, topHeight - HANDLE_HIT / 2) : undefined;

  return (
    <View style={[styles.root, style]} onLayout={handleLayout}>
      <View style={[styles.pane, topHeight != null ? { height: topHeight } : styles.paneFlex]}>
        {top}
      </View>

      <View
        style={[
          styles.pane,
          bottomHeight != null ? { height: bottomHeight } : styles.paneFlex,
        ]}
      >
        {bottom}
      </View>

      {/* Floating handle — transparent hit area, blue line only */}
      <View
        style={[styles.handle, handleTop != null ? { top: handleTop } : styles.handleFallback]}
        {...panResponder.panHandlers}
        accessibilityRole="adjustable"
        accessibilityLabel="Xəritə və siyahı arasındakı bölücü"
        accessibilityHint="Yuxarı və ya aşağı sürüşdürərək ölçünü dəyişin"
      >
        <View style={styles.handlePill} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
  },
  pane: {
    minHeight: 0,
    overflow: 'hidden',
  },
  paneFlex: {
    flex: 1,
  },
  handle: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: HANDLE_HIT,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    zIndex: 30,
  },
  handleFallback: {
    top: '50%',
    marginTop: -HANDLE_HIT / 2,
  },
  handlePill: {
    width: 40,
    height: PILL_HEIGHT,
    borderRadius: 999,
    backgroundColor: colors.accent,
  },
});
