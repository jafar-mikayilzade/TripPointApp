import FontAwesome from '@expo/vector-icons/FontAwesome';
import { memo, useCallback, useEffect, useState } from 'react';
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

import { CreateListingModal } from '../../components/CreateListingModal';
import {
  ListingDetailModal,
  type ListingWithCreator,
} from '../../components/ListingDetailModal';
import { ProfileCornerButton } from '../../components/ProfileCornerButton';
import { REGIONS } from '../../constants/regions';
import { getErrorMessage } from '../../lib/errors';
import { supabase } from '../../lib/supabase';
import type { Listing, ListingType, Profile } from '../../types/database';

import { colors, radii, shadows, space } from '../../constants/theme';

type ListingFilter = 'all' | ListingType;

const FILTERS: { id: ListingFilter; label: string }[] = [
  { id: 'all', label: 'Hamısı' },
  { id: 'tour', label: 'Tur' },
  { id: 'local_service', label: 'Yerli xidmət' },
  { id: 'carpool', label: 'Carpool' },
];

const TYPE_META: Record<
  ListingType,
  { label: string; tint: string; soft: string }
> = {
  carpool: { label: 'Carpool', tint: colors.accent, soft: colors.accentSoft },
  tour: { label: 'Tur', tint: colors.success, soft: colors.successSoft },
  local_service: { label: 'Yerli xidmət', tint: colors.warning, soft: colors.warningSoft },
};

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
  const insets = useSafeAreaInsets();

  const [filter, setFilter] = useState<ListingFilter>('all');
  const [listings, setListings] = useState<ListingWithCreator[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedListing, setSelectedListing] = useState<ListingWithCreator | null>(null);
  const [detailVisible, setDetailVisible] = useState(false);
  const [createVisible, setCreateVisible] = useState(false);

  const fetchListings = useCallback(async (selectedFilter: ListingFilter) => {
    setLoading(true);
    setErrorMessage(null);

    let query = supabase
      .from('listings')
      .select('*')
      .eq('status', 'active')
      .order('created_at', { ascending: false });

    if (selectedFilter !== 'all') {
      query = query.eq('type', selectedFilter);
    }

    const { data, error } = await query;

    if (error) {
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
      .select('id, full_name, avatar_url, phone')
      .in('id', creatorIds);

    if (profilesError) {
      setErrorMessage(getErrorMessage(profilesError));
      setListings([]);
      setLoading(false);
      return;
    }

    const profileMap = new Map(
      (profiles ?? []).map((profile) => [
        profile.id,
        profile as Pick<Profile, 'id' | 'full_name' | 'avatar_url' | 'phone'>,
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
      <View style={styles.header}>
        <View style={styles.titleBlock}>
          <Text style={styles.title}>icma</Text>
          <Text style={styles.subtitle}>Sakitcə planla · yoldaş tap</Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable style={styles.addButton} onPress={() => setCreateVisible(true)} hitSlop={8}>
            <FontAwesome name="plus" size={18} color={colors.textOnAccent} />
          </Pressable>
          <ProfileCornerButton />
        </View>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterScroll}
        contentContainerStyle={styles.filterRow}
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
            <MemoListingCard listing={item} onPress={() => openDetail(item)} />
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
}: {
  listing: ListingWithCreator;
  onPress: () => void;
}) {
  const meta = TYPE_META[listing.type];
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
              {price}
            </Text>
          </View>

          <Text style={styles.cardTitle} numberOfLines={1}>
            {listing.title}
          </Text>

          <View style={styles.pairRow}>
            <Text style={styles.pairLeft} numberOfLines={1}>
              {pairLeft}
            </Text>
            {pairRight ? (
              <Text style={styles.pairRight} numberOfLines={1}>
                {pairRight}
              </Text>
            ) : null}
          </View>
        </View>
      </View>
    </Pressable>
  );
}

const MemoListingCard = memo(ListingCard);

function SkeletonCard() {
  return (
    <View style={styles.skeletonCard}>
      <View style={styles.cardInner}>
        <View style={styles.skeletonAvatar} />
        <View style={styles.cardBody}>
          <View style={styles.skeletonTop}>
            <View style={[styles.skeletonLine, { width: 72, height: 16, marginTop: 0 }]} />
            <View style={[styles.skeletonLine, { width: 48, height: 12, marginTop: 0 }]} />
          </View>
          <View style={[styles.skeletonLine, { width: '70%', marginTop: 8 }]} />
          <View style={styles.skeletonTop}>
            <View style={[styles.skeletonLine, { width: '55%', marginTop: 8 }]} />
            <View style={[styles.skeletonLine, { width: 40, marginTop: 8 }]} />
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 14,
  },
  titleBlock: {
    flex: 1,
    minWidth: 0,
    paddingRight: 12,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  title: {
    fontSize: 34,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.8,
    textTransform: 'lowercase',
  },
  subtitle: {
    marginTop: 4,
    fontSize: 13,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  addButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.fab,
  },
  filterScroll: {
    flexGrow: 0,
    flexShrink: 0,
  },
  filterRow: {
    paddingHorizontal: space.lg,
    paddingBottom: space.md,
    gap: 8,
    alignItems: 'center',
  },
  filterChip: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: radii.pill,
    backgroundColor: colors.chip,
    marginRight: 4,
  },
  filterChipSelected: {
    backgroundColor: colors.chipSelected,
  },
  filterText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.chipText,
    lineHeight: 18,
  },
  filterTextSelected: {
    color: colors.textOnAccent,
  },
  listPad: {
    paddingHorizontal: space.lg,
  },
  listContent: {
    paddingHorizontal: space.lg,
    paddingBottom: 28,
    flexGrow: 1,
  },
  card: {
    borderRadius: radii.lg,
    paddingVertical: 12,
    paddingHorizontal: 12,
    marginBottom: 8,
    backgroundColor: colors.surface,
    ...shadows.card,
  },
  cardInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  cardBody: {
    flex: 1,
    minWidth: 0,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 6,
  },
  badge: {
    borderRadius: radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  topRight: {
    flexShrink: 0,
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.2,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.2,
    marginBottom: 4,
  },
  pairRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  pairLeft: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  pairRight: {
    flexShrink: 0,
    maxWidth: '42%',
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    textAlign: 'right',
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 14,
  },
  avatarPlaceholder: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 64,
    paddingHorizontal: 24,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textSecondary,
    marginBottom: 14,
  },
  emptyButton: {
    backgroundColor: colors.accent,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  emptyButtonText: {
    color: colors.textOnAccent,
    fontWeight: '700',
    fontSize: 14,
  },
  errorText: {
    marginHorizontal: 16,
    marginBottom: 8,
    color: colors.dangerText,
    fontSize: 13,
  },
  skeletonCard: {
    borderRadius: radii.lg,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 8,
    backgroundColor: colors.surfaceMuted,
  },
  skeletonTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  skeletonLine: {
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.border,
  },
  skeletonAvatar: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: colors.border,
  },
});
