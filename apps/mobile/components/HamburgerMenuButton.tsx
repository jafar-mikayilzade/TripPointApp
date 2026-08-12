import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';

import type { ThemeColors } from '../constants/theme';
import { supabase } from '../lib/supabase';
import { useThemeColors } from '../theme/ThemeProvider';
import { MenuDrawer, getUnreadNotificationCount } from './MenuDrawer';

type Props = {
  style?: object;
};

/** Top-right corner button — opens slide-in menu with profile, notifications, routes, subs. */
export function HamburgerMenuButton({ style }: Props) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user || !active) {
          if (active) {
            setAvatarUrl(null);
            setUnread(0);
          }
          return;
        }
        const [{ data }, count] = await Promise.all([
          supabase.from('profiles').select('avatar_url').eq('id', user.id).maybeSingle(),
          getUnreadNotificationCount(),
        ]);
        if (active) {
          setAvatarUrl(data?.avatar_url?.trim() || null);
          setUnread(count);
        }
      })();
      return () => {
        active = false;
      };
    }, [])
  );

  return (
    <>
      <Pressable
        onPress={() => setDrawerOpen(true)}
        style={[styles.btn, style]}
        hitSlop={8}
        accessibilityLabel="Menyu"
      >
        {avatarUrl ? (
          <Image source={{ uri: avatarUrl }} style={styles.avatar} />
        ) : (
          <Ionicons name="menu" size={20} color={colors.text} />
        )}
        {unread > 0 ? (
          <View style={styles.badge}>
            <View style={styles.badgeDot} />
          </View>
        ) : null}
      </Pressable>

      <MenuDrawer visible={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </>
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
      overflow: 'visible',
    },
    avatar: {
      width: 34,
      height: 34,
      borderRadius: 10,
    },
    badge: {
      position: 'absolute',
      top: -3,
      right: -3,
      width: 12,
      height: 12,
      borderRadius: 6,
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    badgeDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: colors.danger,
    },
  });
}
