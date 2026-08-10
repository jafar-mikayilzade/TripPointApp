import { Redirect } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { supabase } from '../lib/supabase';
import type { ThemeColors } from '../constants/theme';
import { useThemeColors } from '../theme/ThemeProvider';

export default function Index() {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [ready, setReady] = useState(false);
  const [hasSession, setHasSession] = useState(false);

  useEffect(() => {
    let isActive = true;

    async function load() {
      try {
        const { data } = await supabase.auth.getSession();
        if (isActive) {
          setHasSession(!!data.session);
        }
      } catch {
        if (isActive) {
          setHasSession(false);
        }
      } finally {
        if (isActive) {
          setReady(true);
        }
      }
    }

    load();

    return () => {
      isActive = false;
    };
  }, []);

  if (!ready) {
    return (
      <View style={styles.loader}>
        <ActivityIndicator size="large" color={colors.accent} />
        <Text style={styles.text}>Yüklənir...</Text>
      </View>
    );
  }

  if (hasSession) {
    return <Redirect href="/(tabs)" />;
  }

  return <Redirect href="/auth/login" />;
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    loader: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surface,
    },
    text: {
      marginTop: 12,
      color: colors.textSecondary,
      fontWeight: '600',
    },
  });
}
