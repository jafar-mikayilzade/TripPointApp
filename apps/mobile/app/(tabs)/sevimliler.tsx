import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  ListingDetailModal,
  type ListingWithCreator,
} from '../../components/ListingDetailModal';
import { ProfileCornerButton } from '../../components/ProfileCornerButton';
import { REGIONS } from '../../constants/regions';
import { getErrorMessage } from '../../lib/errors';
import {
  listFavoriteListingIdsOrdered,
  listFavoritePoiIdsOrdered,
} from '../../lib/favorites';
import { getCategoryEmoji, getCategoryLabel } from '../../lib/categoryUtils';
import { supabase } from '../../lib/supabase';
import type { Listing, ListingType, Poi, Profile } from '../../types/database';

import { colors, radii, shadows, space } from '../../constants/theme';

type TabId = 'listings' | 'pois';

const LISTING_TYPE_META: Record<ListingType, { label: string; tint: string; soft: string }> = {
  carpool: { label: 'Carpool', tint: colors.accent, soft: colors.accentSoft },
  tour: { label: 'Tur', tint: colors.success, soft: colors.successSoft },
  local_service: { label: 'Yerli xidmət', tint: colors.warning, soft: colors.warningSoft },
};

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

export default function SevimlilerScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

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

    try {
      const [listingIds, poiIds] = await Promise.all([
        listFavoriteListingIdsOrdered(),
        listFavoritePoiIdsOrdered(),
      ]);

      if (listingIds.length === 0) {
        setListings([]);
      } else {
        const { data, error } = await supabase
          .from('listings')
          .select('*')
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
          .select('id, full_name, avatar_url, phone')
          .in('id', creatorIds);

        const profileMap = new Map(
          (profiles ?? []).map((p) => [
            p.id,
            p as Pick<Profile, 'id' | 'full_name' | 'avatar_url' | 'phone'>,
          ])
        );

        setListings(
          rows.map((row) => ({
            ...row,
            creator: profileMap.get(row.created_by) ?? null,
          }))
        );
      }

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
      setErrorMessage(getErrorMessage(err));
      setListings([]);
      setPois([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View style={styles.titleBlock}>
          <Text style={styles.title}>sevimlilər</Text>
          <Text style={styles.subtitle}>Bookmark etdikləriniz</Text>
        </View>
        <ProfileCornerButton />
      </View>

      <View style={styles.tabRow}>
        <Pressable
          style={[styles.tabChip, tab === 'listings' && styles.tabChipSelected]}
          onPress={() => setTab('listings')}
        >
          <Text style={[styles.tabText, tab === 'listings' && styles.tabTextSelected]}>
            Elanlar ({listings.length})
          </Text>
        </Pressable>
        <Pressable
          style={[styles.tabChip, tab === 'pois' && styles.tabChipSelected]}
          onPress={() => setTab('pois')}
        >
          <Text style={[styles.tabText, tab === 'pois' && styles.tabTextSelected]}>
            Yerlər ({pois.length})
          </Text>
        </Pressable>
      </View>

      {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : tab === 'listings' ? (
        <FlatList
          data={listings}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          refreshing={loading}
          onRefresh={() => void load()}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <FontAwesome name="bookmark-o" size={28} color={colors.textMuted} />
              <Text style={styles.emptyTitle}>Sevimli elan yoxdur</Text>
              <Text style={styles.emptySubtitle}>
                İcma elanında sarı bookmark ilə əlavə edin
              </Text>
            </View>
          }
          renderItem={({ item }) => {
            const meta = LISTING_TYPE_META[item.type];
            return (
              <Pressable
                style={styles.card}
                onPress={() => {
                  setSelectedListing(item);
                  setDetailVisible(true);
                }}
              >
                <View style={styles.cardTop}>
                  <View style={[styles.badge, { backgroundColor: meta.soft }]}>
                    <Text style={[styles.badgeText, { color: meta.tint }]}>{meta.label}</Text>
                  </View>
                  <Text style={styles.price}>{formatPrice(item)}</Text>
                </View>
                <Text style={styles.cardTitle} numberOfLines={2}>
                  {item.title}
                </Text>
              </Pressable>
            );
          }}
        />
      ) : (
        <FlatList
          data={pois}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          refreshing={loading}
          onRefresh={() => void load()}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <FontAwesome name="bookmark-o" size={28} color={colors.textMuted} />
              <Text style={styles.emptyTitle}>Sevimli yer yoxdur</Text>
              <Text style={styles.emptySubtitle}>
                Ana səhifədə məkana baxıb bookmark edin
              </Text>
            </View>
          }
          renderItem={({ item }) => {
            const regionLabel =
              REGIONS.find((r) => r.id === item.region)?.label ?? item.region;
            return (
              <Pressable
                style={styles.card}
                onPress={() => router.push('/(tabs)' as never)}
              >
                <Text style={styles.cardTitle} numberOfLines={1}>
                  {getCategoryEmoji(item.category)} {item.name}
                </Text>
                <Text style={styles.poiMeta} numberOfLines={1}>
                  {getCategoryLabel(item.category)} · {regionLabel}
                  {typeof item.rating === 'number' && item.rating > 0
                    ? ` · ★ ${item.rating.toFixed(1)}`
                    : ''}
                </Text>
              </Pressable>
            );
          }}
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
  tabRow: {
    flexDirection: 'row',
    paddingHorizontal: space.lg,
    gap: 8,
    marginBottom: 10,
  },
  tabChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radii.pill,
    backgroundColor: colors.chip,
  },
  tabChipSelected: {
    backgroundColor: colors.chipSelected,
  },
  tabText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.chipText,
  },
  tabTextSelected: {
    color: colors.textOnAccent,
  },
  listContent: {
    paddingHorizontal: space.lg,
    paddingBottom: 28,
    flexGrow: 1,
  },
  card: {
    borderRadius: radii.lg,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 8,
    backgroundColor: colors.surface,
    ...shadows.card,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
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
  price: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  poiMeta: {
    marginTop: 4,
    fontSize: 13,
    color: colors.textSecondary,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 64,
    paddingHorizontal: 24,
    gap: 10,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  emptySubtitle: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textMuted,
    textAlign: 'center',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorText: {
    marginHorizontal: 16,
    marginBottom: 8,
    color: colors.dangerText,
    fontSize: 13,
  },
});
