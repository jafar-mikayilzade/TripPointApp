import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AddTravelHistoryModal } from '../../components/AddTravelHistoryModal';
import { AdminModerationModal } from '../../components/AdminModerationModal';
import {
  ListingDetailModal,
  type ListingWithCreator,
} from '../../components/ListingDetailModal';
import { PhoneField } from '../../components/PhoneField';
import { REGIONS } from '../../constants/regions';
import { deleteOwnAccount } from '../../lib/deleteAccount';
import { getErrorMessage } from '../../lib/errors';
import { ensureProfile } from '../../lib/ensureProfile';
import {
  formatAzPhoneE164,
  parseAzPhoneLocal,
  sanitizeFullNameInput,
  validateAzPhone,
  validateFullName,
} from '../../lib/formValidation';
import { signOutEverywhere } from '../../lib/googleAuth';
import { supabase } from '../../lib/supabase';
import { useIsAdmin } from '../../lib/useIsAdmin';
import {
  confirmDelete,
  deleteOwnRating,
  deleteTravelHistory,
} from '../../lib/userContentDelete';
import type {
  GuideTourHistory,
  Listing,
  ListingType,
  Profile,
  Rating,
  TravelHistory,
  UserRole,
} from '../../types/database';

type ProfileTab = 'travels' | 'listings' | 'reviews';

type TravelRow = TravelHistory & {
  poi_name: string | null;
};

type ReviewRow = Rating & {
  rater_name: string | null;
};

const ROLE_META: Record<UserRole, { label: string; color: string }> = {
  user: { label: 'Səyahətçi', color: '#6B7280' },
  guide: { label: 'Tur Bələdçisi', color: '#16A34A' },
  business_owner: { label: 'Biznes Sahibi', color: '#2563EB' },
  local_provider: { label: 'Yerli Xidmət', color: '#FF6B35' },
  admin: { label: 'Admin', color: '#DC2626' },
};

const TYPE_META: Record<ListingType, { label: string; emoji: string; color: string }> = {
  carpool: { label: 'Carpool', emoji: '🚗', color: '#2196F3' },
  tour: { label: 'Tur', emoji: '🗺', color: '#4CAF50' },
  local_service: { label: 'Yerli xidmət', emoji: '🏔', color: '#FF6B35' },
};

const TABS: { id: ProfileTab; label: string }[] = [
  { id: 'travels', label: 'Səyahətlər' },
  { id: 'listings', label: 'Elanlar' },
  { id: 'reviews', label: 'Rəylər' },
];

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
    year: 'numeric',
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

function normalizeParam(value: string | string[] | undefined): string | null {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  if (Array.isArray(value) && value[0]?.trim()) {
    return value[0].trim();
  }
  return null;
}

export default function ProfilScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ userId?: string | string[] }>();
  const paramUserId = normalizeParam(params.userId);

  const [authUserId, setAuthUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [ratingAvg, setRatingAvg] = useState(0);
  const [ratingCount, setRatingCount] = useState(0);
  const [travelCount, setTravelCount] = useState(0);
  const [listingCount, setListingCount] = useState(0);

  const [activeTab, setActiveTab] = useState<ProfileTab>('travels');
  const [travels, setTravels] = useState<TravelRow[]>([]);
  const [listings, setListings] = useState<ListingWithCreator[]>([]);
  const [reviews, setReviews] = useState<ReviewRow[]>([]);
  const [guideTours, setGuideTours] = useState<GuideTourHistory[]>([]);
  const [tabLoading, setTabLoading] = useState(false);

  const [editVisible, setEditVisible] = useState(false);
  const [editName, setEditName] = useState('');
  const [editBio, setEditBio] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [selectedTravel, setSelectedTravel] = useState<TravelRow | null>(null);
  const [selectedListing, setSelectedListing] = useState<ListingWithCreator | null>(null);
  const [listingDetailVisible, setListingDetailVisible] = useState(false);
  const [addTravelVisible, setAddTravelVisible] = useState(false);
  const [moderationVisible, setModerationVisible] = useState(false);
  const { isAdmin } = useIsAdmin();

  const profileUserId = paramUserId ?? authUserId;
  const isOwnProfile = !!authUserId && !!profileUserId && authUserId === profileUserId;

  const loadProfile = useCallback(async () => {
    setLoading(true);
    setErrorMessage(null);

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError) {
      setErrorMessage(getErrorMessage(userError));
      setLoading(false);
      return;
    }

    const currentAuthId = user?.id ?? null;
    setAuthUserId(currentAuthId);

    const targetId = paramUserId ?? currentAuthId;
    if (!targetId) {
      setErrorMessage('Profil tapılmadı.');
      setProfile(null);
      setLoading(false);
      return;
    }

    const { data: profileData, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', targetId)
      .maybeSingle();

    if (profileError) {
      setErrorMessage(getErrorMessage(profileError));
      setProfile(null);
      setLoading(false);
      return;
    }

    if (!profileData) {
      if (currentAuthId && targetId === currentAuthId) {
        const ensured = await ensureProfile(user);
        if (ensured.profile) {
          setProfile(ensured.profile);
        } else {
          setErrorMessage(
            ensured.error
              ? `Profil hazırlanmadı: ${ensured.error}`
              : 'Profil tapılmadı.'
          );
          setProfile(null);
          setLoading(false);
          return;
        }
      } else {
        setErrorMessage('Profil tapılmadı.');
        setProfile(null);
        setLoading(false);
        return;
      }
    } else {
      setProfile(profileData);
    }

    const [ratingsResult, travelsResult, listingsResult] = await Promise.all([
      supabase.from('ratings').select('score').eq('target_type', 'profile').eq('target_id', targetId),
      supabase.from('travel_history').select('id', { count: 'exact', head: true }).eq('user_id', targetId),
      supabase
        .from('listings')
        .select('id', { count: 'exact', head: true })
        .eq('created_by', targetId)
        .neq('status', 'cancelled'),
    ]);

    if (ratingsResult.error) {
      setErrorMessage(getErrorMessage(ratingsResult.error));
    } else {
      const scores = ratingsResult.data ?? [];
      setRatingCount(scores.length);
      setRatingAvg(
        scores.length > 0 ? scores.reduce((sum, row) => sum + row.score, 0) / scores.length : 0
      );
    }

    if (!travelsResult.error) {
      setTravelCount(travelsResult.count ?? 0);
    }
    if (!listingsResult.error) {
      setListingCount(listingsResult.count ?? 0);
    }

    setLoading(false);
  }, [paramUserId]);

  const loadTabData = useCallback(async () => {
    if (!profileUserId || !profile) {
      return;
    }

    setTabLoading(true);

    const own = !!authUserId && authUserId === profileUserId;

    if (activeTab === 'travels') {
      let query = supabase
        .from('travel_history')
        .select('*')
        .eq('user_id', profileUserId)
        .order('visited_at', { ascending: false });

      if (!own) {
        query = query.eq('privacy', 'public');
      }

      const { data, error } = await query;
      if (error) {
        setErrorMessage(getErrorMessage(error));
        setTravels([]);
        setTabLoading(false);
        return;
      }

      const rows = data ?? [];
      const poiIds = [...new Set(rows.map((row) => row.poi_id).filter(Boolean))] as string[];
      let poiMap = new Map<string, string>();

      if (poiIds.length > 0) {
        const { data: pois, error: poisError } = await supabase
          .from('pois')
          .select('id, name')
          .in('id', poiIds);

        if (poisError) {
          setErrorMessage(getErrorMessage(poisError));
        } else {
          poiMap = new Map((pois ?? []).map((poi) => [poi.id, poi.name]));
        }
      }

      setTravels(
        rows.map((row) => ({
          ...row,
          poi_name: row.poi_id ? (poiMap.get(row.poi_id) ?? null) : null,
        }))
      );
    }

    if (activeTab === 'listings') {
      const { data, error } = await supabase
        .from('listings')
        .select('*')
        .eq('created_by', profileUserId)
        .neq('status', 'cancelled')
        .order('created_at', { ascending: false });

      if (error) {
        setErrorMessage(getErrorMessage(error));
        setListings([]);
        setTabLoading(false);
        return;
      }

      setListings(
        (data ?? []).map((row) => ({
          ...row,
          creator: {
            id: profile.id,
            full_name: profile.full_name,
            avatar_url: profile.avatar_url,
            phone: profile.phone,
          },
        }))
      );
    }

    if (activeTab === 'reviews') {
      const { data, error } = await supabase
        .from('ratings')
        .select('*')
        .eq('target_type', 'profile')
        .eq('target_id', profileUserId)
        .order('created_at', { ascending: false });

      if (error) {
        setErrorMessage(getErrorMessage(error));
        setReviews([]);
        setTabLoading(false);
        return;
      }

      const rows = data ?? [];
      const raterIds = [...new Set(rows.map((row) => row.rater_id))];
      let nameMap = new Map<string, string | null>();

      if (raterIds.length > 0) {
        const { data: raters, error: ratersError } = await supabase
          .from('profiles')
          .select('id, full_name')
          .in('id', raterIds);

        if (ratersError) {
          setErrorMessage(getErrorMessage(ratersError));
        } else {
          nameMap = new Map((raters ?? []).map((rater) => [rater.id, rater.full_name]));
        }
      }

      setReviews(
        rows.map((row) => ({
          ...row,
          rater_name: nameMap.get(row.rater_id) ?? null,
        }))
      );
    }

    if (profile.role === 'guide') {
      const { data, error } = await supabase
        .from('guide_tour_history')
        .select('*')
        .eq('guide_id', profileUserId)
        .order('completed_at', { ascending: false });

      if (error) {
        // View mövcud olmaya bilər — ekranı bloklamırıq
        setGuideTours([]);
      } else {
        setGuideTours(data ?? []);
      }
    } else {
      setGuideTours([]);
    }

    setTabLoading(false);
  }, [activeTab, authUserId, profile, profileUserId]);

  useFocusEffect(
    useCallback(() => {
      loadProfile();
    }, [loadProfile])
  );

  useFocusEffect(
    useCallback(() => {
      if (profile) {
        loadTabData();
      }
    }, [loadTabData, profile])
  );

  const displayName = useMemo(
    () => profile?.full_name?.trim() || 'İstifadəçi',
    [profile?.full_name]
  );

  function openEditModal() {
    if (!profile) {
      return;
    }
    setEditName(profile.full_name ?? '');
    setEditBio(profile.bio ?? '');
    setEditPhone(parseAzPhoneLocal(profile.phone));
    setEditError(null);
    setEditVisible(true);
  }

  async function saveProfile() {
    if (!profile || !authUserId) {
      return;
    }

    const nameError = validateFullName(editName);
    if (nameError) {
      setEditError(nameError);
      return;
    }

    const phoneError = validateAzPhone(editPhone, false);
    if (phoneError) {
      setEditError(phoneError);
      return;
    }

    setSavingEdit(true);
    setEditError(null);

    const { error } = await supabase
      .from('profiles')
      .update({
        full_name: editName.trim() || null,
        bio: editBio.trim() || null,
        phone: formatAzPhoneE164(editPhone) || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', authUserId);

    setSavingEdit(false);

    if (error) {
      setEditError(getErrorMessage(error));
      return;
    }

    setEditVisible(false);
    await loadProfile();
  }

  async function handleSignOut() {
    Alert.alert('Çıxış', 'Hesabdan çıxmaq istəyirsiniz?', [
      { text: 'Ləğv et', style: 'cancel' },
      {
        text: 'Çıxış',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            const { error } = await signOutEverywhere();
            if (error) {
              setErrorMessage(getErrorMessage(error));
            }
          })();
        },
      },
    ]);
  }

  function handleDeleteAccount() {
    Alert.alert(
      'Hesabı sil',
      'Hesabınız və ona aid bütün məlumatlar (elanlar, səyahətlər, rəylər, şəxsi məlumatlar) həmişəlik silinəcək. Eyni email ilə yenidən qeydiyyatdan keçə bilərsiniz.',
      [
        { text: 'Ləğv et', style: 'cancel' },
        {
          text: 'Davam et',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              'Son təsdiq',
              'Hesabı silmək istədiyinizə əminsiniz? Bu əməliyyat geri qaytarıla bilməz.',
              [
                { text: 'Ləğv et', style: 'cancel' },
                {
                  text: 'Hesabı sil',
                  style: 'destructive',
                  onPress: () => {
                    void (async () => {
                      setDeletingAccount(true);
                      setErrorMessage(null);
                      const { error } = await deleteOwnAccount();
                      setDeletingAccount(false);
                      if (error) {
                        setErrorMessage(error);
                        return;
                      }
                      Alert.alert(
                        'Hesab silindi',
                        'Hesabınız tam silindi. Eyni email ilə yenidən qeydiyyatdan keçə bilərsiniz.',
                        [
                          {
                            text: 'OK',
                            onPress: () => router.replace('/auth/login'),
                          },
                        ]
                      );
                    })();
                  },
                },
              ]
            );
          },
        },
      ]
    );
  }

  async function openWhatsApp() {
    if (!profile?.phone) {
      return;
    }
    const phone = profile.phone.replace(/[^\d]/g, '');
    const text = encodeURIComponent(`Salam ${displayName}! TripPoint-dən yazıram.`);
    try {
      await Linking.openURL(`https://wa.me/${phone}?text=${text}`);
    } catch (err) {
      setErrorMessage(getErrorMessage(err));
    }
  }

  async function handleDeleteTravel(travelId: string) {
    const confirmed = await confirmDelete(
      'Səyahəti sil',
      'Bu səyahət qeydini silmək istədiyinizə əminsiniz?'
    );
    if (!confirmed) {
      return;
    }

    const { error } = await deleteTravelHistory(travelId);
    if (error) {
      setErrorMessage(error);
      return;
    }

    if (selectedTravel?.id === travelId) {
      setSelectedTravel(null);
    }
    await loadProfile();
    await loadTabData();
  }

  async function handleDeleteReview(reviewId: string) {
    const confirmed = await confirmDelete(
      'Rəyi sil',
      'Bu rəyi silmək istədiyinizə əminsiniz?'
    );
    if (!confirmed) {
      return;
    }

    const { error } = await deleteOwnRating({ id: reviewId });
    if (error) {
      setErrorMessage(error);
      return;
    }

    await loadProfile();
    await loadTabData();
  }

  if (loading) {
    return (
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 64 : 0}
      >
        <View style={[styles.centered, { paddingTop: insets.top }]}>
          <ActivityIndicator size="large" color="#2563EB" />
        </View>
      </KeyboardAvoidingView>
    );
  }

  if (!profile) {
    return (
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 64 : 0}
      >
        <View style={[styles.centered, { paddingTop: insets.top }]}>
          <Text style={styles.errorText}>{errorMessage ?? 'Profil tapılmadı.'}</Text>
          {paramUserId ? (
            <Pressable style={styles.secondaryButton} onPress={() => router.back()}>
              <Text style={styles.secondaryButtonText}>Geri</Text>
            </Pressable>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    );
  }

  const roleMeta = ROLE_META[profile.role] ?? ROLE_META.user;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 64 : 0}
    >
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        {paramUserId ? (
          <Pressable style={styles.backRow} onPress={() => router.back()} hitSlop={8}>
            <FontAwesome name="chevron-left" size={14} color="#2563EB" />
            <Text style={styles.backText}>Geri</Text>
          </Pressable>
        ) : null}

        <View style={styles.headerBlock}>
          {profile.avatar_url ? (
            <Image source={{ uri: profile.avatar_url }} style={styles.avatar} />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <Text style={styles.avatarInitial}>{displayName.charAt(0).toUpperCase()}</Text>
            </View>
          )}

          <Text style={styles.name}>{displayName}</Text>

          <View style={[styles.roleBadge, { backgroundColor: `${roleMeta.color}22` }]}>
            <Text style={[styles.roleBadgeText, { color: roleMeta.color }]}>{roleMeta.label}</Text>
          </View>

          <View style={styles.ratingRow}>
            <FontAwesome name="star" size={14} color="#F59E0B" />
            <Text style={styles.ratingText}>
              {ratingCount > 0
                ? `${ratingAvg.toFixed(1)} (${ratingCount} rəy)`
                : 'Reytinq yoxdur'}
            </Text>
          </View>

          {profile.bio?.trim() ? <Text style={styles.bio}>{profile.bio.trim()}</Text> : null}

          <View style={styles.statsRow}>
            <StatBox label="Səyahət" value={travelCount} />
            <StatBox label="Elan" value={listingCount} />
            <StatBox label="Rəy" value={ratingCount} />
          </View>

          {isOwnProfile ? (
            <View style={styles.actionColumn}>
              <View style={styles.actionRow}>
                <Pressable style={styles.primaryButton} onPress={openEditModal}>
                  <Text style={styles.primaryButtonText}>Profili Redaktə et</Text>
                </Pressable>
                <Pressable style={styles.dangerButton} onPress={handleSignOut}>
                  <Text style={styles.dangerButtonText}>Çıxış</Text>
                </Pressable>
              </View>
              <Pressable
                style={styles.splitBillButton}
                onPress={() => router.push('/split-bill' as never)}
              >
                <FontAwesome name="money" size={14} color="#fff" />
                <Text style={styles.splitBillButtonText}>Xərc Bölüşdürücü</Text>
              </Pressable>
              {isAdmin ? (
                <Pressable
                  style={styles.adminModButton}
                  onPress={() => setModerationVisible(true)}
                >
                  <FontAwesome name="shield" size={14} color="#fff" />
                  <Text style={styles.splitBillButtonText}>Admin nəzarəti</Text>
                </Pressable>
              ) : null}
              <Pressable
                style={[styles.deleteAccountButton, deletingAccount && styles.disabled]}
                onPress={handleDeleteAccount}
                disabled={deletingAccount}
              >
                {deletingAccount ? (
                  <ActivityIndicator color="#B91C1C" />
                ) : (
                  <Text style={styles.deleteAccountButtonText}>Hesabı sil</Text>
                )}
              </Pressable>
            </View>
          ) : profile.phone ? (
            <Pressable style={styles.whatsappButton} onPress={openWhatsApp}>
              <FontAwesome name="whatsapp" size={16} color="#fff" />
              <Text style={styles.whatsappButtonText}>WhatsApp-da Yaz</Text>
            </Pressable>
          ) : null}
        </View>

        {errorMessage ? <Text style={styles.errorBanner}>{errorMessage}</Text> : null}

        {profile.role === 'guide' && guideTours.length > 0 ? (
          <View style={styles.guideSection}>
            <Text style={styles.sectionTitle}>Tur Tarixçəsi</Text>
            {guideTours.map((tour) => (
              <View key={tour.listing_id} style={styles.guideCard}>
                <Text style={styles.cardTitle} numberOfLines={2} ellipsizeMode="tail">
                  {tour.title}
                </Text>
                <Text style={styles.metaLine}>
                  📅 {formatDate(tour.completed_at ?? tour.departure_at)}
                </Text>
                <Text style={styles.metaLine}>👥 {tour.participant_count} iştirakçı</Text>
                {tour.poi_names && tour.poi_names.length > 0 ? (
                  <Text style={styles.metaLine}>📍 {tour.poi_names.join(', ')}</Text>
                ) : null}
              </View>
            ))}
          </View>
        ) : null}

        <View style={styles.tabRow}>
          {TABS.map((tab) => {
            const selected = activeTab === tab.id;
            return (
              <Pressable
                key={tab.id}
                style={[styles.tabChip, selected && styles.tabChipSelected]}
                onPress={() => setActiveTab(tab.id)}
              >
                <Text style={[styles.tabText, selected && styles.tabTextSelected]}>{tab.label}</Text>
              </Pressable>
            );
          })}
        </View>

        {tabLoading ? (
          <ActivityIndicator color="#2563EB" style={{ marginTop: 24 }} />
        ) : (
          <View style={styles.tabContent}>
            {activeTab === 'travels' ? (
              <>
                {isOwnProfile ? (
                  <Pressable
                    style={styles.addTravelButton}
                    onPress={() => setAddTravelVisible(true)}
                  >
                    <FontAwesome name="plus" size={14} color="#fff" />
                    <Text style={styles.addTravelButtonText}>Səyahət əlavə et</Text>
                  </Pressable>
                ) : null}
                {travels.length === 0 ? (
                  <Text style={styles.emptyText}>Səyahət qeydi yoxdur</Text>
                ) : (
                  travels.map((item) => (
                    <Pressable
                      key={item.id}
                      style={styles.listCard}
                      onPress={() => setSelectedTravel(item)}
                    >
                      <Text style={styles.cardTitle} numberOfLines={2} ellipsizeMode="tail">
                        {item.title}
                      </Text>
                      <Text style={styles.metaLine}>📅 {formatDate(item.visited_at)}</Text>
                      {item.poi_name ? (
                        <Text style={styles.metaLine}>📍 {item.poi_name}</Text>
                      ) : null}
                      {isOwnProfile ? (
                        <Pressable
                          style={styles.deleteTextButton}
                          onPress={(event) => {
                            event.stopPropagation?.();
                            handleDeleteTravel(item.id);
                          }}
                          hitSlop={8}
                        >
                          <Text style={styles.deleteText}>Sil</Text>
                        </Pressable>
                      ) : null}
                    </Pressable>
                  ))
                )}
              </>
            ) : null}

            {activeTab === 'listings' ? (
              listings.length === 0 ? (
                <Text style={styles.emptyText}>Elan yoxdur</Text>
              ) : (
                listings.map((item) => (
                  <ProfileListingCard
                    key={item.id}
                    listing={item}
                    onPress={() => {
                      setSelectedListing(item);
                      setListingDetailVisible(true);
                    }}
                  />
                ))
              )
            ) : null}

            {activeTab === 'reviews' ? (
              reviews.length === 0 ? (
                <Text style={styles.emptyText}>Rəy yoxdur</Text>
              ) : (
                reviews.map((item) => (
                  <View key={item.id} style={styles.listCard}>
                    <View style={styles.starsRow}>
                      {Array.from({ length: 5 }, (_, index) => (
                        <FontAwesome
                          key={index}
                          name={index < item.score ? 'star' : 'star-o'}
                          size={14}
                          color="#F59E0B"
                        />
                      ))}
                    </View>
                    {item.comment?.trim() ? (
                      <Text style={styles.reviewComment}>{item.comment.trim()}</Text>
                    ) : null}
                    <Text style={styles.reviewAuthor}>
                      {item.rater_name?.trim() || 'İstifadəçi'}
                    </Text>
                    {authUserId && item.rater_id === authUserId ? (
                      <Pressable
                        style={styles.deleteTextButton}
                        onPress={() => handleDeleteReview(item.id)}
                        hitSlop={8}
                      >
                        <Text style={styles.deleteText}>Sil</Text>
                      </Pressable>
                    ) : null}
                  </View>
                ))
              )
            ) : null}
          </View>
        )}
      </ScrollView>

      <Modal visible={editVisible} transparent animationType="slide" onRequestClose={() => setEditVisible(false)}>
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Profili redaktə et</Text>
            {editError ? <Text style={styles.errorBanner}>{editError}</Text> : null}

            <Text style={styles.fieldLabel}>Ad</Text>
            <TextInput
              style={styles.input}
              value={editName}
              onChangeText={(text) => setEditName(sanitizeFullNameInput(text))}
              placeholder="Ad Soyad"
              placeholderTextColor="#9CA3AF"
            />

            <Text style={styles.fieldLabel}>Bio</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              value={editBio}
              onChangeText={setEditBio}
              placeholder="Haqqında..."
              placeholderTextColor="#9CA3AF"
              multiline
              textAlignVertical="top"
            />

            <PhoneField
              label="Telefon"
              value={editPhone}
              onChangeLocal={setEditPhone}
            />

            <View style={styles.modalActions}>
              <Pressable
                style={styles.secondaryButton}
                onPress={() => setEditVisible(false)}
                disabled={savingEdit}
              >
                <Text style={styles.secondaryButtonText}>Ləğv et</Text>
              </Pressable>
              <Pressable
                style={[styles.primaryButton, savingEdit && styles.disabled]}
                onPress={saveProfile}
                disabled={savingEdit}
              >
                {savingEdit ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.primaryButtonText}>Yadda saxla</Text>
                )}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={!!selectedTravel}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedTravel(null)}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>{selectedTravel?.title}</Text>
            <Text style={styles.metaLine}>📅 {formatDate(selectedTravel?.visited_at ?? null)}</Text>
            {selectedTravel?.poi_name ? (
              <Text style={styles.metaLine}>📍 {selectedTravel.poi_name}</Text>
            ) : null}
            {selectedTravel?.notes?.trim() ? (
              <Text style={styles.bio}>{selectedTravel.notes.trim()}</Text>
            ) : (
              <Text style={styles.emptyText}>Əlavə təsvir yoxdur</Text>
            )}
            {isOwnProfile && selectedTravel ? (
              <Pressable
                style={styles.deleteOutlineButton}
                onPress={() => handleDeleteTravel(selectedTravel.id)}
                hitSlop={8}
              >
                <Text style={styles.deleteOutlineButtonText}>Səyahəti sil</Text>
              </Pressable>
            ) : null}
            <Pressable style={styles.modalCloseButton} onPress={() => setSelectedTravel(null)}>
              <Text style={styles.modalCloseButtonText}>Bağla</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <ListingDetailModal
        listing={selectedListing}
        visible={listingDetailVisible}
        onClose={() => {
          setListingDetailVisible(false);
          setSelectedListing(null);
        }}
        onDeleted={() => {
          setListingDetailVisible(false);
          setSelectedListing(null);
          loadProfile();
          loadTabData();
        }}
      />

      <AdminModerationModal
        visible={moderationVisible}
        onClose={() => setModerationVisible(false)}
      />

      <AddTravelHistoryModal
        visible={addTravelVisible}
        onClose={() => setAddTravelVisible(false)}
        onCreated={() => {
          loadProfile();
          loadTabData();
        }}
      />
    </View>
    </KeyboardAvoidingView>
  );
}

function StatBox({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.statBox}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function ProfileListingCard({
  listing,
  onPress,
}: {
  listing: ListingWithCreator;
  onPress: () => void;
}) {
  const meta = TYPE_META[listing.type];
  const creatorName = listing.creator?.full_name?.trim() || 'İstifadəçi';

  return (
    <Pressable style={styles.listCard} onPress={onPress}>
      <View style={[styles.typeBadge, { backgroundColor: `${meta.color}22` }]}>
        <Text style={[styles.typeBadgeText, { color: meta.color }]}>
          {meta.emoji} {meta.label}
        </Text>
      </View>
      <Text style={styles.cardTitle} numberOfLines={2}>
        {listing.title}
      </Text>
      <Text style={styles.cardDescription} numberOfLines={2}>
        {listing.description?.trim() || 'Təsvir yoxdur'}
      </Text>
      <Text style={styles.metaLine}>{creatorName}</Text>
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
        </>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    paddingHorizontal: 24,
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 32,
  },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    marginBottom: 4,
  },
  backText: {
    color: '#2563EB',
    fontWeight: '600',
  },
  headerBlock: {
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 8,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
  },
  avatarPlaceholder: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#E5E7EB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontSize: 28,
    fontWeight: '700',
    color: '#374151',
  },
  name: {
    marginTop: 12,
    fontSize: 24,
    fontWeight: '800',
    color: '#111827',
  },
  roleBadge: {
    marginTop: 8,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  roleBadgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
  },
  ratingText: {
    fontSize: 13,
    color: '#4B5563',
    fontWeight: '600',
  },
  bio: {
    marginTop: 10,
    fontSize: 14,
    color: '#4B5563',
    textAlign: 'center',
    lineHeight: 20,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
    width: '100%',
  },
  statBox: {
    flex: 1,
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 18,
    fontWeight: '800',
    color: '#111827',
  },
  statLabel: {
    marginTop: 2,
    fontSize: 12,
    color: '#6B7280',
    fontWeight: '600',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
  },
  actionColumn: {
    width: '100%',
    marginTop: 16,
    gap: 10,
  },
  splitBillButton: {
    width: '100%',
    backgroundColor: '#0F766E',
    borderRadius: 10,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  adminModButton: {
    width: '100%',
    backgroundColor: '#7C3AED',
    borderRadius: 10,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  splitBillButtonText: {
    color: '#fff',
    fontWeight: '700',
  },
  primaryButton: {
    flex: 1,
    backgroundColor: '#2563EB',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#fff',
    fontWeight: '700',
  },
  dangerButton: {
    flex: 1,
    backgroundColor: '#FEE2E2',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  dangerButtonText: {
    color: '#B91C1C',
    fontWeight: '700',
  },
  deleteAccountButton: {
    width: '100%',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: '#FFF7F7',
  },
  deleteAccountButtonText: {
    color: '#B91C1C',
    fontWeight: '700',
  },
  whatsappButton: {
    marginTop: 16,
    width: '100%',
    backgroundColor: '#25D366',
    borderRadius: 10,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  whatsappButtonText: {
    color: '#fff',
    fontWeight: '700',
  },
  secondaryButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#374151',
    fontWeight: '700',
  },
  disabled: {
    opacity: 0.6,
  },
  errorText: {
    color: '#B91C1C',
    textAlign: 'center',
    marginBottom: 12,
  },
  errorBanner: {
    backgroundColor: '#FEE2E2',
    color: '#B91C1C',
    borderRadius: 8,
    padding: 10,
    marginTop: 10,
    fontSize: 13,
  },
  guideSection: {
    marginTop: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 8,
  },
  guideCard: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    backgroundColor: '#F0FDF4',
  },
  tabRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 18,
  },
  tabChip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
  },
  tabChipSelected: {
    backgroundColor: '#111827',
  },
  tabText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#374151',
  },
  tabTextSelected: {
    color: '#fff',
  },
  tabContent: {
    marginTop: 14,
  },
  addTravelButton: {
    backgroundColor: '#2563EB',
    borderRadius: 10,
    paddingVertical: 12,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  addTravelButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  listCard: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    backgroundColor: '#fff',
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 4,
  },
  cardDescription: {
    fontSize: 13,
    color: '#6B7280',
    marginBottom: 6,
  },
  metaLine: {
    fontSize: 12,
    color: '#4B5563',
    marginTop: 2,
  },
  emptyText: {
    textAlign: 'center',
    color: '#9CA3AF',
    marginTop: 24,
    fontSize: 14,
  },
  typeBadge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginBottom: 8,
  },
  typeBadgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  starsRow: {
    flexDirection: 'row',
    gap: 3,
    marginBottom: 6,
  },
  reviewComment: {
    fontSize: 14,
    color: '#111827',
    lineHeight: 20,
  },
  reviewAuthor: {
    marginTop: 8,
    fontSize: 12,
    color: '#6B7280',
    fontWeight: '600',
  },
  deleteTextButton: {
    alignSelf: 'flex-start',
    marginTop: 8,
    paddingVertical: 4,
  },
  deleteText: {
    color: '#DC2626',
    fontWeight: '700',
    fontSize: 13,
  },
  deleteOutlineButton: {
    marginTop: 16,
    width: '100%',
    borderWidth: 1,
    borderColor: '#FECACA',
    backgroundColor: '#FEF2F2',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  deleteOutlineButtonText: {
    color: '#DC2626',
    fontWeight: '700',
    fontSize: 15,
  },
  modalCloseButton: {
    marginTop: 10,
    width: '100%',
    backgroundColor: '#2563EB',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  modalCloseButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 16,
    paddingBottom: 80,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 10,
  },
  fieldLabel: {
    marginTop: 10,
    marginBottom: 6,
    fontSize: 13,
    fontWeight: '700',
    color: '#374151',
  },
  input: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 15,
    color: '#111827',
  },
  textArea: {
    minHeight: 90,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
    marginBottom: 20,
  },
});
