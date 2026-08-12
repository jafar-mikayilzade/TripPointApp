import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TransientHint } from './TransientHint';

export type ToastTone = 'info' | 'success' | 'error';

type ToastState = {
  message: string;
  tone: ToastTone;
  key: number;
};

type InfoToastContextValue = {
  showInfo: (message: string) => void;
  showSuccess: (message: string) => void;
  showError: (message: string) => void;
};

const InfoToastContext = createContext<InfoToastContextValue | null>(null);

/** App-wide soft toast (info / success / soft errors). */
export function InfoToastProvider({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<ToastState | null>(null);

  const push = useCallback((message: string, tone: ToastTone) => {
    const text = message.trim();
    if (!text) {
      return;
    }
    setToast({ message: text, tone, key: Date.now() });
  }, []);

  const showInfo = useCallback((message: string) => push(message, 'info'), [push]);
  const showSuccess = useCallback((message: string) => push(message, 'success'), [push]);
  const showError = useCallback((message: string) => push(message, 'error'), [push]);

  const value = useMemo(
    () => ({ showInfo, showSuccess, showError }),
    [showInfo, showSuccess, showError]
  );

  return (
    <InfoToastContext.Provider value={value}>
      {children}
      <View
        pointerEvents="none"
        style={[styles.host, { bottom: Math.max(insets.bottom, 10) + 56 }]}
      >
        <TransientHint
          key={toast?.key ?? 0}
          message={toast?.message ?? ''}
          active={!!toast}
          tone={toast?.tone ?? 'info'}
          durationMs={toast?.tone === 'error' ? 3400 : 2800}
          onHidden={() => setToast(null)}
        />
      </View>
    </InfoToastContext.Provider>
  );
}

export function useInfoToast(): InfoToastContextValue {
  const ctx = useContext(InfoToastContext);
  if (!ctx) {
    const noop = (message: string) => {
      if (__DEV__) {
        console.warn('[InfoToast] Provider yoxdur:', message);
      }
    };
    return {
      showInfo: noop,
      showSuccess: noop,
      showError: noop,
    };
  }
  return ctx;
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 9999,
    elevation: 9999,
  },
});
