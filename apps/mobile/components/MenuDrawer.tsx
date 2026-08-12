import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Animated,
  FlatList,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { ThemeColors } from '../constants/theme';
import {
  deleteSavedRoute,
  listSavedRoutes,
  type SavedRoute,
} from '../lib/savedRoutes';
import {
  listMyNotifications,
  listMySubscriptions,
  markNotificationRead,
  type AppNotification,
  type MySubscriptionRow,
} from '../lib/subscriptions';
import { supabase } from '../lib/supabase';
import { useThemeColors } from '../theme/ThemeProvider';
import { useInfoToast } from './InfoToastProvider';

type MenuSection = 'routes' | 'subscriptions' | 'notifications';

type Profile = {
  full_name: string | null;
  avatar_url: string | null;
  email: string | null;
};

function NotificationIcon({ kind }: { kind: string }) {
  if (kind === 'join_request') return <Text style={{ fontSize: 16 }}>🤝</Text>;
  if (kind === 'tour_update') return <Text style={{ fontSize: 16 }}>🔔</Text>;
  if (kind === 'tour_cancelled') return <Text style={{ fontSize: 16 }}>❌</Text>;
  if (kind === 'organizer_new_tour') return <Text style={{ fontSize: 16 }}>🆕</Text>;
  if (kind === 'weather_tip') return <Text style={{ fontSize: 16 }}>☀️</Text>;
  return <Text style={{ fontSize: 16 }}>💬</Text>;
}

function formatRelativeTime(isoDate: string): string {
  const diff = (Date.now() - new Date(isoDate).getTime()) / 1000;
  if (diff < 60) return 'İndicə';
  if (diff < 3600) return `${Math.floor(diff / 60)} dəq.`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} saat`;
  if (diff < 604800) return `${Math.floor(diff / 86400)} gün`;
  return new Date(isoDate).toLocaleDateString('az-AZ', { day: 'numeric', month: 'short' });
}

type DrawerProps = {
  visible: boolean;
  onClose: () => void;
};

export function MenuDrawer({ visible, onClose }: DrawerProps) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { showError } = useInfoToast();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [section, setSection] = useState<MenuSection | null>(null);
  const [routes, setRoutes] = useState<SavedRoute[]>([]);
  const [subscriptions, setSubscriptions] = useState<MySubscriptionRow[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(false);

  const slideAnim = useRef(new Animated.Value(300)).current;

  const unreadCount = notifications.filter((n) => !n.read_at).length;

  const load = useCallback(async () => {
    setLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      return;
    }
    const { data: prof } = await supabase
      .from('profiles')
      .select('full_name, avatar_url, email')
      .eq('id', user.id)
      .maybeSingle();
    if (prof) setProfile(prof);

    const [routesRes, subsRes, notifsRes] = await Promise.all([
      listSavedRoutes(),
      listMySubscriptions(),
      listMyNotifications(40),
    ]);
    setRoutes(routesRes.data);
    setSubscriptions(subsRes.data);
    setNotifications(notifsRes.data);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (visible) {
        void load();
      }
    }, [visible, load])
  );

  const handleOpen = useCallback(() => {
    void load();
    Animated.spring(slideAnim, {
      toValue: 0,
      useNativeDriver: true,
      damping: 20,
      stiffness: 200,
    }).start();
  }, [load, slideAnim]);

  const handleClose = useCallback(() => {
    Animated.timing(slideAnim, {
      toValue: 300,
      duration: 200,
      useNativeDriver: true,
    }).start(() => {
      setSection(null);
      onClose();
    });
  }, [slideAnim, onClose]);

  const handleMarkRead = useCallback(
    async (id: string) => {
      await markNotificationRead(id);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n))
      );
    },
    []
  );

  const handleDeleteRoute = useCallback(
    async (id: string) => {
      const { error } = await deleteSavedRoute(id);
      if (error) {
        showError(error);
      } else {
        setRoutes((prev) => prev.filter((r) => r.id !== id));
      }
    },
    [showError]
  );

  if (!visible) {
    return null;
  }

  return (
    <Modal
      transparent
      visible={visible}
      animationType="fade"
      onShow={handleOpen}
      onRequestClose={handleClose}
    >
      <TouchableWithoutFeedback onPress={handleClose}>
        <View style={styles.overlay} />
      </TouchableWithoutFeedback>

      <Animated.View
        style={[
          styles.drawer,
          { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 16 },
          { transform: [{ translateX: slideAnim }] },
        ]}
      >
        {/* Profile header */}
        <Pressable
          style={styles.profileRow}
          onPress={() => {
            handleClose();
            setTimeout(() => router.push('/(tabs)/profil'), 220);
          }}
        >
          {profile?.avatar_url ? (
            <Image source={{ uri: profile.avatar_url }} style={styles.avatar} />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <Ionicons name="person" size={20} color={colors.textMuted} />
            </View>
          )}
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={styles.profileName} numberOfLines={1}>
              {profile?.full_name || 'Profil'}
            </Text>
            {profile?.email ? (
              <Text style={styles.profileEmail} numberOfLines={1}>
                {profile.email}
              </Text>
            ) : null}
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        </Pressable>

        <View style={styles.divider} />

        {/* Section buttons */}
        {[
          {
            id: 'notifications' as MenuSection,
            label: 'Bildirişlər',
            icon: 'notifications-outline' as const,
            badge: unreadCount,
          },
          {
            id: 'routes' as MenuSection,
            label: 'Marşrutlarım',
            icon: 'map-outline' as const,
            badge: 0,
          },
          {
            id: 'subscriptions' as MenuSection,
            label: 'Abunəliyim',
            icon: 'bookmark-outline' as const,
            badge: 0,
          },
        ].map((item) => (
          <Pressable
            key={item.id}
            style={[styles.sectionBtn, section === item.id && styles.sectionBtnActive]}
            onPress={() => setSection(section === item.id ? null : item.id)}
          >
            <Ionicons
              name={item.icon}
              size={20}
              color={section === item.id ? colors.brand : colors.text}
              style={{ marginRight: 10 }}
            />
            <Text style={[styles.sectionLabel, section === item.id && styles.sectionLabelActive]}>
              {item.label}
            </Text>
            {item.badge > 0 ? (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{item.badge > 99 ? '99+' : item.badge}</Text>
              </View>
            ) : null}
            <Ionicons
              name={section === item.id ? 'chevron-up' : 'chevron-down'}
              size={14}
              color={colors.textMuted}
              style={{ marginLeft: 'auto' }}
            />
          </Pressable>
        ))}

        {/* Expanded section content */}
        {section === 'notifications' && (
          <ScrollView style={styles.sectionContent} showsVerticalScrollIndicator={false}>
            {loading ? (
              <Text style={styles.emptyText}>Yüklənir…</Text>
            ) : notifications.length === 0 ? (
              <Text style={styles.emptyText}>Heç bir bildiriş yoxdur.</Text>
            ) : (
              notifications.map((n) => (
                <Pressable
                  key={n.id}
                  style={[styles.notifRow, !n.read_at && styles.notifRowUnread]}
                  onPress={() => void handleMarkRead(n.id)}
                >
                  <View style={styles.notifIcon}>
                    <NotificationIcon kind={n.kind} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.notifTitle}>{n.title}</Text>
                    {n.body ? <Text style={styles.notifBody} numberOfLines={2}>{n.body}</Text> : null}
                    <Text style={styles.notifTime}>{formatRelativeTime(n.created_at)}</Text>
                  </View>
                  {!n.read_at ? <View style={styles.unreadDot} /> : null}
                </Pressable>
              ))
            )}
          </ScrollView>
        )}

        {section === 'routes' && (
          <ScrollView style={styles.sectionContent} showsVerticalScrollIndicator={false}>
            {loading ? (
              <Text style={styles.emptyText}>Yüklənir…</Text>
            ) : routes.length === 0 ? (
              <Text style={styles.emptyText}>Saxlanmış marşrut yoxdur.</Text>
            ) : (
              routes.map((r) => (
                <View key={r.id} style={styles.routeRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.routeName} numberOfLines={1}>
                      {r.name || 'Marşrut'}
                    </Text>
                    {r.region ? (
                      <Text style={styles.routeSub} numberOfLines={1}>{r.region}</Text>
                    ) : null}
                  </View>
                  <Pressable
                    onPress={() => void handleDeleteRoute(r.id)}
                    hitSlop={8}
                  >
                    <Ionicons name="trash-outline" size={16} color={colors.dangerText} />
                  </Pressable>
                </View>
              ))
            )}
          </ScrollView>
        )}

        {section === 'subscriptions' && (
          <ScrollView style={styles.sectionContent} showsVerticalScrollIndicator={false}>
            {loading ? (
              <Text style={styles.emptyText}>Yüklənir…</Text>
            ) : subscriptions.length === 0 ? (
              <Text style={styles.emptyText}>Heç bir abunəlik yoxdur.</Text>
            ) : (
              subscriptions.map((s) => (
                <View key={s.id} style={styles.subRow}>
                  {s.avatar_url ? (
                    <Image source={{ uri: s.avatar_url }} style={styles.subAvatar} />
                  ) : (
                    <View style={styles.subAvatarPlaceholder}>
                      <Ionicons
                        name={s.target_type === 'listing' ? 'calendar-outline' : 'person-outline'}
                        size={14}
                        color={colors.textMuted}
                      />
                    </View>
                  )}
                  <View style={{ flex: 1, marginLeft: 8 }}>
                    <Text style={styles.subName} numberOfLines={1}>{s.title}</Text>
                    {s.subtitle ? (
                      <Text style={styles.subType} numberOfLines={1}>{s.subtitle}</Text>
                    ) : null}
                  </View>
                </View>
              ))
            )}
          </ScrollView>
        )}
      </Animated.View>
    </Modal>
  );
}

/** Badge count — 0 if no unread. Exported for parent tab badge. */
export async function getUnreadNotificationCount(): Promise<number> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return 0;
  const { count } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .is('read_at', null);
  return count ?? 0;
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    overlay: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: colors.overlay,
    },
    drawer: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      width: 300,
      backgroundColor: colors.surface,
      shadowColor: '#000',
      shadowOffset: { width: -4, height: 0 },
      shadowOpacity: 0.15,
      shadowRadius: 12,
      elevation: 12,
      paddingHorizontal: 16,
    },
    profileRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 8,
      marginBottom: 4,
    },
    avatar: {
      width: 44,
      height: 44,
      borderRadius: 22,
    },
    avatarPlaceholder: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: colors.surfaceMuted,
      alignItems: 'center',
      justifyContent: 'center',
    },
    profileName: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.text,
    },
    profileEmail: {
      fontSize: 12,
      color: colors.textMuted,
      marginTop: 2,
    },
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.border,
      marginVertical: 8,
    },
    sectionBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 12,
      paddingHorizontal: 4,
      borderRadius: 8,
    },
    sectionBtnActive: {
      backgroundColor: colors.accentSoft,
    },
    sectionLabel: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.text,
    },
    sectionLabelActive: {
      color: colors.brand,
    },
    badge: {
      marginLeft: 8,
      minWidth: 18,
      height: 18,
      borderRadius: 9,
      backgroundColor: colors.danger,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 4,
    },
    badgeText: {
      fontSize: 10,
      fontWeight: '700',
      color: '#fff',
    },
    sectionContent: {
      maxHeight: 280,
      marginTop: 4,
      marginBottom: 8,
    },
    emptyText: {
      fontSize: 13,
      color: colors.textMuted,
      textAlign: 'center',
      paddingVertical: 16,
    },
    notifRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      paddingVertical: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.borderSoft,
      gap: 8,
    },
    notifRowUnread: {
      backgroundColor: colors.accentSoft,
      borderRadius: 8,
      paddingHorizontal: 6,
    },
    notifIcon: {
      width: 28,
      alignItems: 'center',
      paddingTop: 2,
    },
    notifTitle: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.text,
    },
    notifBody: {
      fontSize: 12,
      color: colors.textSecondary,
      marginTop: 2,
    },
    notifTime: {
      fontSize: 11,
      color: colors.textMuted,
      marginTop: 3,
    },
    unreadDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: colors.brand,
      marginTop: 4,
    },
    routeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.borderSoft,
      gap: 8,
    },
    routeName: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.text,
    },
    routeSub: {
      fontSize: 11,
      color: colors.textMuted,
      marginTop: 2,
    },
    subRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.borderSoft,
    },
    subAvatar: {
      width: 32,
      height: 32,
      borderRadius: 16,
    },
    subAvatarPlaceholder: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: colors.surfaceMuted,
      alignItems: 'center',
      justifyContent: 'center',
    },
    subName: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.text,
    },
    subType: {
      fontSize: 11,
      color: colors.textMuted,
      marginTop: 2,
    },
  });
}
