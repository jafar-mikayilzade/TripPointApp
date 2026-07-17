import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text } from 'react-native';

type ToastState = {
  message: string;
  visible: boolean;
};

export function useToast() {
  const [toast, setToast] = useState<ToastState>({ message: '', visible: false });
  const opacity = useRef(new Animated.Value(0)).current;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hide = useCallback(() => {
    Animated.timing(opacity, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(() => {
      setToast((prev) => ({ ...prev, visible: false }));
    });
  }, [opacity]);

  const showToast = useCallback(
    (message: string, durationMs = 2600) => {
      if (hideTimer.current) {
        clearTimeout(hideTimer.current);
      }

      setToast({ message, visible: true });
      opacity.setValue(0);
      Animated.timing(opacity, {
        toValue: 1,
        duration: 180,
        useNativeDriver: true,
      }).start();

      hideTimer.current = setTimeout(() => {
        hide();
      }, durationMs);
    },
    [hide, opacity]
  );

  useEffect(() => {
    return () => {
      if (hideTimer.current) {
        clearTimeout(hideTimer.current);
      }
    };
  }, []);

  const ToastHost = toast.visible ? (
    <Animated.View style={[styles.toast, { opacity }]} pointerEvents="none">
      <Text style={styles.toastText}>{toast.message}</Text>
    </Animated.View>
  ) : null;

  return { showToast, ToastHost };
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 28,
    backgroundColor: '#111827',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    zIndex: 100,
    elevation: 8,
  },
  toastText: {
    color: '#F9FAFB',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
});
