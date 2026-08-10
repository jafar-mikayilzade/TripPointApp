import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';

import type { ThemeColors } from '../constants/theme';
import { supabase } from '../lib/supabase';
import { useThemeColors } from '../theme/ThemeProvider';

type Props = {
  /** Absolute yerləşdirmə üçün əlavə stil */
  style?: object;
};

/** Sağ üst künc — öz profilə keçid. */
export function ProfileCornerButton({ style }: Props) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const router = useRouter();
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user || !active) {
          if (active) setAvatarUrl(null);
          return;
        }
        const { data } = await supabase
          .from('profiles')
          .select('avatar_url')
          .eq('id', user.id)
          .maybeSingle();
        if (active) {
          setAvatarUrl(data?.avatar_url?.trim() || null);
        }
      })();
      return () => {
        active = false;
      };
    }, [])
  );

  return (
    <Pressable
      onPress={() => router.push('/(tabs)/profil')}
      style={[styles.btn, style]}
      hitSlop={8}
      accessibilityLabel="Profil"
    >
      {avatarUrl ? (
        <Image source={{ uri: avatarUrl }} style={styles.avatar} />
      ) : (
        <Ionicons name="person" size={16} color={colors.text} />
      )}
    </Pressable>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    btn: {
      width: 34,
      height: 34,
      borderRadius: 10,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    avatar: {
      width: 34,
      height: 34,
      borderRadius: 10,
    },
  });
}
