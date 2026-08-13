import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { REGIONS } from '../constants/regions';
import type { ThemeColors } from '../constants/theme';
import { LISTING_PUBLIC_COLUMNS } from '../lib/listingColumns';
import {
  deleteSavedRoute,
  listSavedRoutes,
  type SavedRoute,
} from '../lib/savedRoutes';
import {
  listMyNotifications,
  listMySubscriptions,
  markNotificationRead,
  toggleSubscription,
  type AppNotification,
  type MySubscriptionRow,
} from '../lib/subscriptions';
import { supabase } from '../lib/supabase';
import type { Profile } from '../types/database';
import { useThemeColors } from '../theme/ThemeProvider';
import { useInfoToast } from './InfoToastProvider';
import {
  ListingDetailModal,
  type ListingWithCreator,
} from './ListingDetailModal';
import { SavedRouteDetailModal } from './SavedRouteDetailModal';
import { ShareAsTourModal } from './ShareAsTourModal';

type MenuSection = 'routes' | 'subscriptions' | 'notifications';

type ProfileBrief = {
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

function regionLabel(region: string | null | undefined): string {
  if (!region) return '';
  return REGIONS.find((r) => r.id === region)?.label ?? region;
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
  const { showError, showInfo } = useInfoToast();

  const [profile, setProfile] = useState<ProfileBrief | null>(null);
  const [section, setSection] = useState<MenuSection | null>(null);
  const [routes, setRoutes] = useState<SavedRoute[]>([]);
  const [subscriptions, setSubscriptions] = useState<MySubscriptionRow[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(false);

  const [viewRoute, setViewRoute] = useState<SavedRoute | null>(null);
  const [shareTourRoute, setShareTourRoute] = useState<SavedRoute | null>(null);
  const [selectedListing, setSelectedListing] = useState<ListingWithCreator | null>(null);
  const [listingVisible, setListingVisible] = useState(false);

  const slideAnim = useRef(new Animated.Value(320)).current;
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

  useEffect(() => {
    if (!visible) {
      return;
    }
    void load();
    slideAnim.setValue(320);
    Animated.spring(slideAnim, {
      toValue: 0,
      useNativeDriver: true,
      damping: 22,
      stiffness: 220,
    }).start();
  }, [visible, load, slideAnim]);

  const handleClose = useCallback(() => {
    Animated.timing(slideAnim, {
      toValue: 320,
      duration: 180,
      useNativeDriver: true,
    }).start(() => {
      setSection(null);
      onClose();
    });
  }, [slideAnim, onClose]);

  const openListingById = useCallback(async (listingId: string) => {
    const { data, error } = await supabase
      .from('listings')
      .select(LISTING_PUBLIC_COLUMNS)
      .eq('id', listingId)
      .maybeSingle();
    if (error || !data) {
      showError('Elan tapılmadı');
      return;
    }
    let creator: ListingWithCreator['creator'] = null;
    if (data.created_by) {
      const { data: p } = await supabase
        .from('profiles')
        .select('id, full_name, avatar_url, phone, is_verified')
        .eq('id', data.created_by)
        .maybeSingle();
      creator = (p as Pick<Profile, 'id' | 'full_name' | 'avatar_url' | 'phone' | 'is_verified'> | null) ?? null;
    }
    setSelectedListing({ ...data, creator });
    setListingVisible(true);
  }, [showError]);

  const handleNotificationPress = useCallback(
    async (n: AppNotification) => {
      await markNotificationRead(n.id);
      setNotifications((prev) =>
        prev.map((row) =>
          row.id === n.id ? { ...row, read_at: row.read_at ?? new Date().toISOString() } : row
        )
      );
      if (n.listing_id) {
        await openListingById(n.listing_id);
      }
    },
    [openListingById]
  );

  const handleRoutePress = useCallback((route: SavedRoute) => {
    setViewRoute(route);
  }, []);

  const handleDeleteRoute = useCallback(
    async (id: string) => {
      const { error } = await deleteSavedRoute(id);
      if (error) {
        showError(error);
        return;
      }
      setRoutes((prev) => prev.filter((r) => r.id !== id));
      setViewRoute((prev) => (prev?.id === id ? null : prev));
      showInfo('Marşrut silindi');
    },
    [showError, showInfo]
  );

  const handleSubscriptionPress = useCallback(
    async (item: MySubscriptionRow) => {
      if (item.target_type === 'organizer') {
        handleClose();
        setTimeout(() => {
          router.push({
            pathname: '/(tabs)/profil',
            params: { userId: item.target_id },
          } as never);
        }, 200);
        return;
      }
      await openListingById(item.target_id);
    },
    [handleClose, openListingById, router]
  );

  const handleUnsubscribe = useCallback(
    async (item: MySubscriptionRow) => {
      const result = await toggleSubscription(item.target_type, item.target_id);
      if (result.error) {
        showError(result.error);
        return;
      }
      if (!result.subscribed) {
        setSubscriptions((prev) => prev.filter((s) => s.id !== item.id));
        showInfo('Abunəlikdən çıxdınız');
      }
    },
    [showError, showInfo]
  );

  if (!visible) {
    return null;
  }

  return (
    <>
      <Modal
        transparent
        visible={visible}
        animationType="fade"
        onRequestClose={handleClose}
      >
        <View style={styles.modalRoot}>
          <Pressable
            style={styles.overlay}
            onPress={handleClose}
            accessibilityLabel="Menyunu bağla"
          />

          <Animated.View
            style={[
              styles.drawer,
              { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 16 },
              { transform: [{ translateX: slideAnim }] },
            ]}
          >
            {/* Close + profile */}
            <View style={styles.drawerTop}>
              <Pressable
                onPress={handleClose}
                style={styles.closeBtn}
                hitSlop={10}
                accessibilityLabel="Bağla"
              >
                <Ionicons name="close" size={22} color={colors.text} />
              </Pressable>
            </View>

            <Pressable
              style={styles.profileRow}
              onPress={() => {
                handleClose();
                setTimeout(() => router.push('/(tabs)/profil'), 200);
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
                <Text
                  style={[
                    styles.sectionLabel,
                    section === item.id && styles.sectionLabelActive,
                  ]}
                >
                  {item.label}
                </Text>
                {item.badge > 0 ? (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>
                      {item.badge > 99 ? '99+' : item.badge}
                    </Text>
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

            {section === 'notifications' ? (
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
                      onPress={() => void handleNotificationPress(n)}
                    >
                      <View style={styles.notifIcon}>
                        <NotificationIcon kind={n.kind} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.notifTitle}>{n.title}</Text>
                        {n.body ? (
                          <Text style={styles.notifBody} numberOfLines={2}>
                            {n.body}
                          </Text>
                        ) : null}
                        <Text style={styles.notifTime}>
                          {formatRelativeTime(n.created_at)}
                        </Text>
                      </View>
                      {!n.read_at ? <View style={styles.unreadDot} /> : null}
                    </Pressable>
                  ))
                )}
              </ScrollView>
            ) : null}

            {section === 'routes' ? (
              <ScrollView style={styles.sectionContent} showsVerticalScrollIndicator={false}>
                {loading ? (
                  <Text style={styles.emptyText}>Yüklənir…</Text>
                ) : routes.length === 0 ? (
                  <Text style={styles.emptyText}>Saxlanmış marşrut yoxdur.</Text>
                ) : (
                  routes.map((r) => (
                    <Pressable
                      key={r.id}
                      style={styles.routeRow}
                      onPress={() => handleRoutePress(r)}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.routeName} numberOfLines={1}>
                          {r.title || 'Marşrut'}
                        </Text>
                        <Text style={styles.routeSub} numberOfLines={1}>
                          {[regionLabel(r.region), r.source === 'ai' ? 'AI' : 'Əl ilə']
                            .filter(Boolean)
                            .join(' · ')}
                        </Text>
                      </View>
                      <Pressable
                        onPress={(e) => {
                          e.stopPropagation?.();
                          void handleDeleteRoute(r.id);
                        }}
                        hitSlop={8}
                        accessibilityLabel="Sil"
                      >
                        <Ionicons name="trash-outline" size={16} color={colors.dangerText} />
                      </Pressable>
                    </Pressable>
                  ))
                )}
              </ScrollView>
            ) : null}

            {section === 'subscriptions' ? (
              <ScrollView style={styles.sectionContent} showsVerticalScrollIndicator={false}>
                {loading ? (
                  <Text style={styles.emptyText}>Yüklənir…</Text>
                ) : subscriptions.length === 0 ? (
                  <Text style={styles.emptyText}>Heç bir abunəlik yoxdur.</Text>
                ) : (
                  subscriptions.map((s) => (
                    <Pressable
                      key={s.id}
                      style={styles.subRow}
                      onPress={() => void handleSubscriptionPress(s)}
                    >
                      {s.avatar_url ? (
                        <Image source={{ uri: s.avatar_url }} style={styles.subAvatar} />
                      ) : (
                        <View style={styles.subAvatarPlaceholder}>
                          <Ionicons
                            name={
                              s.target_type === 'listing'
                                ? 'calendar-outline'
                                : 'person-outline'
                            }
                            size={14}
                            color={colors.textMuted}
                          />
                        </View>
                      )}
                      <View style={{ flex: 1, marginLeft: 8 }}>
                        <Text style={styles.subName} numberOfLines={1}>
                          {s.title}
                        </Text>
                        {s.subtitle ? (
                          <Text style={styles.subType} numberOfLines={1}>
                            {s.subtitle}
                          </Text>
                        ) : null}
                      </View>
                      <Pressable
                        onPress={(e) => {
                          e.stopPropagation?.();
                          void handleUnsubscribe(s);
                        }}
                        hitSlop={8}
                        accessibilityLabel="Abunəlikdən çıx"
                      >
                        <Ionicons name="notifications-off-outline" size={16} color={colors.textMuted} />
                      </Pressable>
                    </Pressable>
                  ))
                )}
              </ScrollView>
            ) : null}
          </Animated.View>
        </View>
      </Modal>

      <SavedRouteDetailModal
        route={viewRoute}
        visible={!!viewRoute}
        onClose={() => setViewRoute(null)}
        onUnsave={() => {
          if (viewRoute) void handleDeleteRoute(viewRoute.id);
        }}
        onShareAsTour={
          viewRoute && viewRoute.source === 'manual' && !viewRoute.listing_id
            ? () => {
                setShareTourRoute(viewRoute);
                setViewRoute(null);
              }
            : undefined
        }
      />

      <ShareAsTourModal
        visible={!!shareTourRoute}
        onClose={() => setShareTourRoute(null)}
        savedRouteId={shareTourRoute?.id}
        regionId={shareTourRoute?.region}
        defaultTitle={shareTourRoute?.title}
        defaultDescription={shareTourRoute?.summary ?? undefined}
        stops={(shareTourRoute?.stops ?? []).map((stop) => ({
          name: stop.name,
          lat: stop.lat,
          lng: stop.lng,
          poiId: stop.poi_id,
        }))}
        onCreated={() => {
          setShareTourRoute(null);
          void load();
        }}
      />

      <ListingDetailModal
        listing={selectedListing}
        visible={listingVisible}
        onClose={() => {
          setListingVisible(false);
          setSelectedListing(null);
        }}
        onDeleted={() => {
          setListingVisible(false);
          setSelectedListing(null);
          void load();
        }}
      />
    </>
  );
}

/** Badge count — 0 if no unread. */
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
    modalRoot: {
      flex: 1,
    },
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
    drawerTop: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      marginBottom: 4,
    },
    closeBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.surfaceMuted,
      alignItems: 'center',
      justifyContent: 'center',
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
      maxHeight: 320,
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
