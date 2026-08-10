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

import type { ThemeColors } from '../constants/theme';
import { useThemeColors } from '../theme/ThemeProvider';

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
  /**
   * Controlled ratio. When set, parent drives the split (still draggable —
   * drag updates locally and commits to parent on release to avoid map jank).
   */
  topRatio?: number;
  onTopRatioChange?: (ratio: number) => void;
  /** Persist ratio across launches (ignored while topRatio is controlled) */
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
  topRatio: controlledRatio,
  onTopRatioChange,
  storageKey,
  style,
}: ResizableSplitProps) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const isControlled = controlledRatio != null;
  const [containerHeight, setContainerHeight] = useState(0);
  const [internalRatio, setInternalRatio] = useState(initialTopRatio);
  /** Live drag overlay — avoids per-frame parent setState (MapView thrash). */
  const [dragRatio, setDragRatio] = useState<number | null>(null);

  const committedRatio = isControlled
    ? clamp(controlledRatio, minTopRatio, maxTopRatio)
    : internalRatio;
  const topRatio = dragRatio != null ? dragRatio : committedRatio;

  const topRatioRef = useRef(topRatio);
  const startRatioRef = useRef(topRatio);
  const containerHeightRef = useRef(0);
  const minRef = useRef(minTopRatio);
  const maxRef = useRef(maxTopRatio);
  const onChangeRef = useRef(onTopRatioChange);
  const isControlledRef = useRef(isControlled);
  const storageKeyRef = useRef(storageKey);

  useEffect(() => {
    topRatioRef.current = topRatio;
  }, [topRatio]);

  useEffect(() => {
    minRef.current = minTopRatio;
    maxRef.current = maxTopRatio;
  }, [minTopRatio, maxTopRatio]);

  useEffect(() => {
    onChangeRef.current = onTopRatioChange;
  }, [onTopRatioChange]);

  useEffect(() => {
    isControlledRef.current = isControlled;
  }, [isControlled]);

  useEffect(() => {
    storageKeyRef.current = storageKey;
  }, [storageKey]);

  useEffect(() => {
    if (!storageKey || isControlled) {
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
      setInternalRatio(next);
    });
    return () => {
      cancelled = true;
    };
  }, [storageKey, isControlled]);

  function commitRatio(next: number) {
    const clamped = clamp(next, minRef.current, maxRef.current);
    topRatioRef.current = clamped;
    if (isControlledRef.current) {
      onChangeRef.current?.(clamped);
    } else {
      setInternalRatio(clamped);
      const key = storageKeyRef.current;
      if (key) {
        void AsyncStorage.setItem(key, String(clamped));
      }
    }
  }

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
          setDragRatio(next);
        },
        onPanResponderRelease: () => {
          const final = topRatioRef.current;
          setDragRatio(null);
          commitRatio(final);
        },
        onPanResponderTerminate: () => {
          const final = topRatioRef.current;
          setDragRatio(null);
          commitRatio(final);
        },
      }),
    []
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
  // Collapsed map (ratio≈0) — hide blue pill so it doesn't sit on the form title
  const showHandle =
    topRatio > 0.04 &&
    topRatio < 0.96 &&
    (topHeight == null || topHeight >= HANDLE_HIT);

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

      {showHandle ? (
        <View
          style={[styles.handle, handleTop != null ? { top: handleTop } : styles.handleFallback]}
          {...panResponder.panHandlers}
          accessibilityRole="adjustable"
          accessibilityLabel="Xəritə və siyahı arasındakı bölücü"
          accessibilityHint="Yuxarı və ya aşağı sürüşdürərək ölçünü dəyişin"
        >
          <View style={styles.handlePill} />
        </View>
      ) : null}
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
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
}
