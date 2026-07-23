import FontAwesome from '@expo/vector-icons/FontAwesome';
import * as ImagePicker from 'expo-image-picker';
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
import { colors } from '../../constants/theme';
import { deleteOwnAccount } from '../../lib/deleteAccount';
import { getErrorMessage } from '../../lib/errors';
import { ensureProfile } from '../../lib/ensureProfile';
import {
  TEXT_FORMAT_ERROR,
  formatAzPhoneE164,
  hasDisallowedTextSymbols,
  parseAzPhoneLocal,
  sanitizeFullNameInput,
  sanitizeFreeTextWordPatterns,
  validateAzPhone,
  validateFullName,
  validateTextWordPatterns,
} from '../../lib/formValidation';
import { signOutEverywhere } from '../../lib/googleAuth';
import { startTelegramLink } from '../../lib/telegramLink';
import { supabase } from '../../lib/supabase';
import { uploadImage } from '../../lib/uploadImage';
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

const AVATAR_BUCKET = 'avatars';

type ProfileTab = 'travels' | 'listings' | 'reviews';

type TravelRow = TravelHistory & {
  poi_name: string | null;
};

type ReviewRow = Rating & {
  rater_name: string | null;
};

const ROLE_META: Record<UserRole, { label: string; color: string }> = {
  user: { label: 'Səyahətçi', color: colors.textSecondary },
  guide: { label: 'Tur Bələdçisi', color: colors.success },
  business_owner: { label: 'Biznes Sahibi', color: colors.accent },
  local_provider: { label: 'Yerli Xidmət', color: colors.warning },
  admin: { label: 'Admin', color: colors.danger },
};

const TYPE_META: Record<ListingType, { label: string; tint: string; soft: string }> = {
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
  const [editNameError, setEditNameError] = useState<string | null>(null);
  const [editPhoneError, setEditPhoneError] = useState<string | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
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
    setEditNameError(null);
    setEditPhoneError(null);
    setEditError(null);
    setEditVisible(true);
  }

  async function handlePickAvatar() {
    if (!authUserId || !isOwnProfile || uploadingAvatar) {
      return;
    }

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('İcazə lazımdır', 'Profil şəkli üçün qalereya icazəsi verin.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.85,
      allowsEditing: true,
      aspect: [1, 1],
    });

    if (result.canceled || !result.assets[0]?.uri) {
      return;
    }

    setUploadingAvatar(true);
    setErrorMessage(null);

    try {
      const uri = result.assets[0].uri;
      const extension = uri.split('.').pop()?.split('?')[0]?.toLowerCase() ?? 'jpg';
      const safeExt =
        extension === 'png' || extension === 'webp' || extension === 'jpeg' || extension === 'jpg'
          ? extension
          : 'jpg';
      const path = `${authUserId}/avatar.${safeExt}`;
      const publicUrl = await uploadImage(uri, AVATAR_BUCKET, path);
      const avatarUrl = `${publicUrl}?t=${Date.now()}`;

      const { error } = await supabase
        .from('profiles')
        .update({
          avatar_url: avatarUrl,
          updated_at: new Date().toISOString(),
        })
        .eq('id', authUserId);

      if (error) {
        setErrorMessage(getErrorMessage(error));
        return;
      }

      setProfile((prev) => (prev ? { ...prev, avatar_url: avatarUrl } : prev));
    } catch (err) {
      setErrorMessage(getErrorMessage(err));
    } finally {
      setUploadingAvatar(false);
    }
  }

  async function saveProfile() {
    if (!profile || !authUserId) {
      return;
    }

    const nameError = validateFullName(editName);
    if (nameError) {
      setEditNameError(nameError);
      setEditError(nameError);
      return;
    }

    const phoneError = validateAzPhone(editPhone, false);
    if (phoneError) {
      setEditPhoneError(phoneError);
      setEditError(phoneError);
      if (editPhone.trim()) {
        setEditPhone('');
      }
      return;
    }

    setSavingEdit(true);
    setEditError(null);
    setEditNameError(null);
    setEditPhoneError(null);

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
          <ActivityIndicator size="large" color={colors.accent} />
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
            <FontAwesome name="chevron-left" size={12} color={colors.accent} />
            <Text style={styles.backText}>Geri</Text>
          </Pressable>
        ) : null}

        <View style={styles.pageHeader}>
          <View style={styles.titleBlock}>
            <Text style={styles.pageTitle}>profil</Text>
            <Text style={styles.pageSubtitle}>
              {isOwnProfile ? 'Hesab və tarixçə' : 'İstifadəçi profili'}
            </Text>
          </View>
        </View>

        <View style={styles.headerBlock}>
          {isOwnProfile ? (
            <Pressable
              style={styles.avatarPressable}
              onPress={() => void handlePickAvatar()}
              disabled={uploadingAvatar}
              accessibilityLabel="Profil şəkli əlavə et"
            >
              {profile.avatar_url ? (
                <Image source={{ uri: profile.avatar_url }} style={styles.avatar} />
              ) : (
                <View style={styles.avatarPlaceholder}>
                  <Text style={styles.avatarInitial}>{displayName.charAt(0).toUpperCase()}</Text>
                </View>
              )}
              <View style={styles.avatarBadge}>
                {uploadingAvatar ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <FontAwesome name="camera" size={12} color="#fff" />
                )}
              </View>
            </Pressable>
          ) : profile.avatar_url ? (
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
            <FontAwesome name="star" size={14} color={colors.warning} />
            <Text style={styles.ratingText}>
              {ratingCount > 0
                ? `${ratingAvg.toFixed(1)} (${ratingCount} rəy)`
                : 'Reytinq yoxdur'}
            </Text>
          </View>

          {profile.bio?.trim() ? <Text style={styles.bio}>{profile.bio.trim()}</Text> : null}

          <View style={styles.statsRow}>
            <StatBox
              label="Səyahət"
              value={travelCount}
              selected={activeTab === 'travels'}
              onPress={() => setActiveTab('travels')}
            />
            <StatBox
              label="Elan"
              value={listingCount}
              selected={activeTab === 'listings'}
              onPress={() => setActiveTab('listings')}
            />
            <StatBox
              label="Rəy"
              value={ratingCount}
              selected={activeTab === 'reviews'}
              onPress={() => setActiveTab('reviews')}
            />
          </View>

          {isOwnProfile ? (
            <View style={styles.actionColumn}>
              <View style={styles.actionRow}>
                <Pressable style={styles.primaryButton} onPress={openEditModal}>
                  <Text style={styles.primaryButtonText} numberOfLines={1}>
                    Redaktə et
                  </Text>
                </Pressable>
                <Pressable
                  style={styles.splitBillButton}
                  onPress={() => router.push('/split-bill' as never)}
                >
                  <FontAwesome name="money" size={13} color="#fff" />
                  <Text style={styles.splitBillButtonText} numberOfLines={1}>
                    Xərc bölüşdürücü
                  </Text>
                </Pressable>
              </View>
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
                style={[
                  styles.telegramButton,
                  profile.telegram_chat_id ? styles.telegramButtonLinked : null,
                ]}
                onPress={() => {
                  void (async () => {
                    if (profile.telegram_chat_id) {
                      Alert.alert(
                        'Telegram bağlıdır',
                        'Yenidən bağlamaq üçün botda köhnə sessiya əvəzinə app-dən yenidən «Telegram bağla» aça bilərsiniz.',
                        [
                          { text: 'Bağla', style: 'cancel' },
                          {
                            text: 'Yenidən bağla',
                            onPress: () => {
                              void (async () => {
                                const result = await startTelegramLink();
                                if (result.error) {
                                  setErrorMessage(result.error);
                                }
                              })();
                            },
                          },
                        ]
                      );
                      return;
                    }
                    const result = await startTelegramLink();
                    if (result.error) {
                      setErrorMessage(result.error);
                    }
                  })();
                }}
              >
                <FontAwesome
                  name="telegram"
                  size={14}
                  color="#fff"
                />
                <Text style={styles.splitBillButtonText}>
                  {profile.telegram_chat_id ? 'Telegram bağlıdır' : 'Telegram bağla'}
                </Text>
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

        {tabLoading ? (
          <ActivityIndicator color={colors.accent} style={{ marginTop: 24 }} />
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
                          color={colors.warning}
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

        {isOwnProfile ? (
          <View style={styles.bottomActionRow}>
            <Pressable style={styles.dangerButton} onPress={handleSignOut}>
              <Text style={styles.dangerButtonText}>Çıxış</Text>
            </Pressable>
            <Pressable
              style={[styles.deleteAccountButton, deletingAccount && styles.disabled]}
              onPress={handleDeleteAccount}
              disabled={deletingAccount}
            >
              {deletingAccount ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.deleteAccountButtonText}>Hesabı sil</Text>
              )}
            </Pressable>
          </View>
        ) : null}
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
              style={[styles.input, editNameError ? styles.inputError : null]}
              value={editName}
              onChangeText={(text) => {
                const lettersOnly = text.replace(/[^\p{L}\s]/gu, '');
                const cleaned = sanitizeFullNameInput(text);
                if (hasDisallowedTextSymbols(text)) {
                  setEditNameError(TEXT_FORMAT_ERROR);
                } else if (cleaned.length < lettersOnly.length) {
                  setEditNameError(
                    validateTextWordPatterns(lettersOnly) ?? TEXT_FORMAT_ERROR
                  );
                } else {
                  setEditNameError(null);
                }
                setEditName(cleaned);
              }}
              onBlur={() => setEditNameError(validateFullName(editName))}
              placeholder="Ad Soyad"
              placeholderTextColor={colors.textMuted}
            />
            {editNameError ? <Text style={styles.fieldHintError}>{editNameError}</Text> : null}

            <Text style={styles.fieldLabel}>Bio</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              value={editBio}
              onChangeText={(text) => setEditBio(sanitizeFreeTextWordPatterns(text))}
              placeholder="Haqqında..."
              placeholderTextColor={colors.textMuted}
              multiline
              textAlignVertical="top"
            />

            <PhoneField
              label="Telefon"
              value={editPhone}
              onChangeLocal={setEditPhone}
              error={editPhoneError}
              onValidationError={setEditPhoneError}
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

function StatBox({
  label,
  value,
  selected,
  onPress,
}: {
  label: string;
  value: number;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[styles.statBox, selected && styles.statBoxSelected]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
    >
      <Text style={[styles.statValue, selected && styles.statValueSelected]}>{value}</Text>
      <Text style={[styles.statLabel, selected && styles.statLabelSelected]}>{label}</Text>
    </Pressable>
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
      <View style={styles.cardTop}>
        <View style={[styles.typeBadge, { backgroundColor: meta.soft }]}>
          <Text style={[styles.typeBadgeText, { color: meta.tint }]}>{meta.label}</Text>
        </View>
        <Text style={styles.cardPrice} numberOfLines={1}>
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
          {listing.type === 'carpool'
            ? `${listing.origin_text || '—'} → ${listing.destination_text || '—'}`
            : getRegionLabel(listing.region)}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
    paddingHorizontal: 24,
  },
  content: {
    paddingHorizontal: 12,
    paddingBottom: 28,
  },
  pageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 2,
    paddingBottom: 8,
  },
  titleBlock: {
    flex: 1,
    minWidth: 0,
  },
  pageTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.4,
    textTransform: 'lowercase',
  },
  pageSubtitle: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: '500',
    color: colors.textMuted,
  },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
    marginBottom: 4,
  },
  backText: {
    color: colors.accent,
    fontWeight: '600',
    fontSize: 13,
  },
  headerBlock: {
    alignItems: 'center',
    paddingTop: 4,
    paddingBottom: 8,
  },
  avatarPressable: {
    position: 'relative',
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 18,
    backgroundColor: colors.chip,
  },
  avatarPlaceholder: {
    width: 72,
    height: 72,
    borderRadius: 18,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 26,
    height: 26,
    borderRadius: 10,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.bg,
  },
  avatarInitial: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.accent,
  },
  name: {
    marginTop: 10,
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.3,
  },
  roleBadge: {
    marginTop: 6,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  roleBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 6,
  },
  ratingText: {
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: '600',
  },
  bio: {
    marginTop: 8,
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 18,
    paddingHorizontal: 8,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 12,
    width: '100%',
  },
  statBox: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSoft,
  },
  statBoxSelected: {
    backgroundColor: colors.chipSelected,
    borderColor: colors.chipSelected,
  },
  statValue: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  statValueSelected: {
    color: colors.textOnAccent,
  },
  statLabel: {
    marginTop: 2,
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: '600',
  },
  statLabelSelected: {
    color: colors.textOnAccent,
  },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    width: '100%',
  },
  actionColumn: {
    width: '100%',
    marginTop: 12,
    gap: 8,
  },
  bottomActionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    width: '100%',
    marginTop: 16,
    marginBottom: 8,
  },
  splitBillButton: {
    flexGrow: 1,
    flexBasis: '47%',
    minWidth: 0,
    maxWidth: '100%',
    backgroundColor: colors.accent,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  adminModButton: {
    width: '100%',
    backgroundColor: colors.accent,
    borderRadius: 10,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  telegramButton: {
    width: '100%',
    backgroundColor: '#229ED9',
    borderRadius: 10,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  telegramButtonLinked: {
    backgroundColor: '#1a7aa8',
  },
  primaryButton: {
    flexGrow: 1,
    flexBasis: '47%',
    minWidth: 0,
    maxWidth: '100%',
    backgroundColor: colors.accent,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  primaryButtonText: {
    color: colors.textOnAccent,
    fontWeight: '700',
    fontSize: 12,
    flexShrink: 1,
    textAlign: 'center',
  },
  splitBillButtonText: {
    color: colors.textOnAccent,
    fontWeight: '700',
    fontSize: 12,
    flexShrink: 1,
  },
  dangerButton: {
    flex: 1,
    backgroundColor: colors.dangerSoft,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  dangerButtonText: {
    color: colors.dangerText,
    fontWeight: '700',
    fontSize: 12,
  },
  deleteAccountButton: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: colors.danger,
  },
  deleteAccountButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 12,
  },
  whatsappButton: {
    marginTop: 12,
    width: '100%',
    backgroundColor: colors.whatsapp,
    borderRadius: 10,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  whatsappButtonText: {
    color: colors.textOnAccent,
    fontWeight: '700',
    fontSize: 13,
  },
  secondaryButton: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSoft,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  secondaryButtonText: {
    color: colors.chipText,
    fontWeight: '700',
    fontSize: 12,
  },
  disabled: {
    opacity: 0.6,
  },
  errorText: {
    color: colors.dangerText,
    textAlign: 'center',
    marginBottom: 12,
    fontSize: 13,
  },
  errorBanner: {
    backgroundColor: colors.dangerSoft,
    color: colors.dangerText,
    borderRadius: 10,
    padding: 8,
    marginTop: 8,
    fontSize: 12,
  },
  guideSection: {
    marginTop: 12,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 6,
  },
  guideCard: {
    borderRadius: 12,
    padding: 10,
    marginBottom: 4,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSoft,
  },
  tabContent: {
    marginTop: 12,
  },
  addTravelButton: {
    backgroundColor: colors.accent,
    borderRadius: 10,
    paddingVertical: 10,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  addTravelButtonText: {
    color: colors.textOnAccent,
    fontWeight: '700',
    fontSize: 13,
  },
  listCard: {
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginBottom: 4,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSoft,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 3,
  },
  cardPrice: {
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
  cardDescription: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: 4,
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
    flexShrink: 1,
    maxWidth: '55%',
    fontSize: 11,
    fontWeight: '600',
    color: colors.textMuted,
    textAlign: 'right',
  },
  metaLine: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
  },
  emptyText: {
    textAlign: 'center',
    color: colors.textMuted,
    marginTop: 20,
    fontSize: 13,
  },
  typeBadge: {
    alignSelf: 'flex-start',
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  typeBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  starsRow: {
    flexDirection: 'row',
    gap: 3,
    marginBottom: 4,
  },
  reviewComment: {
    fontSize: 13,
    color: colors.text,
    lineHeight: 18,
  },
  reviewAuthor: {
    marginTop: 6,
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: '600',
  },
  deleteTextButton: {
    alignSelf: 'flex-start',
    marginTop: 6,
    paddingVertical: 2,
  },
  deleteText: {
    color: colors.danger,
    fontWeight: '700',
    fontSize: 12,
  },
  deleteOutlineButton: {
    marginTop: 12,
    width: '100%',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.danger,
    backgroundColor: colors.dangerSoft,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  deleteOutlineButtonText: {
    color: colors.dangerText,
    fontWeight: '700',
    fontSize: 13,
  },
  modalCloseButton: {
    marginTop: 10,
    width: '100%',
    backgroundColor: colors.accent,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  modalCloseButtonText: {
    color: colors.textOnAccent,
    fontWeight: '700',
    fontSize: 14,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 16,
    paddingBottom: 80,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 8,
  },
  fieldLabel: {
    marginTop: 8,
    marginBottom: 4,
    fontSize: 12,
    fontWeight: '600',
    color: colors.chipText,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSoft,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.text,
    backgroundColor: colors.bg,
  },
  inputError: {
    borderColor: colors.danger,
  },
  fieldHintError: {
    marginTop: 4,
    fontSize: 12,
    color: colors.danger,
    lineHeight: 16,
  },
  textArea: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  modalActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 14,
    marginBottom: 16,
  },
});
