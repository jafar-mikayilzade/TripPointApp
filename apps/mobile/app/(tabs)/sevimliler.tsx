import { useFocusEffect, useRouter } from 'expo-router';
import { memo, useCallback, useMemo, useState } from 'react';
import {
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CategoryIcon } from '../../components/CategoryIcon';
import {
  ListingDetailModal,
  type ListingWithCreator,
} from '../../components/ListingDetailModal';
import { HamburgerMenuButton } from '../../components/HamburgerMenuButton';
import { SubscribeMenuButton } from '../../components/SubscribeMenuButton';
import { ScreenHeader } from '../../components/ScreenHeader';

import { REGIONS } from '../../constants/regions';
import type { ThemeColors } from '../../constants/theme';
import { useThemeColors } from '../../theme/ThemeProvider';
import { useResponsiveLayout } from '../../lib/layout';

import { getCategoryLabel } from '../../lib/categoryUtils';
import { getErrorMessage } from '../../lib/errors';
import { LISTING_PUBLIC_COLUMNS } from '../../lib/listingColumns';
import {
  listFavoriteListingIdsOrdered,
  listFavoritePoiIdsOrdered,
} from '../../lib/favorites';
import { supabase } from '../../lib/supabase';
import type { Listing, ListingType, Poi, Profile } from '../../types/database';

type TabId = 'listings' | 'pois';

const TABS: { id: TabId; label: string }[] = [
  { id: 'listings', label: 'Elanlar' },
  { id: 'pois', label: 'Yerlər' },
];

function getListingTypeMeta(colors: ThemeColors): Record<
  ListingType,
  { label: string; tint: string; soft: string }
> {
  return {
    carpool: { label: 'Carpool', tint: colors.accent, soft: colors.accentSoft },
    tour: { label: 'Tur', tint: colors.success, soft: colors.successSoft },
    local_service: { label: 'Yerli xidmət', tint: colors.warning, soft: colors.warningSoft },
  };
}

function formatPrice(listing: Listing): string {
  if (listing.price_type === 'free' || listing.price === 0) {
    return 'Pulsuz';
  }
  if (listing.price == null) {
    return listing.price_type === 'negotiable' ? 'Razılaşma ilə' : 'Qiymət yoxdur';
  }
  const amount = `${listing.price} AZN`;
  if (listing.price_type === 'per_person') {
    return `${amount}/nəfər`;
  }
  return amount;
}

function getRegionLabel(region: string | null): string {
  if (!region) {
    return '—';
  }
  return REGIONS.find((item) => item.id === region)?.label ?? region;
}

export default function SevimlilerScreen() {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const insets = useSafeAreaInsets();
  const router = useRouter();

  const { padH, isCompact } = useResponsiveLayout();

  const [tab, setTab] = useState<TabId>('listings');
  const [listings, setListings] = useState<ListingWithCreator[]>([]);
  const [pois, setPois] = useState<Poi[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedListing, setSelectedListing] = useState<ListingWithCreator | null>(null);
  const [detailVisible, setDetailVisible] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErrorMessage(null);
    const errors: string[] = [];

    const [listingIds, poiIds] = await Promise.all([
      listFavoriteListingIdsOrdered(),
      listFavoritePoiIdsOrdered(),
    ]);

    try {
      if (listingIds.length === 0) {
        setListings([]);
      } else {
        const { data, error } = await supabase
          .from('listings')
          .select(LISTING_PUBLIC_COLUMNS)
          .in('id', listingIds)
          .eq('status', 'active');

        if (error) {
          throw error;
        }

        const rows = data ?? [];
        const order = new Map(listingIds.map((id, i) => [id, i]));
        rows.sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999));

        const creatorIds = [...new Set(rows.map((r) => r.created_by))];
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, full_name, avatar_url, phone, is_verified')
          .in('id', creatorIds);

        const profileMap = new Map(
          (profiles ?? []).map((p) => [
            p.id,
            p as Pick<Profile, 'id' | 'full_name' | 'avatar_url' | 'phone' | 'is_verified'>,
          ])
        );

        setListings(
          rows.map((row) => ({
            ...row,
            creator: profileMap.get(row.created_by) ?? null,
          }))
        );
      }
    } catch (err) {
      console.warn('[sevimliler] favorite listings fetch failed', err);
      setListings([]);
      errors.push(getErrorMessage(err));
    }

    try {
      if (poiIds.length === 0) {
        setPois([]);
      } else {
        const { data, error } = await supabase
          .from('pois')
          .select('*')
          .in('id', poiIds)
          .eq('status', 'approved');

        if (error) {
          throw error;
        }

        const rows = data ?? [];
        const order = new Map(poiIds.map((id, i) => [id, i]));
        rows.sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999));
        setPois(rows);
      }
    } catch (err) {
      console.warn('[sevimliler] favorite pois fetch failed', err);
      setPois([]);
      errors.push(getErrorMessage(err));
    }

    if (errors.length > 0) {
      setErrorMessage(errors[0]);
    }
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const listingCount = listings.length;
  const poiCount = pois.length;

  function tabCount(id: TabId): number {
    return id === 'listings' ? listingCount : poiCount;
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScreenHeader
        title="Sevimlilər"
        subtitle="Saxladığınız elanlar və yerlər"
        style={{ paddingHorizontal: padH }}
        right={<HamburgerMenuButton />}
      />

      <View style={[styles.tabRow, { paddingHorizontal: padH }]}>
        {TABS.map((item) => {
          const selected = tab === item.id;
          const count = tabCount(item.id);
          const labelBase = isCompact
            ? ({ listings: 'Elan', pois: 'Yer' } as const)[item.id]
            : item.label;
          const label = `${labelBase} (${count})`;
          return (
            <Pressable
              key={item.id}
              style={[styles.tabChip, selected && styles.tabChipSelected]}
              onPress={() => setTab(item.id)}
            >
              <Text
                style={[styles.tabText, selected && styles.tabTextSelected]}
                numberOfLines={1}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}

      {loading ? (
        <View style={styles.listPad}>
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </View>
      ) : tab === 'listings' ? (
        <FlatList
          data={listings}
          keyExtractor={(item) => item.id}
          style={styles.flex}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshing={loading}
          onRefresh={() => void load()}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>Sevimli elan yoxdur</Text>
              <Text style={styles.emptySubtitle}>
                İcma elanında bookmark ilə əlavə edin
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <MemoFavoriteListingCard
              listing={item}
              onPress={() => {
                setSelectedListing(item);
                setDetailVisible(true);
              }}
            />
          )}
        />
      ) : (
        <FlatList
          data={pois}
          keyExtractor={(item) => item.id}
          style={styles.flex}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshing={loading}
          onRefresh={() => void load()}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>Sevimli yer yoxdur</Text>
              <Text style={styles.emptySubtitle}>
                Ana səhifədə məkana baxıb bookmark edin
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <MemoFavoritePoiCard
              poi={item}
              onPress={() => router.push('/(tabs)' as never)}
            />
          )}
        />
      )}

      <ListingDetailModal
        listing={selectedListing}
        visible={detailVisible}
        onClose={() => {
          setDetailVisible(false);
          setSelectedListing(null);
          void load();
        }}
        onDeleted={() => {
          setDetailVisible(false);
          setSelectedListing(null);
          void load();
        }}
      />

    </View>
  );
}

function FavoriteListingCard({
  listing,
  onPress,
  statusReady = false,
  listingSubscribed = false,
  organizerSubscribed = false,
}: {
  listing: ListingWithCreator;
  onPress: () => void;
  statusReady?: boolean;
  listingSubscribed?: boolean;
  organizerSubscribed?: boolean;
}) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const meta = getListingTypeMeta(colors)[listing.type];
  const creatorName = listing.creator?.full_name?.trim() || 'İstifadəçi';
  const region = getRegionLabel(listing.region);
  const organizerId = listing.created_by ?? listing.creator?.id;

  return (
    <Pressable style={styles.card} onPress={onPress}>
      <View style={styles.cardInner}>
        {listing.creator?.avatar_url ? (
          <Image source={{ uri: listing.creator.avatar_url }} style={styles.avatar} />
        ) : (
          <View style={styles.avatarPlaceholder}>
            <Text style={styles.avatarInitial}>{creatorName.charAt(0).toUpperCase()}</Text>
          </View>
        )}

        <View style={styles.cardBody}>
          <View style={styles.cardTop}>
            <View style={[styles.badge, { backgroundColor: meta.soft }]}>
              <Text style={[styles.badgeText, { color: meta.tint }]}>{meta.label}</Text>
            </View>
            <Text style={styles.topRight} numberOfLines={1}>
              {formatPrice(listing)}
            </Text>
          </View>

          <Text style={styles.cardTitle} numberOfLines={1}>
            {listing.title}
          </Text>

          <View style={styles.pairRow}>
            <Text style={styles.pairLeft} numberOfLines={1}>
              {creatorName}
            </Text>
            <Text style={styles.pairRight} numberOfLines={1}>
              {region}
            </Text>
          </View>
        </View>

        {listing.type === 'tour' ? (
          <SubscribeMenuButton
            compact
            listingId={listing.id}
            organizerId={organizerId}
            statusReady={statusReady}
            listingSubscribed={listingSubscribed}
            organizerSubscribed={organizerSubscribed}
          />
        ) : null}
      </View>
    </Pressable>
  );
}

const MemoFavoriteListingCard = memo(FavoriteListingCard);

function FavoritePoiCard({ poi, onPress }: { poi: Poi; onPress: () => void }) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const regionLabel = getRegionLabel(poi.region);

  return (
    <Pressable style={styles.card} onPress={onPress}>
      <View style={styles.cardInner}>
        <View style={styles.poiIconWrap}>
          <CategoryIcon category={poi.category} size={15} color={colors.text} />
        </View>
        <View style={styles.cardBody}>
          <Text style={styles.cardTitle} numberOfLines={1}>
            {poi.name}
          </Text>
          <View style={styles.pairRow}>
            <Text style={styles.pairLeft} numberOfLines={1}>
              {getCategoryLabel(poi.category)} · {regionLabel}
            </Text>
            {typeof poi.rating === 'number' && poi.rating > 0 ? (
              <Text style={styles.pairRight} numberOfLines={1}>
                ★ {poi.rating.toFixed(1)}
              </Text>
            ) : null}
          </View>
        </View>
      </View>
    </Pressable>
  );
}

const MemoFavoritePoiCard = memo(FavoritePoiCard);


function SkeletonCard() {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={styles.skeletonCard}>
      <View style={styles.cardInner}>
        <View style={styles.skeletonAvatar} />
        <View style={styles.cardBody}>
          <View style={styles.skeletonTop}>
            <View style={[styles.skeletonLine, { width: 56, height: 12, marginTop: 0 }]} />
            <View style={[styles.skeletonLine, { width: 40, height: 10, marginTop: 0 }]} />
          </View>
          <View style={[styles.skeletonLine, { width: '65%', marginTop: 6 }]} />
          <View style={styles.skeletonTop}>
            <View style={[styles.skeletonLine, { width: '50%', marginTop: 6 }]} />
            <View style={[styles.skeletonLine, { width: 36, marginTop: 6 }]} />
          </View>
        </View>
      </View>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
  flex: {
    flex: 1,
  },
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: 6,
    paddingBottom: 8,
  },
  titleBlock: {
    flex: 1,
    minWidth: 0,
    paddingRight: 10,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.4,
    textTransform: 'lowercase',
  },
  subtitle: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: '500',
    color: colors.textMuted,
  },
  tabRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 12,
    paddingBottom: 8,
    gap: 6,
  },
  tabChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSoft,
  },
  tabChipSelected: {
    backgroundColor: colors.chipSelected,
    borderColor: colors.chipSelected,
  },
  tabText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.chipText,
    lineHeight: 16,
  },
  tabTextSelected: {
    color: colors.textOnAccent,
  },
  listPad: {
    paddingHorizontal: 10,
  },
  listContent: {
    paddingHorizontal: 10,
    paddingBottom: 20,
    flexGrow: 1,
  },
  card: {
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 8,
    marginBottom: 4,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSoft,
  },
  cardInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cardBody: {
    flex: 1,
    minWidth: 0,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 3,
  },
  badge: {
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  topRight: {
    flexShrink: 0,
    fontSize: 12,
    fontWeight: '600',
    color: colors.text,
  },
  topRightCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  cardTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 2,
  },
  pairRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  pairLeft: {
    flex: 1,
    minWidth: 0,
    fontSize: 11,
    fontWeight: '500',
    color: colors.textMuted,
  },
  pairRight: {
    flexShrink: 0,
    maxWidth: '42%',
    fontSize: 11,
    fontWeight: '600',
    color: colors.textMuted,
    textAlign: 'right',
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: colors.chip,
  },
  avatarPlaceholder: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.accent,
  },
  poiIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: colors.chip,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 48,
    paddingHorizontal: 24,
    gap: 6,
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  emptySubtitle: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 17,
  },
  errorText: {
    marginHorizontal: 12,
    marginBottom: 6,
    backgroundColor: colors.dangerSoft,
    color: colors.dangerText,
    borderRadius: 10,
    padding: 8,
    fontSize: 12,
  },
  skeletonCard: {
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 8,
    marginBottom: 4,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSoft,
  },
  skeletonAvatar: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: colors.skeleton,
  },
  skeletonTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  skeletonLine: {
    height: 10,
    borderRadius: 4,
    backgroundColor: colors.skeleton,
    marginTop: 4,
  },
});
}
