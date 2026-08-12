import { CreateListingModal } from '../../components/CreateListingModal';
import {
  ListingDetailModal,
  type ListingWithCreator,
} from '../../components/ListingDetailModal';
import { SubscribeMenuButton } from '../../components/SubscribeMenuButton';
import { HamburgerMenuButton } from '../../components/HamburgerMenuButton';
import { ScreenHeader } from '../../components/ScreenHeader';
import { REGIONS } from '../../constants/regions';
import { getErrorMessage } from '../../lib/errors';
import { LISTING_PUBLIC_COLUMNS } from '../../lib/listingColumns';
import { listMySubscriptionTargetIds } from '../../lib/subscriptions';
import { useResponsiveLayout } from '../../lib/layout';
import { supabase } from '../../lib/supabase';
import type { Listing, ListingType, Profile } from '../../types/database';

import type { ThemeColors } from '../../constants/theme';
import { useThemeColors } from '../../theme/ThemeProvider';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { memo, useCallback, useEffect, useState, useMemo } from 'react';
import {
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type ListingFilter = 'all' | ListingType;

const FILTERS: { id: ListingFilter; label: string }[] = [
  { id: 'all', label: 'Hamısı' },
  { id: 'tour', label: 'Tur' },
  { id: 'local_service', label: 'Yerli xidmət' },
  { id: 'carpool', label: 'Carpool' },
];

function getTypeMeta(colors: ThemeColors): Record<
  ListingType,
  { label: string; tint: string; soft: string }
> {
  return {
    carpool: { label: 'Carpool', tint: colors.accent, soft: colors.accentSoft },
    tour: { label: 'Tur', tint: colors.success, soft: colors.successSoft },
    local_service: { label: 'Yerli xidmət', tint: colors.warning, soft: colors.warningSoft },
  };
}

function formatDate(value: string | null): string {
  if (!value) {
    return 'Tarix yoxdur';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString('az-AZ', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
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

export default function IcmaScreen() {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const insets = useSafeAreaInsets();
  const { padH } = useResponsiveLayout();

  const [filter, setFilter] = useState<ListingFilter>('all');
  const [listings, setListings] = useState<ListingWithCreator[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedListing, setSelectedListing] = useState<ListingWithCreator | null>(null);
  const [detailVisible, setDetailVisible] = useState(false);
  const [createVisible, setCreateVisible] = useState(false);
  const [subListingIds, setSubListingIds] = useState<Set<string>>(new Set());
  const [subOrganizerIds, setSubOrganizerIds] = useState<Set<string>>(new Set());
  const [subsReady, setSubsReady] = useState(false);

  const fetchListings = useCallback(async (selectedFilter: ListingFilter) => {
    setLoading(true);
    setErrorMessage(null);

    let query = supabase
      .from('listings')
      .select(LISTING_PUBLIC_COLUMNS)
      .eq('status', 'active')
      .order('created_at', { ascending: false });

    if (selectedFilter !== 'all') {
      query = query.eq('type', selectedFilter);
    }

    const [listingsResult, subTargets] = await Promise.all([
      query,
      listMySubscriptionTargetIds(),
    ]);

    setSubListingIds(subTargets.listingIds);
    setSubOrganizerIds(subTargets.organizerIds);
    setSubsReady(true);

    const { data, error } = listingsResult;

    if (error) {
      console.warn('[icma] listings fetch failed', error);
      setErrorMessage(getErrorMessage(error));
      setListings([]);
      setLoading(false);
      return;
    }

    const rows = data ?? [];
    if (rows.length === 0) {
      setListings([]);
      setLoading(false);
      return;
    }

    const creatorIds = [...new Set(rows.map((row) => row.created_by))];
    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select('id, full_name, avatar_url, phone, is_verified')
      .in('id', creatorIds);

    if (profilesError) {
      console.warn('[icma] profiles fetch failed', profilesError);
      setErrorMessage(getErrorMessage(profilesError));
      setListings([]);
      setLoading(false);
      return;
    }

    const profileMap = new Map(
      (profiles ?? []).map((profile) => [
        profile.id,
        profile as Pick<Profile, 'id' | 'full_name' | 'avatar_url' | 'phone' | 'is_verified'>,
      ])
    );

    setListings(
      rows.map((row) => ({
        ...row,
        creator: profileMap.get(row.created_by) ?? null,
      }))
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchListings(filter);
  }, [filter, fetchListings]);

  function openDetail(listing: ListingWithCreator) {
    setSelectedListing(listing);
    setDetailVisible(true);
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 64 : 0}
    >
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScreenHeader
        title="icma"
        subtitle="Sakitcə planla · yoldaş tap"
        style={{ paddingHorizontal: padH }}
        right={
          <View style={styles.headerActions}>
            <Pressable style={styles.addButton} onPress={() => setCreateVisible(true)} hitSlop={8}>
              <FontAwesome name="plus" size={14} color={colors.textOnAccent} />
            </Pressable>
            <HamburgerMenuButton />
          </View>
        }
      />

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterScroll}
        contentContainerStyle={[styles.filterRow, { paddingHorizontal: padH }]}
      >
        {FILTERS.map((item) => {
          const selected = item.id === filter;
          return (
            <Pressable
              key={item.id}
              onPress={() => setFilter(item.id)}
              style={[styles.filterChip, selected && styles.filterChipSelected]}
            >
              <Text style={[styles.filterText, selected && styles.filterTextSelected]}>
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}

      {loading ? (
        <View style={styles.listPad}>
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </View>
      ) : (
        <FlatList
          data={listings}
          keyExtractor={(item) => item.id}
          style={{ flex: 1 }}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <MemoListingCard
              listing={item}
              onPress={() => openDetail(item)}
              statusReady={subsReady}
              listingSubscribed={subListingIds.has(item.id)}
              organizerSubscribed={subOrganizerIds.has(
                item.created_by ?? item.creator?.id ?? ''
              )}
            />
          )}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>Hələ elan yoxdur</Text>
              <Pressable style={styles.emptyButton} onPress={() => setCreateVisible(true)}>
                <Text style={styles.emptyButtonText}>İlk elanı sən yarat</Text>
              </Pressable>
            </View>
          }
          refreshing={loading}
          onRefresh={() => fetchListings(filter)}
        />
      )}

      <ListingDetailModal
        listing={selectedListing}
        visible={detailVisible}
        onClose={() => {
          setDetailVisible(false);
          setSelectedListing(null);
        }}
        onDeleted={() => {
          setDetailVisible(false);
          setSelectedListing(null);
          fetchListings(filter);
        }}
      />

      <CreateListingModal
        visible={createVisible}
        onClose={() => setCreateVisible(false)}
        onCreated={() => fetchListings(filter)}
      />
    </View>
    </KeyboardAvoidingView>
  );
}

/** dolu / ümumi — məs. 0/3, 2/5 */
function formatFilledSpots(listing: ListingWithCreator): string | null {
  const total = listing.capacity ?? listing.max_participants;
  if (total != null && total > 0) {
    const left = listing.spots_left ?? total;
    const filled = Math.max(0, total - left);
    return `${filled}/${total}`;
  }
  return null;
}

function ListingCard({
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

  const meta = getTypeMeta(colors)[listing.type];
  const creatorName = listing.creator?.full_name?.trim() || 'İstifadəçi';
  const seatsLabel = formatFilledSpots(listing);
  const price = formatPrice(listing);

  let pairLeft = '';
  let pairRight = '';

  if (listing.type === 'carpool') {
    pairLeft = `${listing.origin_text || '—'} → ${listing.destination_text || '—'}`;
    pairRight = [formatDate(listing.departure_at), seatsLabel].filter(Boolean).join(' · ');
  } else if (listing.type === 'tour') {
    pairLeft = formatDate(listing.departure_at);
    pairRight = seatsLabel ?? '';
  } else if (seatsLabel) {
    pairLeft = getRegionLabel(listing.region);
    pairRight = seatsLabel;
  } else {
    pairLeft = getRegionLabel(listing.region);
  }

  const organizerId = listing.created_by ?? listing.creator?.id;

  return (
    <Pressable style={styles.card} onPress={onPress}>
      <View style={styles.cardInner}>
        {listing.creator?.avatar_url ? (
          <Image source={{ uri: listing.creator.avatar_url }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatarPlaceholder, styles.avatarWarm]}>
            <Text style={styles.avatarInitialWarm}>{creatorName.charAt(0).toUpperCase()}</Text>
          </View>
        )}

        <View style={styles.cardBody}>
          <View style={styles.cardTop}>
            <View>
              <Text style={styles.creatorLine} numberOfLines={1}>
                {creatorName}
              </Text>
            </View>
            <View style={[styles.badge, { backgroundColor: meta.soft }]}>
              <Text style={[styles.badgeText, { color: meta.tint }]}>{meta.label}</Text>
            </View>
          </View>

          <Text style={styles.cardTitle} numberOfLines={2}>
            {listing.title}
          </Text>

          <View style={styles.factsRow}>
            <Text style={styles.factChip} numberOfLines={1}>
              {getRegionLabel(listing.region)}
            </Text>
            {pairLeft ? (
              <Text style={styles.factChip} numberOfLines={1}>
                {pairLeft}
              </Text>
            ) : null}
            <Text style={styles.factPrice} numberOfLines={1}>
              {price}
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

const MemoListingCard = memo(ListingCard);

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
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
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
  addButton: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterScroll: {
    flexGrow: 0,
    flexShrink: 0,
  },
  filterRow: {
    paddingHorizontal: 12,
    paddingBottom: 8,
    gap: 6,
    alignItems: 'center',
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSoft,
    marginRight: 2,
  },
  filterChipSelected: {
    backgroundColor: colors.chipSelected,
    borderColor: colors.chipSelected,
  },
  filterText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.chipText,
    lineHeight: 16,
  },
  filterTextSelected: {
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
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  avatarPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.chip,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarWarm: {
    backgroundColor: '#F59E0B',
  },
  avatarInitial: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  avatarInitialWarm: {
    fontSize: 15,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  creatorLine: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
    maxWidth: 160,
  },
  factsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
  },
  factChip: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textSecondary,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    overflow: 'hidden',
    maxWidth: '48%',
  },
  factPrice: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.brand,
    marginLeft: 'auto',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 48,
    paddingHorizontal: 20,
  },
  emptyTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
    marginBottom: 10,
  },
  emptyButton: {
    backgroundColor: colors.accent,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  emptyButtonText: {
    color: colors.textOnAccent,
    fontWeight: '600',
    fontSize: 12,
  },
  errorText: {
    marginHorizontal: 12,
    marginBottom: 6,
    color: colors.dangerText,
    fontSize: 12,
  },
  skeletonCard: {
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 8,
    marginBottom: 4,
    backgroundColor: colors.surfaceMuted,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSoft,
  },
  skeletonTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  skeletonLine: {
    height: 10,
    borderRadius: 4,
    backgroundColor: colors.border,
  },
  skeletonAvatar: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: colors.border,
  },
});
}
