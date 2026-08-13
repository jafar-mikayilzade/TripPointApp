import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { ThemeColors } from '../constants/theme';
import { supabase } from '../lib/supabase';
import { useThemeColors } from '../theme/ThemeProvider';
import { onNotificationInboxChange } from '../lib/notificationInbox';
import { MenuDrawer, getUnreadNotificationCount } from './MenuDrawer';

type Props = {
  style?: object;
};

/** Top-right corner — hamburger icon opens slide-in menu (badge if unread). */
export function HamburgerMenuButton({ style }: Props) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
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
          if (active) setUnread(0);
          return;
        }
        const count = await getUnreadNotificationCount();
        if (active) setUnread(count);
      })();
      return () => {
        active = false;
      };
    }, [])
  );

  useEffect(() => {
    return onNotificationInboxChange(() => {
      void getUnreadNotificationCount().then(setUnread);
    });
  }, []);

  return (
    <>
      <Pressable
        onPress={() => setDrawerOpen(true)}
        style={[styles.btn, style]}
        hitSlop={8}
        accessibilityLabel="Menyu"
      >
        <Ionicons name="menu" size={22} color={colors.text} />
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
      flexShrink: 0,
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
