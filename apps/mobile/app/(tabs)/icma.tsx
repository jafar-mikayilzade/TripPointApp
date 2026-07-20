import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
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
import { REGIONS } from '../../constants/regions';
import { getErrorMessage } from '../../lib/errors';
import { supabase } from '../../lib/supabase';
import type { Listing, ListingType, Profile } from '../../types/database';

import { colors } from '../../constants/theme';

type ListingFilter = 'all' | ListingType;

const FILTERS: { id: ListingFilter; label: string }[] = [
  { id: 'all', label: 'Hamısı' },
  { id: 'tour', label: '🗺 Tur' },
  { id: 'local_service', label: '🏔 Yerli Xidmət' },
  { id: 'carpool', label: '🚗 Carpool' },
];

const TYPE_META: Record<ListingType, { label: string; emoji: string; color: string }> = {
  carpool: { label: 'Carpool', emoji: '🚗', color: '#5B8DEF' },
  tour: { label: 'Tur', emoji: '🗺', color: '#1B7A4E' },
  local_service: { label: 'Yerli xidmət', emoji: '🏔', color: '#C96B45' },
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
          <Text style={styles.title}>İcma</Text>
          <Text style={styles.subtitle}>Elanlar və turlar</Text>
        </View>
        <Pressable style={styles.addButton} onPress={() => setCreateVisible(true)} hitSlop={8}>
          <FontAwesome name="plus" size={18} color={colors.textOnAccent} />
        </Pressable>
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
            <ListingCard listing={item} onPress={() => openDetail(item)} />
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

function ListingCard({
  listing,
  onPress,
}: {
  listing: ListingWithCreator;
  onPress: () => void;
}) {
  const meta = TYPE_META[listing.type];
  const creatorName = listing.creator?.full_name?.trim() || 'İstifadəçi';

  return (
    <Pressable style={styles.card} onPress={onPress}>
      <View
        style={[
          styles.badge,
          {
            backgroundColor:
              listing.type === 'tour' ? colors.successSoft : `${meta.color}18`,
          },
        ]}
      >
        <Text style={[styles.badgeText, { color: meta.color }]}>
          {meta.emoji} {meta.label}
        </Text>
      </View>

      <Text style={styles.cardTitle} numberOfLines={2}>
        {listing.title}
      </Text>
      <Text style={styles.cardDescription} numberOfLines={2}>
        {listing.description?.trim() || 'Təsvir yoxdur'}
      </Text>

      <View style={styles.creatorRow}>
        {listing.creator?.avatar_url ? (
          <Image source={{ uri: listing.creator.avatar_url }} style={styles.avatar} />
        ) : (
          <View style={styles.avatarPlaceholder}>
            <Text style={styles.avatarInitial}>{creatorName.charAt(0).toUpperCase()}</Text>
          </View>
        )}
        <Text style={styles.creatorName}>{creatorName}</Text>
      </View>

      <View style={styles.metaBlock}>
        {listing.type === 'carpool' ? (
          <>
            <Text style={styles.metaLine}>
              📍 {listing.origin_text || '—'} → {listing.destination_text || '—'}
            </Text>
            <Text style={styles.metaLine}>📅 {formatDate(listing.departure_at)}</Text>
            <Text style={styles.metaLine}>💺 {listing.spots_left ?? 0} yer qalıb</Text>
          </>
        ) : null}

        {listing.type === 'tour' ? (
          <>
            <Text style={styles.metaLine}>📍 {getRegionLabel(listing.region)}</Text>
            <Text style={styles.metaLine}>📅 {formatDate(listing.departure_at)}</Text>
            <Text style={styles.metaLine}>
              👥 {listing.spots_left ?? 0} yer · 💰 {formatPrice(listing)}
            </Text>
          </>
        ) : null}

        {listing.type === 'local_service' ? (
          <>
            <Text style={styles.metaLine}>📍 {getRegionLabel(listing.region)}</Text>
            <Text style={styles.metaLine}>💰 {formatPrice(listing)}</Text>
            {listing.is_recurring ? (
              <Text style={styles.metaLine}>🔄 Daimi xidmət</Text>
            ) : null}
          </>
        ) : null}
      </View>
    </Pressable>
  );
}

function SkeletonCard() {
  return (
    <View style={styles.skeletonCard}>
      <View style={[styles.skeletonLine, { width: 100, height: 18 }]} />
      <View style={[styles.skeletonLine, { width: '80%', marginTop: 12 }]} />
      <View style={[styles.skeletonLine, { width: '95%', marginTop: 8 }]} />
      <View style={[styles.skeletonLine, { width: '60%', marginTop: 8 }]} />
      <View style={styles.skeletonFooter}>
        <View style={styles.skeletonAvatar} />
        <View style={[styles.skeletonLine, { width: 120, marginTop: 0 }]} />
      </View>
      <ActivityIndicator style={{ marginTop: 8, opacity: 0 }} />
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
  title: {
    fontSize: 32,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.6,
  },
  subtitle: {
    marginTop: 2,
    fontSize: 14,
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
    shadowColor: colors.accent,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.28,
    shadowRadius: 10,
    elevation: 6,
  },
  filterScroll: {
    flexGrow: 0,
    flexShrink: 0,
  },
  filterRow: {
    paddingHorizontal: 16,
    paddingBottom: 10,
    gap: 4,
    alignItems: 'center',
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.chip,
    marginRight: 8,
    alignSelf: 'center',
    flexGrow: 0,
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
    paddingHorizontal: 16,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 28,
    flexGrow: 1,
  },
  card: {
    borderRadius: 28,
    padding: 18,
    marginBottom: 14,
    backgroundColor: colors.surface,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 4,
  },
  badge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
    marginBottom: 12,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 6,
    letterSpacing: -0.2,
  },
  cardDescription: {
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 20,
    marginBottom: 14,
  },
  creatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 14,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  avatarPlaceholder: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.successSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.success,
  },
  creatorName: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  metaBlock: {
    gap: 8,
  },
  metaLine: {
    fontSize: 13,
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
    borderRadius: 24,
    padding: 14,
    marginBottom: 12,
    backgroundColor: colors.surfaceMuted,
  },
  skeletonLine: {
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.border,
  },
  skeletonFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 14,
  },
  skeletonAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.border,
  },
});
