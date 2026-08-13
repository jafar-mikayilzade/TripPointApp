import * as Location from 'expo-location';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import MapView, {
  Marker,
  PROVIDER_GOOGLE,
  type PoiClickEvent,
  type Region as MapRegion,
} from '../../components/ClusteredAppMap';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AdminPoiCategoryModal } from '../../components/AdminPoiCategoryModal';
import { CategoryIcon } from '../../components/CategoryIcon';
import { MapClusterMarker } from '../../components/MapClusterMarker';
import {
  PoiMarkerBubble,
  shouldTrackMarkerViewChanges,
} from '../../components/PoiMapMarker';
import { FavoriteButton } from '../../components/FavoriteButton';
import { PoiPhotoGallery } from '../../components/PoiPhotoGallery';
import { HamburgerMenuButton } from '../../components/HamburgerMenuButton';
import { ResizableSplit } from '../../components/ResizableSplit';
import { useToast } from '../../components/Toast';
import { DEFAULT_REGION_ID, REGIONS } from '../../constants/regions';
import type { ThemeColors } from '../../constants/theme';
import { createStyles } from '../../styles/homeScreen.styles';
import { useThemeColors } from '../../theme/ThemeProvider';
import {
  insertApprovedPoiFromGoogle,
  updatePoiCoordinates,
  deletePoiAsAdmin,
  fetchGooglePlaceRating,
  type GoogleMapPoiPayload,
} from '../../lib/adminMap';
import { getCategoryLabel, type HomeCategoryFilterId } from '../../lib/categoryUtils';
import {
  displayPoiDescription,
  formatPoiPrice,
  translateAmenities,
} from '../../lib/poiDisplay';
import { getErrorMessage } from '../../lib/errors';
import { isPoiSponsored, summarizeOpeningHours } from '../../lib/openingHours';
import { comparePoisByRichness } from '../../lib/poiRichness';
import { collectPoiPhotoUrls } from '../../lib/photoUrls';
import {
  buildPoiTelUrl,
  buildPoiWebsiteUrl,
  buildPoiWhatsAppUrl,
  shouldShowPoiContact,
} from '../../lib/poiContact';
import {
  fetchRegionWeather,
  formatWeatherLabel,
  type WeatherAdvice,
} from '../../lib/weather';
import { isDatabasePoiId } from '../../lib/livePlaces';
import { supabase } from '../../lib/supabase';
import { useIsAdmin } from '../../lib/useIsAdmin';
import type { Poi, PoiCategory, PoiPhoto } from '../../types/database';

type PoiListItem = Poi & {
  photoUrl: string | null;
  photoUrls: string[];
  averageRating: number | null;
  ratingCount: number;
};

type PoiQueryRow = Poi & {
  poi_photos?: Pick<
    PoiPhoto,
    'photo_url' | 'thumb_url' | 'medium_url' | 'order_index' | 'created_at' | 'status'
  >[] | null;
};

const LOCATION_OPTIONS: { label: string; value: string | null }[] = [
  { label: '🗺️ Hamısı', value: null },
  ...REGIONS.map((r) => ({ label: `📍 ${r.label}`, value: r.id })),
];

const CATEGORY_OPTIONS: { label: string; value: string | null }[] = [
  { label: 'Hamısı', value: null },
  { label: 'Restoran', value: 'restaurant' },
  { label: 'Otel', value: 'hotel' },
  { label: 'Hostel', value: 'hostel' },
  { label: 'Ev restoranı', value: 'home_restaurant' },
  { label: 'Qonaq evi', value: 'guesthouse' },
  { label: 'Kemping', value: 'camping' },
  { label: 'Təbiət', value: 'nature' },
  { label: 'Şəlalə', value: 'waterfall' },
  { label: 'Dağ', value: 'mountain' },
  { label: 'Göl', value: 'lake' },
  { label: 'Tarixi', value: 'historical' },
  { label: 'Abidə', value: 'monument' },
  { label: 'Digər', value: 'other' },
];

function calculateDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): string {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const d = R * c;
  return d < 1 ? `${Math.round(d * 1000)}m` : `${d.toFixed(1)}km`;
}

export default function HomeScreen() {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const router = useRouter();
  const mapRef = useRef<{ animateToRegion: (region: MapRegion, duration?: number) => void } | null>(
    null
  );
  const listRef = useRef<FlatList<PoiListItem>>(null);
  const { isAdmin } = useIsAdmin();
  const { showToast, ToastHost } = useToast();

  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<HomeCategoryFilterId>('all');
  const [pois, setPois] = useState<PoiListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [highlightedPoiId, setHighlightedPoiId] = useState<string | null>(null);
  const [selectedPoi, setSelectedPoi] = useState<Poi | null>(null);
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const [pendingGooglePoi, setPendingGooglePoi] = useState<GoogleMapPoiPayload | null>(null);
  const [adminInsertLoading, setAdminInsertLoading] = useState(false);
  const [draggingPoiId, setDraggingPoiId] = useState<string | null>(null);
  const [userLocation, setUserLocation] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [regionWeather, setRegionWeather] = useState<WeatherAdvice | null>(null);
  const [splitRatio, setSplitRatio] = useState(0.5);
  const [listMode, setListMode] = useState<'list' | 'cards'>('list');
  const [listPaneWidth, setListPaneWidth] = useState(
    () => Dimensions.get('window').width
  );
  const splitBeforeFocusRef = useRef(0.5);
  /** Cari kamera — seçim dəyişəndə zoom-u saxlamaq üçün */
  const lastMapRegionRef = useRef<MapRegion | null>(null);
  const fetchPoisGen = useRef(0);
  /** Android custom marker — qısa pulse, daimi tracksViewChanges yox */
  const [tracksMarkers, setTracksMarkers] = useState(Platform.OS === 'android');

  const selectedCategory = categoryFilter === 'all' ? null : categoryFilter;
  const weatherLabel = formatWeatherLabel(regionWeather);
  const focusPoiId = selectedPoi?.id ?? highlightedPoiId;

  const selectedRegion = useMemo(
    () => (selectedRegionId ? REGIONS.find((region) => region.id === selectedRegionId) : null),
    [selectedRegionId]
  );

  const locationButtonLabel = selectedRegion?.label ?? 'Məkan';
  const categoryButtonLabel = selectedCategory
    ? getCategoryLabel(selectedCategory)
    : 'Kateqoriya';

  const mapRegion: MapRegion = useMemo(() => {
    if (selectedRegion) {
      return {
        latitude: selectedRegion.latitude,
        longitude: selectedRegion.longitude,
        latitudeDelta: selectedRegion.latitudeDelta,
        longitudeDelta: selectedRegion.longitudeDelta,
      };
    }
    if (userLocation) {
      return {
        latitude: userLocation.latitude,
        longitude: userLocation.longitude,
        latitudeDelta: 0.12,
        longitudeDelta: 0.12,
      };
    }
    const fallback = REGIONS.find((r) => r.id === DEFAULT_REGION_ID) ?? REGIONS[0];
    return {
      latitude: fallback.latitude,
      longitude: fallback.longitude,
      latitudeDelta: fallback.latitudeDelta,
      longitudeDelta: fallback.longitudeDelta,
    };
  }, [selectedRegion, userLocation]);

  const listTitle = useMemo(() => {
    if (!selectedRegionId && categoryFilter === 'all') {
      return 'Yaxınlıqda';
    }

    const locative = selectedRegionId
      ? (selectedRegion?.locative ?? selectedRegion?.label ?? '')
      : null;

    if (selectedRegionId && categoryFilter === 'all') {
      return `${locative} yerlər`;
    }

    if (selectedRegionId && selectedCategory) {
      return `${locative} · ${getCategoryLabel(selectedCategory)}`;
    }

    if (!selectedRegionId && selectedCategory) {
      return `Yaxınlıqda · ${getCategoryLabel(selectedCategory)}`;
    }

    return 'Yaxınlıqda';
  }, [selectedRegionId, categoryFilter, selectedRegion, selectedCategory]);

  const fetchPoisFromDb = useCallback(async (): Promise<PoiListItem[]> => {
    let query = supabase
      .from('pois')
      .select(
        `
          *,
          poi_photos (
            photo_url,
            thumb_url,
            medium_url,
            order_index,
            created_at,
            status
          )
        `
      )
      .eq('status', 'approved')
      .order('rating', { ascending: false, nullsFirst: false });

    if (selectedRegionId) {
      query = query.ilike('region', selectedRegionId);
    }

    if (categoryFilter && categoryFilter !== 'all') {
      query = query.eq('category', categoryFilter);
    }

    query = query.neq('category', 'cafe');

    const { data, error } = await query.limit(400);
    if (error) {
      throw error;
    }

    const rows = (data ?? []) as PoiQueryRow[];
    const mapped = rows.map((poi) => {
      const photos = [...(poi.poi_photos ?? [])].sort(
        (a, b) => a.order_index - b.order_index
      );
      const { poi_photos: _ignored, ...rest } = poi;
      const photoUrls = collectPoiPhotoUrls(rest, photos, 'thumb');
      return {
        ...rest,
        photoUrl: photoUrls[0] ?? null,
        photoUrls,
        averageRating:
          typeof rest.rating === 'number' && Number.isFinite(rest.rating)
            ? rest.rating
            : null,
        ratingCount:
          typeof rest.rating_count === 'number' && Number.isFinite(rest.rating_count)
            ? rest.rating_count
            : 0,
      };
    });

    mapped.sort((a, b) => {
      // Dağ zirvələrini axıra — digər kateqoriyalar əvvəl
      const mountainA = a.category === 'mountain' ? 1 : 0;
      const mountainB = b.category === 'mountain' ? 1 : 0;
      if (mountainA !== mountainB) {
        return mountainA - mountainB;
      }
      const sa = isPoiSponsored(a) ? 1 : 0;
      const sb = isPoiSponsored(b) ? 1 : 0;
      if (sb !== sa) {
        return sb - sa;
      }
      // Şəkil / qiymət / əlaqə / reytinq zənginliyi ilə
      return comparePoisByRichness(a, b);
    });

    return mapped;
  }, [selectedRegionId, categoryFilter]);

  const fetchPois = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent === true;
    const gen = ++fetchPoisGen.current;
    try {
      if (!silent) {
        setLoading(true);
        setErrorMessage(null);
      }

      // Always load from Supabase `pois` so SerpAPI price/amenities stay intact.
      const mapped = await fetchPoisFromDb();
      if (gen !== fetchPoisGen.current) {
        return;
      }
      if (__DEV__) {
        console.log('POI sayı (DB):', mapped.length);
      }
      setPois(mapped);
    } catch (err: unknown) {
      if (gen !== fetchPoisGen.current) {
        return;
      }
      if (__DEV__) {
        console.log('Catch xətası:', err);
      }
      if (!silent) {
        const message = err instanceof Error ? err.message : String(err);
        setErrorMessage('Xəta: ' + message);
      }
    } finally {
      if (gen === fetchPoisGen.current && !silent) {
        setLoading(false);
      }
    }
  }, [fetchPoisFromDb]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted' || cancelled) {
          return;
        }
        const position = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        if (cancelled) {
          return;
        }
        setUserLocation({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
      } catch {
        // İcazə/lokasiya alınmasa region seçimi ilə davam etmək olar
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    fetchPois();
  }, [fetchPois]);

  // Custom marker bitmap — qısa pulse (daimi Android tracksViewChanges CPU yeyir)
  useEffect(() => {
    setTracksMarkers(true);
    const t = setTimeout(() => setTracksMarkers(false), 700);
    return () => clearTimeout(t);
  }, [pois.length, selectedRegionId, categoryFilter, focusPoiId]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedRegionId) {
      setRegionWeather(null);
      return;
    }
    void fetchRegionWeather(selectedRegionId, 1).then((data) => {
      if (!cancelled) {
        setRegionWeather(data);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [selectedRegionId]);

  // Yalnız rayon dəyişəndə ümumi görüntü — seçimdən çıxanda buranı tetikləmə
  useEffect(() => {
    if (!selectedRegion) {
      return;
    }
    mapRef.current?.animateToRegion(
      {
        latitude: selectedRegion.latitude,
        longitude: selectedRegion.longitude,
        latitudeDelta: selectedRegion.latitudeDelta,
        longitudeDelta: selectedRegion.longitudeDelta,
      },
      400
    );
  }, [selectedRegion]);

  function handleSelectLocation(value: string | null) {
    setSelectedRegionId(value);
    setShowLocationPicker(false);
    setSelectedPoi(null);
    setHighlightedPoiId(null);
  }

  function handleSelectCategory(value: string | null) {
    setCategoryFilter(value ? (value as HomeCategoryFilterId) : 'all');
    setShowCategoryPicker(false);
    setSelectedPoi(null);
  }

  const goToCurrentLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();

      if (status !== 'granted') {
        Alert.alert('İcazə lazımdır', 'Lokasiya icazəsi verin.');
        return;
      }

      // MƏRHƏLƏ 1: Əvvəlcə son bilinən mövqeyi al
      // Bu, demək olar anında qaytarır
      const lastKnown = await Location.getLastKnownPositionAsync({
        maxAge: 60000, // 1 dəqiqəyə qədər köhnə ola bilər
        requiredAccuracy: 1000, // 1km dəqiqlik kifayətdir
      });

      if (lastKnown) {
        // Dərhal xəritəni köhnə mövqeyə apar
        const coords = {
          latitude: lastKnown.coords.latitude,
          longitude: lastKnown.coords.longitude,
        };
        setUserLocation(coords);
        mapRef.current?.animateToRegion(
          {
            ...coords,
            latitudeDelta: 0.02,
            longitudeDelta: 0.02,
          },
          500
        );
      }

      // MƏRHƏLƏ 2: Arxa planda dəqiq mövqeyi al
      // Timeout ilə — maksimum 5 saniyə gözlə
      const timeoutPromise = new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), 5000)
      );

      const locationPromise = Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Low,
      });

      const result = await Promise.race([locationPromise, timeoutPromise]);

      if (result) {
        const coords = {
          latitude: result.coords.latitude,
          longitude: result.coords.longitude,
        };
        setUserLocation(coords);
        mapRef.current?.animateToRegion(
          {
            ...coords,
            latitudeDelta: 0.02,
            longitudeDelta: 0.02,
          },
          500
        );
      }
    } catch (err) {
      // Xəta olsa səssizcə keç, istifadəçini narahat etmə
      if (__DEV__) {
        console.log('Lokasiya xətası:', err);
      }
    }
  };

  /** İlk siyahı seçimi — rahat yaxınlıq, ətrafdakılar da görünsün */
  function centerMapOnPoi(poi: { lat: number; lng: number }) {
    const next = {
      latitude: poi.lat,
      longitude: poi.lng,
      latitudeDelta: 0.02,
      longitudeDelta: 0.02,
    };
    lastMapRegionRef.current = next;
    mapRef.current?.animateToRegion(next, 320);
  }

  /** Zoom eyni qalsın — yalnız lazımdırsa mərkəzi sürüşdür */
  function ensurePoiVisibleKeepZoom(poi: { lat: number; lng: number }) {
    const current = lastMapRegionRef.current;
    if (!current) {
      centerMapOnPoi(poi);
      return;
    }

    const padLat = current.latitudeDelta * 0.28;
    const padLng = current.longitudeDelta * 0.28;
    const inView =
      poi.lat < current.latitude + current.latitudeDelta / 2 - padLat &&
      poi.lat > current.latitude - current.latitudeDelta / 2 + padLat &&
      poi.lng < current.longitude + current.longitudeDelta / 2 - padLng &&
      poi.lng > current.longitude - current.longitudeDelta / 2 + padLng;

    if (inView) {
      return;
    }

    const next = {
      latitude: poi.lat,
      longitude: poi.lng,
      latitudeDelta: current.latitudeDelta,
      longitudeDelta: current.longitudeDelta,
    };
    lastMapRegionRef.current = next;
    mapRef.current?.animateToRegion(next, 220);
  }

  function scrollListToPoi(poiId: string) {
    const index = pois.findIndex((p) => p.id === poiId);
    if (index < 0) return;
    requestAnimationFrame(() => {
      try {
        listRef.current?.scrollToIndex({
          index,
          animated: true,
          viewPosition: listMode === 'cards' ? 0 : 0.2,
        });
      } catch {
        // FlatList hələ layout olmayıbsa onScrollToIndexFailed işləyir
      }
    });
  }

  /**
   * map: kamera toxunulmur (pin artıq görünür).
   * list: ilk dəfə yumşaq yaxınlaş; növbəti seçimdə zoom saxlanılır.
   */
  function selectPoi(poi: Poi, source: 'map' | 'list') {
    const hadSelection = Boolean(selectedPoi);

    if (!hadSelection) {
      splitBeforeFocusRef.current = splitRatio;
    }

    setSelectedPoi(poi);
    setHighlightedPoiId(poi.id);
    scrollListToPoi(poi.id);

    if (source === 'list') {
      if (!hadSelection) {
        // Cluster içində gizlənməsin deyə seçilmiş pin ayrıca göstərilir + kamera
        requestAnimationFrame(() => centerMapOnPoi(poi));
      } else {
        ensurePoiVisibleKeepZoom(poi);
      }
    }
    // source === 'map' && hadSelection → yalnız highlight dəyişir

    // Yalnız ad/rating yenilə — kateqoriyanı Google ilə əvəz etmə
    const placeId = poi.place_id || (!isDatabasePoiId(poi.id) ? poi.id : null);
    if (!placeId) {
      return;
    }
    void fetchGooglePlaceRating(placeId).then((details) => {
      setSelectedPoi((current) => {
        if (!current || current.id !== poi.id) {
          return current;
        }
        return {
          ...current,
          name: details.name?.trim() || current.name,
          rating: details.rating ?? current.rating,
          rating_count: details.ratingCount ?? current.rating_count,
        };
      });
      setPois((current) =>
        current.map((row) => {
          if (row.id !== poi.id) {
            return row;
          }
          const rating = details.rating ?? row.rating;
          const ratingCount = details.ratingCount ?? row.rating_count;
          return {
            ...row,
            name: details.name?.trim() || row.name,
            rating,
            rating_count: ratingCount,
            averageRating:
              typeof rating === 'number' && Number.isFinite(rating) ? rating : row.averageRating,
            ratingCount:
              typeof ratingCount === 'number' && Number.isFinite(ratingCount)
                ? ratingCount
                : row.ratingCount,
          };
        })
      );
    });
  }

  function clearSelectedPoi() {
    setSelectedPoi(null);
    setHighlightedPoiId(null);
    setSplitRatio(splitBeforeFocusRef.current || 0.5);

    // Qismən geriyə — tam Quba overview-ə tullama (istifadəçi özü uzaqlaşdıra bilər)
    const current = lastMapRegionRef.current;
    const nextDelta = current
      ? Math.min(Math.max(current.latitudeDelta * 2.4, 0.04), 0.12)
      : 0.06;
    const centerLat = current?.latitude ?? selectedRegion?.latitude ?? mapRegion.latitude;
    const centerLng = current?.longitude ?? selectedRegion?.longitude ?? mapRegion.longitude;
    const target = {
      latitude: centerLat,
      longitude: centerLng,
      latitudeDelta: nextDelta,
      longitudeDelta: nextDelta,
    };

    lastMapRegionRef.current = target;
    requestAnimationFrame(() => {
      mapRef.current?.animateToRegion(target, 380);
    });
  }

  function handleMarkerPress(poi: PoiListItem) {
    if (selectedPoi?.id === poi.id) {
      clearSelectedPoi();
      return;
    }
    selectPoi(poi, 'map');
  }

  function handleCardPress(poi: PoiListItem) {
    selectPoi(poi, 'list');
  }

  async function handleAdminMarkerDragEnd(
    poiId: string,
    latitude: number,
    longitude: number
  ) {
    if (!isAdmin || !isDatabasePoiId(poiId)) {
      return;
    }

    const previous = pois.find((p) => p.id === poiId);

    // Dərhal state + marker key yenilənir — köhnə yerdə ghost qalmır
    setPois((current) =>
      current.map((poi) =>
        poi.id === poiId ? { ...poi, lat: latitude, lng: longitude } : poi
      )
    );

    if (selectedPoi?.id === poiId) {
      setSelectedPoi((current) =>
        current ? { ...current, lat: latitude, lng: longitude } : current
      );
    }

    setDraggingPoiId(null);

    const { error } = await updatePoiCoordinates(poiId, latitude, longitude);
    if (error) {
      if (previous) {
        setPois((current) =>
          current.map((poi) =>
            poi.id === poiId ? { ...poi, lat: previous.lat, lng: previous.lng } : poi
          )
        );
      }
      showToast(`Koordinat yenilənmədi: ${error}`);
      return;
    }

    showToast('Koordinat yeniləndi');
  }

  function handleGooglePoiClick(event: PoiClickEvent) {
    if (!isAdmin) {
      return;
    }

    const { placeId, name, coordinate } = event.nativeEvent;
    if (!coordinate) {
      return;
    }

    const nextName = name?.trim() || '';
    setPendingGooglePoi((current) => {
      if (current?.placeId && placeId && current.placeId === placeId) {
        return {
          ...current,
          name: nextName || current.name,
          latitude: coordinate.latitude,
          longitude: coordinate.longitude,
        };
      }
      return {
        placeId: placeId ?? '',
        name: nextName,
        latitude: coordinate.latitude,
        longitude: coordinate.longitude,
        rating: null,
        ratingCount: null,
        suggestedCategory: null,
      };
    });

    if (!placeId) {
      return;
    }

    void fetchGooglePlaceRating(placeId).then((details) => {
      setPendingGooglePoi((current) => {
        if (!current || current.placeId !== placeId) {
          return current;
        }
        return {
          ...current,
          name: details.name?.trim() || current.name,
          rating: details.rating ?? current.rating,
          ratingCount: details.ratingCount ?? current.ratingCount,
          suggestedCategory: details.suggestedCategory ?? current.suggestedCategory,
        };
      });
    });
  }

  function handleAdminMapPress(event: { nativeEvent: { coordinate: { latitude: number; longitude: number } } }) {
    if (!isAdmin) {
      return;
    }
    const { coordinate } = event.nativeEvent;
    if (!coordinate) {
      return;
    }
    setPendingGooglePoi({
      placeId: '',
      name: '',
      latitude: coordinate.latitude,
      longitude: coordinate.longitude,
    });
  }

  async function handleConfirmAdminInsert(categories: PoiCategory[], name: string) {
    if (!pendingGooglePoi) {
      return;
    }

    const trimmedName = name.trim();
    if (trimmedName.length < 2) {
      showToast('Məkan adı ən azı 2 simvol olmalıdır');
      return;
    }
    if (!categories.length) {
      showToast('Ən azı bir kateqoriya seçin');
      return;
    }

    setAdminInsertLoading(true);
    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        showToast(userError ? getErrorMessage(userError) : 'Daxil olmaq lazımdır');
        return;
      }

      const { data, error } = await insertApprovedPoiFromGoogle({
        name: trimmedName,
        category: categories[0],
        categories,
        lat: pendingGooglePoi.latitude,
        lng: pendingGooglePoi.longitude,
        placeId: pendingGooglePoi.placeId || undefined,
        userId: user.id,
        rating: pendingGooglePoi.rating ?? null,
        ratingCount: pendingGooglePoi.ratingCount ?? null,
      });

      if (error || !data) {
        showToast(error ?? 'POI əlavə edilmədi');
        return;
      }

      const listItem: PoiListItem = {
        ...data,
        photoUrl: data.thumbnail_url?.trim() || null,
        photoUrls: collectPoiPhotoUrls(data, null, 'thumb'),
        averageRating:
          typeof data.rating === 'number' && Number.isFinite(data.rating) ? data.rating : null,
        ratingCount:
          typeof data.rating_count === 'number' && Number.isFinite(data.rating_count)
            ? data.rating_count
            : 0,
      };

      setPois((current) => {
        const next = [listItem, ...current.filter((p) => p.id !== data.id)];
        next.sort((a, b) => {
          const ra = a.averageRating ?? -1;
          const rb = b.averageRating ?? -1;
          if (rb !== ra) {
            return rb - ra;
          }
          return (b.ratingCount ?? 0) - (a.ratingCount ?? 0);
        });
        return next;
      });
      setPendingGooglePoi(null);
      selectPoi(listItem, 'map');
      showToast(`Əlavə olundu: ${data.name}`);
    } catch (err) {
      showToast(getErrorMessage(err));
    } finally {
      setAdminInsertLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 64 : 0}
    >
      <SafeAreaView style={styles.container} edges={['top']}>
        <ResizableSplit
          storageKey="home-map-split-ratio"
          initialTopRatio={0.5}
          topRatio={splitRatio}
          onTopRatioChange={setSplitRatio}
          minTopRatio={0.22}
          maxTopRatio={0.78}
          top={
            <View style={styles.mapPane}>
              <MapView
                ref={mapRef as never}
                style={styles.map}
                provider={PROVIDER_GOOGLE}
                {...(Platform.OS === 'web'
                  ? {
                      googleMapsApiKey:
                        process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY || undefined,
                    }
                  : {})}
                initialRegion={mapRegion}
                showsUserLocation={false}
                showsMyLocationButton={false}
                clusteringEnabled={Platform.OS !== 'web'}
                radius={22}
                minPoints={4}
                maxZoom={13}
                extent={512}
                animationEnabled={false}
                spiralEnabled={false}
                clusterColor={colors.accent}
                clusterTextColor={colors.textOnAccent}
                tracksViewChanges={tracksMarkers}
                renderCluster={(cluster) => (
                  <MapClusterMarker
                    key={`c-${cluster.geometry.coordinates[0]}-${cluster.geometry.coordinates[1]}-${cluster.properties.point_count}`}
                    geometry={cluster.geometry}
                    properties={cluster.properties}
                    onPress={cluster.onPress}
                    tracksViewChanges={tracksMarkers}
                  />
                )}
                onRegionChangeComplete={(region) => {
                  lastMapRegionRef.current = region;
                }}
                onPoiClick={isAdmin ? handleGooglePoiClick : undefined}
                onPress={isAdmin && Platform.OS === 'web' ? handleAdminMapPress : undefined}
              >
                {userLocation ? (
                  <Marker
                    coordinate={userLocation}
                    title="Siz buradasınız"
                    anchor={{ x: 0.5, y: 0.5 }}
                    tracksViewChanges={false}
                    {...({ cluster: false } as object)}
                  >
                    <View collapsable={false} style={styles.userMarker}>
                      <View collapsable={false} style={styles.userMarkerDot} />
                    </View>
                  </Marker>
                ) : null}

                {pois.map((poi) => {
                    const selected = focusPoiId === poi.id;
                    const canDrag = isAdmin && isDatabasePoiId(poi.id);
                    return (
                      <Marker
                        key={poi.id}
                        coordinate={{ latitude: poi.lat, longitude: poi.lng }}
                        title={poi.name}
                        description={getCategoryLabel(poi.category)}
                        anchor={{ x: 0.5, y: 0.5 }}
                        zIndex={selected ? 1000 : 10}
                        tracksViewChanges={shouldTrackMarkerViewChanges({
                          pulse: tracksMarkers,
                          forceTrack: draggingPoiId === poi.id,
                          draggable: canDrag && draggingPoiId === poi.id,
                          selected,
                        })}
                        draggable={canDrag}
                        // Seçilmiş pin cluster rəqəminin içində gizlənməsin
                        {...(selected ? ({ cluster: false } as object) : {})}
                        onPress={() => handleMarkerPress(poi)}
                        onDragStart={
                          canDrag ? () => setDraggingPoiId(poi.id) : undefined
                        }
                        onDragEnd={
                          canDrag
                            ? (event) => {
                                const { latitude, longitude } =
                                  event.nativeEvent.coordinate;
                                void handleAdminMarkerDragEnd(
                                  poi.id,
                                  latitude,
                                  longitude
                                );
                              }
                            : undefined
                        }
                      >
                        <PoiMarkerBubble
                          category={poi.category}
                          selected={selected}
                        />
                      </Marker>
                    );
                  })}
              </MapView>

              {selectedRegionId && weatherLabel ? (
                <View style={styles.weatherBanner} pointerEvents="none">
                  <Ionicons
                    name={regionWeather?.prefer_indoor ? 'rainy-outline' : 'partly-sunny-outline'}
                    size={14}
                    color={colors.text}
                  />
                  <Text style={styles.weatherBannerText} numberOfLines={1}>
                    {selectedRegion?.label}: {weatherLabel}
                  </Text>
                </View>
              ) : null}

              {isAdmin ? (
                <View style={styles.adminBadge} pointerEvents="none">
                  <Text style={styles.adminBadgeText}>
                    {Platform.OS === 'web'
                      ? 'ADMIN · sürüşdür / əlavə et / sil'
                      : 'ADMIN · sürüşdür / Google məkanına klik / sil'}
                  </Text>
                </View>
              ) : null}

              <View style={styles.mapFilterStack}>
                <TouchableOpacity
                  style={[
                    styles.mapIconButton,
                    selectedRegionId ? styles.mapIconButtonActive : null,
                  ]}
                  onPress={() => setShowLocationPicker(true)}
                  accessibilityLabel={`Məkan: ${locationButtonLabel}`}
                  hitSlop={6}
                >
                  <Ionicons
                    name="location-outline"
                    size={18}
                    color={selectedRegionId ? colors.accent : colors.text}
                  />
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.mapIconButton,
                    selectedCategory ? styles.mapIconButtonActive : null,
                  ]}
                  onPress={() => setShowCategoryPicker(true)}
                  accessibilityLabel={`Kateqoriya: ${categoryButtonLabel}`}
                  hitSlop={6}
                >
                  <Ionicons
                    name="options-outline"
                    size={18}
                    color={selectedCategory ? colors.accent : colors.text}
                  />
                </TouchableOpacity>
              </View>

              <HamburgerMenuButton style={styles.profileCorner} />

              <TouchableOpacity
                style={styles.locateButton}
                onPress={goToCurrentLocation}
                accessibilityLabel="Cari məkana qayıt"
                hitSlop={6}
              >
                <Ionicons name="locate-outline" size={18} color={colors.text} />
              </TouchableOpacity>
            </View>
          }
          bottom={
            <View style={styles.listPane}>
              {selectedPoi ? (
                <SelectedPoiPanel
                  poi={selectedPoi}
                  isAdmin={isAdmin}
                  onBack={clearSelectedPoi}
                  onDeleted={(poiId) => {
                    setPois((current) => current.filter((p) => p.id !== poiId));
                    clearSelectedPoi();
                    showToast('Məkan silindi');
                  }}
                  onPoiIdResolved={(previousId, dbId) => {
                    setSelectedPoi((current) =>
                      current && current.id === previousId
                        ? { ...current, id: dbId, place_id: current.place_id || previousId }
                        : current
                    );
                    setPois((current) =>
                      current.map((item) =>
                        item.id === previousId
                          ? { ...item, id: dbId, place_id: item.place_id || previousId }
                          : item
                      )
                    );
                  }}
                />
              ) : (
                <>
                  <View style={styles.listHeader}>
                    <View style={styles.listHeaderTextWrap}>
                      <Text style={styles.listTitle} numberOfLines={2}>
                        {loading ? 'Yüklənir...' : listTitle}
                      </Text>
                    </View>
                    <View style={styles.listModeToggle}>
                      <TouchableOpacity
                        style={[
                          styles.listModeBtn,
                          listMode === 'list' && styles.listModeBtnActive,
                        ]}
                        onPress={() => setListMode('list')}
                        hitSlop={6}
                        accessibilityLabel="Siyahı görünüşü"
                      >
                        <Ionicons
                          name="list"
                          size={16}
                          color={listMode === 'list' ? colors.textOnAccent : colors.textSecondary}
                        />
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[
                          styles.listModeBtn,
                          listMode === 'cards' && styles.listModeBtnActive,
                        ]}
                        onPress={() => setListMode('cards')}
                        hitSlop={6}
                        accessibilityLabel="Kart görünüşü"
                      >
                        <Ionicons
                          name="albums-outline"
                          size={16}
                          color={listMode === 'cards' ? colors.textOnAccent : colors.textSecondary}
                        />
                      </TouchableOpacity>
                    </View>
                  </View>

                  {loading ? (
                    <ActivityIndicator color={colors.accent} style={styles.loader} />
                  ) : errorMessage ? (
                    <Text style={styles.errorText}>{errorMessage}</Text>
                  ) : (
                    <View
                      style={{ flex: 1 }}
                      onLayout={(e) => {
                        const w = e.nativeEvent.layout.width;
                        if (w > 0 && Math.abs(w - listPaneWidth) > 1) {
                          setListPaneWidth(w);
                        }
                      }}
                    >
                      <FlatList<PoiListItem>
                        key={listMode}
                        ref={listRef}
                        data={pois}
                        keyExtractor={(item) => item.id}
                        style={{ flex: 1 }}
                        horizontal={listMode === 'cards'}
                        pagingEnabled={false}
                        showsVerticalScrollIndicator={false}
                        showsHorizontalScrollIndicator={false}
                        decelerationRate={listMode === 'cards' ? 'fast' : 'normal'}
                        snapToInterval={
                          listMode === 'cards' && listPaneWidth > 0
                            ? Math.round(listPaneWidth * 0.72)
                            : undefined
                        }
                        snapToAlignment={listMode === 'cards' ? 'start' : undefined}
                        disableIntervalMomentum={listMode === 'cards'}
                        contentContainerStyle={
                          listMode === 'cards'
                            ? styles.cardsContent
                            : styles.listContent
                        }
                        getItemLayout={
                          listMode === 'cards' && listPaneWidth > 0
                            ? (_data, index) => {
                                const stride = Math.round(listPaneWidth * 0.72);
                                return {
                                  length: stride,
                                  offset: stride * index,
                                  index,
                                };
                              }
                            : undefined
                        }
                        refreshControl={
                          <RefreshControl
                            refreshing={loading}
                            onRefresh={() => void fetchPois()}
                            tintColor={colors.accent}
                            colors={[colors.accent]}
                          />
                        }
                        onScrollToIndexFailed={(info) => {
                          setTimeout(() => {
                            listRef.current?.scrollToIndex({
                              index: info.index,
                              animated: true,
                              viewPosition: listMode === 'cards' ? 0 : 0.1,
                            });
                          }, 100);
                        }}
                        renderItem={({ item }) => {
                          const isSelected = highlightedPoiId === item.id;
                          const hasSelection = highlightedPoiId != null;
                          const cardStride =
                            listPaneWidth > 0
                              ? Math.round(listPaneWidth * 0.72)
                              : undefined;
                          return (
                            <MemoPoiListCard
                              item={item}
                              variant={listMode}
                              cardWidth={
                                listMode === 'cards' ? cardStride : undefined
                              }
                              highlighted={isSelected}
                              dimmed={hasSelection && !isSelected}
                              userLocation={userLocation}
                              onPress={() => handleCardPress(item)}
                            />
                          );
                        }}
                        ListEmptyComponent={
                          <View style={styles.emptyWrap}>
                            <Text style={styles.emptyTitle}>Bu filterlə yer tapılmadı 🔍</Text>
                            <Text style={styles.emptySubtitle}>
                              Fərqli rayon və ya kateqoriya seçin
                            </Text>
                          </View>
                        }
                      />
                    </View>
                  )}
                </>
              )}
            </View>
          }
        />

        <AdminPoiCategoryModal
          visible={!!pendingGooglePoi}
          poi={pendingGooglePoi}
          loading={adminInsertLoading}
          onCancel={() => {
            if (!adminInsertLoading) {
              setPendingGooglePoi(null);
            }
          }}
          onConfirm={(categories, name) => {
            void handleConfirmAdminInsert(categories, name);
          }}
        />

        {ToastHost}
        <Modal
          visible={showLocationPicker}
          transparent
          animationType="slide"
          onRequestClose={() => setShowLocationPicker(false)}
        >
          <Pressable
            style={styles.pickerOverlay}
            onPress={() => setShowLocationPicker(false)}
          >
            <Pressable style={styles.pickerSheet} onPress={(e) => e.stopPropagation()}>
              <View style={styles.pickerHeader}>
                <Text style={styles.pickerTitle}>Məkan seç</Text>
                <TouchableOpacity onPress={() => setShowLocationPicker(false)} hitSlop={8}>
                  <Text style={styles.pickerClose}>✕</Text>
                </TouchableOpacity>
              </View>
              <ScrollView
                style={[
                  styles.pickerScroll,
                  { maxHeight: Math.round(Dimensions.get('window').height * 0.55) },
                ]}
                nestedScrollEnabled
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator
              >
                {LOCATION_OPTIONS.map((option) => {
                  const selected = selectedRegionId === option.value;
                  return (
                    <TouchableOpacity
                      key={option.label}
                      style={styles.pickerRow}
                      onPress={() => handleSelectLocation(option.value)}
                    >
                      <Text style={styles.pickerRowLabel}>{option.label}</Text>
                      {selected ? <Text style={styles.pickerCheck}>✓</Text> : null}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </Pressable>
          </Pressable>
        </Modal>

        <Modal
          visible={showCategoryPicker}
          transparent
          animationType="slide"
          onRequestClose={() => setShowCategoryPicker(false)}
        >
          <Pressable
            style={styles.pickerOverlay}
            onPress={() => setShowCategoryPicker(false)}
          >
            <Pressable style={styles.pickerSheet} onPress={(e) => e.stopPropagation()}>
              <View style={styles.pickerHeader}>
                <Text style={styles.pickerTitle}>Kateqoriya seç</Text>
                <TouchableOpacity onPress={() => setShowCategoryPicker(false)} hitSlop={8}>
                  <Text style={styles.pickerClose}>✕</Text>
                </TouchableOpacity>
              </View>
              <ScrollView
                style={[
                  styles.pickerScroll,
                  { maxHeight: Math.round(Dimensions.get('window').height * 0.55) },
                ]}
                nestedScrollEnabled
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator
              >
                {CATEGORY_OPTIONS.map((option) => {
                  const selected =
                    option.value === null
                      ? selectedCategory === null
                      : selectedCategory === option.value;
                  return (
                    <TouchableOpacity
                      key={option.label}
                      style={styles.pickerRow}
                      onPress={() => handleSelectCategory(option.value)}
                    >
                      <View style={styles.pickerRowLeft}>
                        <CategoryIcon
                          category={option.value ?? 'all'}
                          size={16}
                          color={selected ? colors.accent : colors.text}
                        />
                        <Text style={styles.pickerRowLabel}>{option.label}</Text>
                      </View>
                      {selected ? <Text style={styles.pickerCheck}>✓</Text> : null}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </Pressable>
          </Pressable>
        </Modal>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

function SelectedPoiPanel({
  poi,
  onBack,
  onDeleted,
  onPoiIdResolved,
  isAdmin = false,
}: {
  poi: Poi;
  onBack: () => void;
  onDeleted?: (poiId: string) => void;
  onPoiIdResolved?: (previousId: string, dbId: string) => void;
  isAdmin?: boolean;
}) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [deleting, setDeleting] = useState(false);
  const seededUrls = (poi as PoiListItem).photoUrls ?? collectPoiPhotoUrls(poi, null, 'medium');
  const [photoUrls, setPhotoUrls] = useState<string[]>(seededUrls);
  const [activePhotoIndex, setActivePhotoIndex] = useState(0);
  const [loadingPhotos, setLoadingPhotos] = useState(false);

  const initialRating =
    typeof (poi as PoiListItem).averageRating === 'number'
      ? (poi as PoiListItem).averageRating
      : typeof poi.rating === 'number' && Number.isFinite(poi.rating)
        ? poi.rating
        : null;
  const [averageRating, setAverageRating] = useState<number | null>(initialRating);
  const [amenitiesOpen, setAmenitiesOpen] = useState(false);

  const regionLabel =
    REGIONS.find((region) => region.id === poi.region)?.label ?? poi.region;
  const canDelete = isAdmin && isDatabasePoiId(poi.id);

  useEffect(() => {
    setAmenitiesOpen(false);
    const next = (poi as PoiListItem).photoUrls ?? collectPoiPhotoUrls(poi, null, 'medium');
    setPhotoUrls(next);
    setActivePhotoIndex(0);
  }, [poi.id]);

  useEffect(() => {
    let active = true;
    const fallback =
      typeof (poi as PoiListItem).averageRating === 'number'
        ? (poi as PoiListItem).averageRating
        : typeof poi.rating === 'number' && Number.isFinite(poi.rating)
          ? poi.rating
          : null;
    setAverageRating(fallback);

    if (!isDatabasePoiId(poi.id)) {
      return () => {
        active = false;
      };
    }

    (async () => {
      setLoadingPhotos(true);
      const [ratingsResult, photosResult] = await Promise.all([
        supabase
          .from('ratings')
          .select('score')
          .eq('target_type', 'poi')
          .eq('target_id', poi.id),
        supabase
          .from('poi_photos')
          .select('photo_url, thumb_url, medium_url, order_index, status')
          .eq('poi_id', poi.id)
          .order('order_index', { ascending: true }),
      ]);

      if (!active) {
        return;
      }

      if (!ratingsResult.error) {
        const rows = ratingsResult.data ?? [];
        if (rows.length === 0) {
          setAverageRating(fallback);
        } else {
          const sum = rows.reduce((acc, row) => acc + row.score, 0);
          setAverageRating(sum / rows.length);
        }
      }

      if (!photosResult.error) {
        const next = collectPoiPhotoUrls(poi, photosResult.data ?? [], 'medium');
        setPhotoUrls(next);
        setActivePhotoIndex(0);
      }
      setLoadingPhotos(false);
    })();

    return () => {
      active = false;
    };
  }, [poi]);

  function confirmDeletePoi() {
    if (!canDelete || deleting) {
      return;
    }
    Alert.alert(
      'Məkanı sil',
      `"${poi.name}" DB-dən silinsin? Bu əməliyyat geri qaytarılmır.`,
      [
        { text: 'Ləğv et', style: 'cancel' },
        {
          text: 'Sil',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setDeleting(true);
              const { error } = await deletePoiAsAdmin(poi.id);
              setDeleting(false);
              if (error) {
                Alert.alert('Silinmədi', error);
                return;
              }
              onDeleted?.(poi.id);
            })();
          },
        },
      ]
    );
  }

  return (
    <ScrollView style={styles.detailPanel} contentContainerStyle={styles.detailPanelContent}>
      <View style={styles.detailTopRow}>
        <TouchableOpacity onPress={onBack} hitSlop={8} style={styles.backButton}>
          <Text style={styles.backButtonText}>← Geri</Text>
        </TouchableOpacity>
        <FavoriteButton
          targetType="poi"
          targetId={poi.id}
          size={18}
          liveSeed={
            isDatabasePoiId(poi.id)
              ? null
              : {
                  place_id: poi.place_id || poi.id,
                  name: poi.name,
                  lat: poi.lat,
                  lng: poi.lng,
                  category: poi.category,
                  region: poi.region,
                  rating: poi.rating,
                  rating_count: poi.rating_count,
                }
          }
          onResolvedId={(dbId) => {
            if (dbId !== poi.id) {
              onPoiIdResolved?.(poi.id, dbId);
            }
          }}
        />
        <View style={[styles.categoryBadge, { maxWidth: '55%' }]}>
          <CategoryIcon
            category={poi.category}
            size={12}
            color={colors.accentPressed}
          />
          <Text style={styles.categoryBadgeText} numberOfLines={1}>
            {getCategoryLabel(poi.category)}
          </Text>
        </View>
      </View>

      {loadingPhotos && photoUrls.length === 0 ? (
        <View style={styles.panelGalleryPlaceholder}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : photoUrls.length > 0 ? (
        <PoiPhotoGallery
          urls={photoUrls}
          activeIndex={activePhotoIndex}
          onActiveIndexChange={setActivePhotoIndex}
          compact
        />
      ) : (
        <View style={styles.panelGalleryPlaceholder}>
          <CategoryIcon category={poi.category} size={28} color={colors.textMuted} />
        </View>
      )}

      <View style={styles.detailNameRow}>
        <Text style={styles.detailName} numberOfLines={2}>
          {poi.name}
        </Text>
        {isPoiSponsored(poi) ? (
          <View style={styles.sponsorChip}>
            <Text style={styles.sponsorChipText}>Sponsor</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.detailMetaRow}>
        <Text style={styles.detailMeta}>📍 {regionLabel}</Text>
        <Text style={styles.detailMeta}>
          ⭐ {averageRating === null ? '—' : averageRating.toFixed(1)}
        </Text>
        {(() => {
          const priceLabel = formatPoiPrice(poi.price_from, poi.price_currency);
          if (!priceLabel) return null;
          return <Text style={[styles.detailMeta, styles.detailPrice]}>{priceLabel}</Text>;
        })()}
        {(() => {
          const hours = summarizeOpeningHours(poi.opening_hours);
          if (!hours) {
            return null;
          }
          return (
            <Text
              style={[
                styles.detailMeta,
                hours.status === 'open'
                  ? styles.hoursOpen
                  : hours.status === 'closed'
                    ? styles.hoursClosed
                    : null,
              ]}
            >
              {hours.label}
            </Text>
          );
        })()}
      </View>

      {(() => {
        const desc = displayPoiDescription(poi.description);
        if (!desc) return null;
        return (
          <Text style={styles.detailDescription} numberOfLines={3}>
            {desc}
          </Text>
        );
      })()}

      {(() => {
        const amenities = translateAmenities(poi.amenities);
        if (amenities.length === 0) return null;
        return (
          <View style={styles.panelAmenities}>
            <TouchableOpacity
              style={styles.panelAmenitiesToggle}
              onPress={() => setAmenitiesOpen((v) => !v)}
              activeOpacity={0.75}
            >
              <Text style={styles.panelAmenitiesTitle}>
                İmkanlar ({amenities.length})
              </Text>
              <Text style={styles.panelAmenitiesHint}>{amenitiesOpen ? '▴' : '▾'}</Text>
            </TouchableOpacity>
            {amenitiesOpen
              ? amenities.map((item) => (
                  <Text key={item} style={styles.panelAmenityItem}>
                    · {item}
                  </Text>
                ))
              : null}
          </View>
        );
      })()}

      <View style={styles.detailActions}>
        {shouldShowPoiContact(poi.category, poi.phone) ? (
          <>
            <TouchableOpacity
              style={styles.actionButton}
              onPress={() => {
                const url = buildPoiTelUrl(poi.phone);
                if (url) void Linking.openURL(url);
              }}
            >
              <Text style={styles.actionButtonText}>📞 Zəng et</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.actionButton}
              onPress={() => {
                const url = buildPoiWhatsAppUrl({
                  phone: poi.phone,
                  placeName: poi.name,
                });
                if (url) void Linking.openURL(url);
              }}
            >
              <Text style={styles.actionButtonText}>💬 WhatsApp</Text>
            </TouchableOpacity>
          </>
        ) : poi.phone ? (
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => {
              const url = buildPoiTelUrl(poi.phone);
              if (url) void Linking.openURL(url);
            }}
          >
            <Text style={styles.actionButtonText}>📞 Zəng et</Text>
          </TouchableOpacity>
        ) : null}
        {poi.website ? (
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => {
              const url = buildPoiWebsiteUrl(poi.website);
              if (url) void Linking.openURL(url);
            }}
          >
            <Text style={styles.actionButtonText}>🌐 Vebsayt</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity
          style={styles.actionButton}
          onPress={() =>
            Linking.openURL(`https://maps.google.com/?q=${poi.lat},${poi.lng}`)
          }
        >
          <Text style={styles.actionButtonText}>🗺️ Maps-də aç</Text>
        </TouchableOpacity>
        {canDelete ? (
          <TouchableOpacity
            style={[styles.actionButton, styles.deleteActionButton]}
            onPress={confirmDeletePoi}
            disabled={deleting}
          >
            <Text style={styles.deleteActionButtonText}>
              {deleting ? 'Silinir…' : '🗑 Məkanı sil'}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </ScrollView>
  );
}

function PoiListCard({
  item,
  highlighted,
  dimmed,
  userLocation,
  onPress,
  variant = 'list',
  cardWidth,
}: {
  item: PoiListItem;
  highlighted: boolean;
  dimmed?: boolean;
  userLocation: { latitude: number; longitude: number } | null;
  onPress: () => void;
  variant?: 'list' | 'cards';
  cardWidth?: number;
}) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const distanceLabel = userLocation
    ? calculateDistance(
        userLocation.latitude,
        userLocation.longitude,
        item.lat,
        item.lng
      )
    : null;

  const priceLabel = formatPoiPrice(item.price_from, item.price_currency);
  const hasPhone = Boolean(item.phone && String(item.phone).trim());

  if (variant === 'cards') {
    const width = cardWidth && cardWidth > 0 ? cardWidth : Dimensions.get('window').width;
    return (
      <Pressable
        onPress={onPress}
        style={[
          styles.swipeCard,
          { width },
          highlighted && styles.cardHighlighted,
          dimmed && styles.cardDimmed,
        ]}
      >
        <View style={styles.swipeCardInner}>
          {item.photoUrl ? (
            <Image source={{ uri: item.photoUrl }} style={styles.swipeCardImage} />
          ) : (
            <View style={styles.swipeCardImagePlaceholder}>
              <CategoryIcon
                category={item.category}
                size={28}
                color={highlighted ? colors.accentPressed : colors.text}
              />
            </View>
          )}
          <View style={styles.swipeCardBody}>
            <Text style={styles.swipeCardName} numberOfLines={2}>
              {item.name}
            </Text>
            <Text style={styles.cardCategory} numberOfLines={1}>
              {getCategoryLabel(item.category)}
              {item.photoUrls.length > 0 ? ` · ${item.photoUrls.length} şəkil` : ''}
              {hasPhone ? ' · telefon' : ''}
            </Text>
            <View style={styles.swipeCardMeta}>
              <View style={styles.ratingRow}>
                <Text style={styles.ratingStar}>★</Text>
                <Text style={styles.ratingText}>
                  {item.averageRating === null ? '—' : item.averageRating.toFixed(1)}
                </Text>
              </View>
              {priceLabel ? <Text style={styles.cardPrice}>{priceLabel}</Text> : null}
              {distanceLabel ? (
                <Text style={styles.distanceText}>{distanceLabel}</Text>
              ) : null}
            </View>
          </View>
        </View>
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.card,
        highlighted && styles.cardHighlighted,
        dimmed && styles.cardDimmed,
      ]}
    >
      {item.photoUrl ? (
        <Image source={{ uri: item.photoUrl }} style={styles.cardThumb} />
      ) : (
        <View style={styles.cardEmojiWrap}>
          <CategoryIcon
            category={item.category}
            size={15}
            color={highlighted ? colors.accentPressed : colors.text}
          />
        </View>
      )}

      <View style={styles.cardBody}>
        <View style={styles.cardTopRow}>
          <Text style={styles.cardName} numberOfLines={1}>
            {item.name}
          </Text>
          <View style={styles.cardMetaRight}>
            <View style={styles.ratingRow}>
              <Text style={styles.ratingStar}>★</Text>
              <Text style={styles.ratingText}>
                {item.averageRating === null ? '—' : item.averageRating.toFixed(1)}
              </Text>
            </View>
            {priceLabel ? <Text style={styles.cardPrice}>{priceLabel}</Text> : null}
            {distanceLabel ? (
              <Text style={styles.distanceText}>{distanceLabel}</Text>
            ) : null}
          </View>
        </View>

        <Text style={styles.cardCategory} numberOfLines={1}>
          {getCategoryLabel(item.category)}
          {item.photoUrls.length > 1 ? ` · ${item.photoUrls.length} şəkil` : ''}
          {hasPhone ? ' · tel' : ''}
        </Text>
      </View>
    </Pressable>
  );
}

const MemoPoiListCard = memo(PoiListCard);

