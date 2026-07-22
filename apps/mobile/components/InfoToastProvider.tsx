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

type InfoToastContextValue = {
  showInfo: (message: string) => void;
};

const InfoToastContext = createContext<InfoToastContextValue | null>(null);

/** App-wide soft info toast (not errors / confirms). */
export function InfoToastProvider({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<{ message: string; key: number } | null>(null);

  const showInfo = useCallback((message: string) => {
    const text = message.trim();
    if (!text) {
      return;
    }
    setToast({ message: text, key: Date.now() });
  }, []);

  const value = useMemo(() => ({ showInfo }), [showInfo]);

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
          durationMs={2800}
          onHidden={() => setToast(null)}
        />
      </View>
    </InfoToastContext.Provider>
  );
}

export function useInfoToast(): InfoToastContextValue {
  const ctx = useContext(InfoToastContext);
  if (!ctx) {
    return {
      showInfo: (message: string) => {
        if (__DEV__) {
          console.warn('[InfoToast] Provider yoxdur:', message);
        }
      },
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
