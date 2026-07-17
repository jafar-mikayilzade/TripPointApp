import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { supabase } from '../lib/supabase';

export default function Index() {
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
        <ActivityIndicator size="large" color="#2563EB" />
        <Text style={styles.text}>Yüklənir...</Text>
      </View>
    );
  }

  if (hasSession) {
    return <Redirect href="/(tabs)" />;
  }

  return <Redirect href="/auth/login" />;
}

const styles = StyleSheet.create({
  loader: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  text: {
    marginTop: 12,
    color: '#6B7280',
    fontWeight: '600',
  },
});
