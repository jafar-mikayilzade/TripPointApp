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

type ListingFilter = 'all' | ListingType;

const FILTERS: { id: ListingFilter; label: string }[] = [
  { id: 'all', label: 'Hamısı' },
  { id: 'tour', label: '🗺 Tur' },
  { id: 'local_service', label: '🏔 Yerli Xidmət' },
  { id: 'carpool', label: '🚗 Carpool' },
];

const TYPE_META: Record<ListingType, { label: string; emoji: string; color: string }> = {
  carpool: { label: 'Carpool', emoji: '🚗', color: '#2196F3' },
  tour: { label: 'Tur', emoji: '🗺', color: '#4CAF50' },
  local_service: { label: 'Yerli xidmət', emoji: '🏔', color: '#FF6B35' },
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
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 64 : 0}
    >
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.title}>İcma</Text>
        <Pressable style={styles.addButton} onPress={() => setCreateVisible(true)} hitSlop={8}>
          <FontAwesome name="plus" size={16} color="#fff" />
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
      <View style={[styles.badge, { backgroundColor: `${meta.color}22` }]}>
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
    backgroundColor: '#fff',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: '#111827',
  },
  addButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#2563EB',
    alignItems: 'center',
    justifyContent: 'center',
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
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#F3F4F6',
    marginRight: 4,
    alignSelf: 'center',
    flexGrow: 0,
  },
  filterChipSelected: {
    backgroundColor: '#111827',
  },
  filterText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#374151',
    lineHeight: 18,
  },
  filterTextSelected: {
    color: '#fff',
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
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    backgroundColor: '#fff',
  },
  badge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginBottom: 10,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 6,
  },
  cardDescription: {
    fontSize: 13,
    color: '#6B7280',
    lineHeight: 18,
    marginBottom: 12,
  },
  creatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
  },
  avatarPlaceholder: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#E5E7EB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontSize: 12,
    fontWeight: '700',
    color: '#374151',
  },
  creatorName: {
    fontSize: 13,
    fontWeight: '600',
    color: '#111827',
  },
  metaBlock: {
    gap: 4,
  },
  metaLine: {
    fontSize: 12,
    color: '#4B5563',
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
    color: '#6B7280',
    marginBottom: 14,
  },
  emptyButton: {
    backgroundColor: '#2563EB',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  emptyButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  errorText: {
    marginHorizontal: 16,
    marginBottom: 8,
    color: '#B91C1C',
    fontSize: 13,
  },
  skeletonCard: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    backgroundColor: '#F9FAFB',
  },
  skeletonLine: {
    height: 12,
    borderRadius: 6,
    backgroundColor: '#E5E7EB',
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
    backgroundColor: '#E5E7EB',
  },
});
