import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  ListingDetailModal,
  type ListingWithCreator,
} from '../../components/ListingDetailModal';
import { colors } from '../../constants/theme';
import { getErrorMessage } from '../../lib/errors';
import { supabase } from '../../lib/supabase';
import type { Listing, Profile } from '../../types/database';

/**
 * Deep link: trippoint://listing/<uuid>
 * Also works as /listing/<uuid> in-app.
 */
export default function ListingDeepLinkScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [listing, setListing] = useState<ListingWithCreator | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    let active = true;

    async function load() {
      if (!id) {
        setError('Elan tapılmadı');
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      const { data, error: fetchError } = await supabase
        .from('listings')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (!active) {
        return;
      }

      if (fetchError || !data) {
        setError(fetchError ? getErrorMessage(fetchError) : 'Elan tapılmadı');
        setListing(null);
        setLoading(false);
        return;
      }

      const row = data as Listing;
      let creator: Profile | null = null;
      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', row.created_by)
        .maybeSingle();
      creator = (profile as Profile | null) ?? null;

      if (!active) {
        return;
      }

      setListing({ ...row, creator });
      setLoading(false);
    }

    void load();
    return () => {
      active = false;
    };
  }, [id]);

  function close() {
    setVisible(false);
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)/icma');
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </SafeAreaView>
    );
  }

  if (error || !listing) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.error}>{error ?? 'Elan tapılmadı'}</Text>
        <Pressable style={styles.btn} onPress={close}>
          <Text style={styles.btnText}>İcmaya qayıt</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.fill}>
      <ListingDetailModal
        listing={listing}
        visible={visible}
        onClose={close}
        onDeleted={close}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.bg },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: colors.bg,
    gap: 12,
  },
  error: { color: colors.dangerText, textAlign: 'center', fontSize: 15 },
  btn: {
    backgroundColor: colors.accent,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
  },
  btnText: { color: colors.textOnAccent, fontWeight: '700' },
});
