import * as Location from 'expo-location';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
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
  type MarkerDragStartEndEvent,
  type PoiClickEvent,
  type Region as MapRegion,
} from '../../components/ClusteredAppMap';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AdminPoiCategoryModal } from '../../components/AdminPoiCategoryModal';
import { CategoryIcon } from '../../components/CategoryIcon';
import { ProfileCornerButton } from '../../components/ProfileCornerButton';
import { ResizableSplit } from '../../components/ResizableSplit';
import { useToast } from '../../components/Toast';
import { DEFAULT_REGION_ID, REGIONS } from '../../constants/regions';
import {
  insertApprovedPoiFromGoogle,
  updatePoiCoordinates,
  fetchGooglePlaceRating,
  type GoogleMapPoiPayload,
} from '../../lib/adminMap';
import {
  getCategoryLabel,
  type HomeCategoryFilterId,
} from '../../lib/categoryUtils';
import { getErrorMessage } from '../../lib/errors';
import {
  fetchLivePlaces,
  isDatabasePoiId,
  livePlaceToPoi,
  mergeLivePlacesById,
  radiusMetersFromLongitudeDelta,
  viewportTileKey,
} from '../../lib/livePlaces';
import { supabase } from '../../lib/supabase';
import { useIsAdmin } from '../../lib/useIsAdmin';
import type { Poi, PoiCategory, PoiPhoto } from '../../types/database';

import { colors } from '../../constants/theme';

type PoiListItem = Poi & {
  photoUrl: string | null;
  averageRating: number | null;
  ratingCount: number;
};

type PoiQueryRow = Poi & {
  poi_photos?: Pick<PoiPhoto, 'photo_url' | 'order_index' | 'created_at' | 'status'>[] | null;
};

const LOCATION_OPTIONS: { label: string; value: string | null }[] = [
  { label: '🗺️ Hamısı', value: null },
  { label: '📍 Quba', value: 'quba' },
  { label: '📍 Qusar', value: 'qusar' },
  { label: '📍 Şəki', value: 'seki' },
  { label: '📍 Lerik', value: 'lerik' },
  { label: '📍 Qəbələ', value: 'qabala' },
];

const CATEGORY_OPTIONS: { label: string; value: string | null }[] = [
  { label: 'Hamısı', value: null },
  { label: 'Restoran', value: 'restaurant' },
  { label: 'Otel', value: 'hotel' },
  { label: 'Hostel', value: 'hostel' },
  { label: 'Ev restoranı', value: 'home_restaurant' },
  { label: 'Qonaq evi', value: 'guesthouse' },
  { label: 'Təbiət', value: 'nature' },
  { label: 'Şəlalə', value: 'waterfall' },
  { label: 'Dağ', value: 'mountain' },
  { label: 'Göl', value: 'lake' },
  { label: 'Tarixi', value: 'historical' },
  { label: 'Abidə', value: 'monument' },
  { label: 'Digər', value: 'other' },
];

const REGION_LOCATIVE: Record<string, string> = {
  quba: 'Qubada',
  qusar: 'Qusarda',
  seki: 'Şəkidə',
  lerik: 'Lerikdə',
  qabala: 'Qəbələdə',
};

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
  const router = useRouter();
  const mapRef = useRef<{ animateToRegion: (region: MapRegion, duration?: number) => void } | null>(
    null
  );
  const listRef = useRef<FlatList<PoiListItem>>(null);
  const viewportFetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadedViewportTiles = useRef<Set<string>>(new Set());
  const viewportFetchGen = useRef(0);
  const { isAdmin } = useIsAdmin();
  const { showToast, ToastHost } = useToast();

  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<HomeCategoryFilterId>('all');
  const [pois, setPois] = useState<PoiListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [highlightedPoiId, setHighlightedPoiId] = useState<string | null>(null);
  const [selectedPoi, setSelectedPoi] = useState<Poi | null>(null);
  /** Custom marker redraw (tracksViewChanges) — seçim dəyişəndə qısa müddət. */
  const [markerTracksId, setMarkerTracksId] = useState<string | null>(null);
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const [pendingGooglePoi, setPendingGooglePoi] = useState<GoogleMapPoiPayload | null>(null);
  const [adminInsertLoading, setAdminInsertLoading] = useState(false);
  const [draggingPoiId, setDraggingPoiId] = useState<string | null>(null);
  const [userLocation, setUserLocation] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);

  const selectedCategory = categoryFilter === 'all' ? null : categoryFilter;

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
      ? (REGION_LOCATIVE[selectedRegionId] ?? `${selectedRegion?.label ?? ''}da`)
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

    const { data, error } = await query.limit(50);
    if (error) {
      throw error;
    }

    const rows = (data ?? []) as PoiQueryRow[];
    const mapped = rows.map((poi) => {
      const photos = [...(poi.poi_photos ?? [])]
        .filter((photo) => !('status' in photo) || photo.status === 'approved')
        .sort((a, b) => a.order_index - b.order_index);
      const { poi_photos: _ignored, ...rest } = poi;
      return {
        ...rest,
        photoUrl: photos[0]?.photo_url ?? null,
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
      const ra = a.averageRating ?? -1;
      const rb = b.averageRating ?? -1;
      if (rb !== ra) {
        return rb - ra;
      }
      return (b.ratingCount ?? 0) - (a.ratingCount ?? 0);
    });

    return mapped;
  }, [selectedRegionId, categoryFilter]);

  const mapLiveToListItems = useCallback(
    (places: Parameters<typeof livePlaceToPoi>[0][], regionId: string): PoiListItem[] =>
      places.map((place) => {
        const poi = livePlaceToPoi(place, regionId);
        return {
          ...poi,
          photoUrl: null,
          averageRating:
            typeof poi.rating === 'number' && Number.isFinite(poi.rating)
              ? poi.rating
              : null,
          ratingCount:
            typeof poi.rating_count === 'number' && Number.isFinite(poi.rating_count)
              ? poi.rating_count
              : 0,
        };
      }),
    []
  );

  const fetchPois = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent === true;
    try {
      if (!silent) {
        setLoading(true);
        setErrorMessage(null);
      }

      // Region overview — hub-driven live; uğursuz olsa DB fallback
      if (selectedRegionId) {
        loadedViewportTiles.current = new Set();
        viewportFetchGen.current += 1;
        const live = await fetchLivePlaces(selectedRegionId, {
          category: categoryFilter === 'all' ? null : categoryFilter,
          limit: 60,
        });

        if (live && live.places.length > 0) {
          const mapped = mapLiveToListItems(live.places, selectedRegionId);
          if (__DEV__) {
            console.log('Live places:', mapped.length, live.source, live.hubs_used);
          }
          setPois(mapped);
          return;
        }
      }

      const mapped = await fetchPoisFromDb();
      if (__DEV__) {
        console.log('POI sayı (DB):', mapped.length);
      }
      setPois(mapped);
    } catch (err: unknown) {
      if (__DEV__) {
        console.log('Catch xətası:', err);
      }
      if (!silent) {
        const message = err instanceof Error ? err.message : String(err);
        setErrorMessage('Xəta: ' + message);
      }
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, [selectedRegionId, categoryFilter, fetchPoisFromDb, mapLiveToListItems]);

  const fetchViewportPlaces = useCallback(
    (region: MapRegion) => {
      if (!selectedRegionId) return;
      // Region overview already covers zoomed-out view — skip Google spam
      if (region.longitudeDelta > 0.45) {
        return;
      }

      if (viewportFetchTimer.current) {
        clearTimeout(viewportFetchTimer.current);
      }

      viewportFetchTimer.current = setTimeout(() => {
        void (async () => {
          const tile = viewportTileKey(
            region.latitude,
            region.longitude,
            region.longitudeDelta
          );
          if (loadedViewportTiles.current.has(tile)) {
            return;
          }
          loadedViewportTiles.current.add(tile);
          const gen = viewportFetchGen.current;
          const radius = radiusMetersFromLongitudeDelta(region.longitudeDelta);

          const live = await fetchLivePlaces(selectedRegionId, {
            category: categoryFilter === 'all' ? null : categoryFilter,
            limit: 50,
            lat: region.latitude,
            lng: region.longitude,
            radius,
          });

          if (!live || live.places.length === 0) {
            loadedViewportTiles.current.delete(tile);
            return;
          }
          if (gen !== viewportFetchGen.current) {
            return;
          }

          const incoming = mapLiveToListItems(live.places, selectedRegionId);
          setPois((prev) => mergeLivePlacesById(prev, incoming));
          if (__DEV__) {
            console.log('Viewport merge:', incoming.length, tile);
          }
        })();
      }, 650);
    },
    [selectedRegionId, categoryFilter, mapLiveToListItems]
  );

  useEffect(() => {
    return () => {
      if (viewportFetchTimer.current) {
        clearTimeout(viewportFetchTimer.current);
      }
    };
  }, []);

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
    if (!markerTracksId) return;
    const t = setTimeout(() => setMarkerTracksId(null), 700);
    return () => clearTimeout(t);
  }, [markerTracksId]);

  useEffect(() => {
    fetchPois();
  }, [fetchPois]);

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

  function centerMapOnPoi(poi: { id: string; lat: number; lng: number }) {
    setMarkerTracksId(poi.id);
    mapRef.current?.animateToRegion(
      {
        latitude: poi.lat,
        longitude: poi.lng,
        // Cluster açılması + marker mərkəzdə oxunaqlı olsun
        latitudeDelta: 0.008,
        longitudeDelta: 0.008,
      },
      450
    );
  }

  function scrollListToPoi(poiId: string) {
    const index = pois.findIndex((p) => p.id === poiId);
    if (index < 0) return;
    requestAnimationFrame(() => {
      try {
        listRef.current?.scrollToIndex({
          index,
          animated: true,
          viewPosition: 0.2,
        });
      } catch {
        // FlatList hələ layout olmayıbsa onScrollToIndexFailed işləyir
      }
    });
  }

  function selectPoi(poi: Poi) {
    setSelectedPoi(poi);
    setHighlightedPoiId(poi.id);
    centerMapOnPoi(poi);
    scrollListToPoi(poi.id);

    // Google place — Place Details ilə ad / kateqoriya / rating yenilə
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
          category: details.suggestedCategory ?? current.category,
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
            category: details.suggestedCategory ?? row.category,
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
    setMarkerTracksId(null);

    if (selectedRegion) {
      mapRef.current?.animateToRegion(
        {
          latitude: selectedRegion.latitude,
          longitude: selectedRegion.longitude,
          latitudeDelta: selectedRegion.latitudeDelta,
          longitudeDelta: selectedRegion.longitudeDelta,
        },
        600
      );
      return;
    }

    if (userLocation) {
      mapRef.current?.animateToRegion(
        {
          latitude: userLocation.latitude,
          longitude: userLocation.longitude,
          latitudeDelta: 0.12,
          longitudeDelta: 0.12,
        },
        600
      );
      return;
    }

    mapRef.current?.animateToRegion(mapRegion, 600);
  }

  function handleMarkerPress(poi: PoiListItem) {
    if (selectedPoi?.id === poi.id) {
      clearSelectedPoi();
      return;
    }
    selectPoi(poi);
  }

  function handleCardPress(poi: PoiListItem) {
    selectPoi(poi);
  }

  async function handleAdminMarkerDragEnd(poiId: string, event: MarkerDragStartEndEvent) {
    if (!isAdmin || !isDatabasePoiId(poiId)) {
      return;
    }

    const { latitude, longitude } = event.nativeEvent.coordinate;
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

    const base: GoogleMapPoiPayload = {
      placeId: placeId ?? '',
      name: name?.trim() || '',
      latitude: coordinate.latitude,
      longitude: coordinate.longitude,
      rating: null,
      ratingCount: null,
      suggestedCategory: null,
    };
    setPendingGooglePoi(base);

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
          rating: details.rating,
          ratingCount: details.ratingCount,
          suggestedCategory: details.suggestedCategory,
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

  async function handleConfirmAdminInsert(category: PoiCategory, name: string) {
    if (!pendingGooglePoi) {
      return;
    }

    const trimmedName = name.trim();
    if (trimmedName.length < 2) {
      showToast('Məkan adı ən azı 2 simvol olmalıdır');
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
        category,
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
        photoUrl: null,
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
      selectPoi(listItem);
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
          minTopRatio={0.22}
          maxTopRatio={0.78}
          top={
            <View style={styles.mapPane}>
              <MapView
                ref={mapRef as never}
                style={styles.map}
                provider={Platform.OS === 'web' ? undefined : PROVIDER_GOOGLE}
                initialRegion={mapRegion}
                showsUserLocation={false}
                showsMyLocationButton={false}
                radius={48}
                minPoints={3}
                animationEnabled={false}
                onRegionChangeComplete={
                  selectedRegionId
                    ? (region) => {
                        fetchViewportPlaces(region);
                      }
                    : undefined
                }
                onPoiClick={isAdmin ? handleGooglePoiClick : undefined}
                onPress={isAdmin && Platform.OS === 'web' ? handleAdminMapPress : undefined}
              >
                {userLocation ? (
                  <Marker
                    coordinate={userLocation}
                    title="Siz buradasınız"
                    pinColor={colors.accent}
                    cluster={false}
                  >
                    <View style={styles.userMarker}>
                      <View style={styles.userMarkerDot} />
                      <Text style={styles.userMarkerLabel}>Siz buradasınız</Text>
                    </View>
                  </Marker>
                ) : null}

                {pois.map((poi) => {
                  const isSelected =
                    selectedPoi?.id === poi.id || highlightedPoiId === poi.id;
                  const hasSelection = selectedPoi != null || highlightedPoiId != null;
                  const isDimmed = hasSelection && !isSelected;

                  return (
                  <Marker
                    key={poi.id}
                    coordinate={{ latitude: poi.lat, longitude: poi.lng }}
                    title={poi.name}
                    description={getCategoryLabel(poi.category)}
                    pinColor={
                      isAdmin
                        ? isSelected
                          ? colors.accent
                          : isDimmed
                            ? '#C8C8CC'
                            : colors.success
                        : undefined
                    }
                    zIndex={isSelected ? 1000 : isDimmed ? 1 : 10}
                    opacity={isDimmed && !isAdmin ? 0.45 : 1}
                    onPress={() => handleMarkerPress(poi)}
                    draggable={isAdmin && isDatabasePoiId(poi.id)}
                    onDragStart={
                      isAdmin && isDatabasePoiId(poi.id)
                        ? () => {
                            setDraggingPoiId(poi.id);
                          }
                        : undefined
                    }
                    onDragEnd={
                      isAdmin && isDatabasePoiId(poi.id)
                        ? (event) => {
                            void handleAdminMarkerDragEnd(poi.id, event);
                          }
                        : undefined
                    }
                    tracksViewChanges={
                      draggingPoiId === poi.id || markerTracksId != null
                    }
                  >
                    {/* Admin sürüşdürmədə custom child ghost marker yaradır — yalnız pin */}
                    {isAdmin ? null : (
                      <View
                        style={[
                          styles.poiMarkerBubble,
                          isSelected && styles.poiMarkerBubbleHighlighted,
                          isDimmed && styles.poiMarkerBubbleDimmed,
                        ]}
                      >
                        <CategoryIcon
                          category={poi.category}
                          size={isSelected ? 14 : 12}
                          color={isSelected ? colors.accentPressed : colors.text}
                        />
                      </View>
                    )}
                  </Marker>
                  );
                })}
              </MapView>

              {isAdmin ? (
                <View style={styles.adminBadge} pointerEvents="none">
                  <Text style={styles.adminBadgeText}>
                    {Platform.OS === 'web'
                      ? 'ADMIN · sürüşdür / xəritəyə və ya Google məkanına klik'
                      : 'ADMIN · sürüşdür / Google məkanına klik'}
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

              <ProfileCornerButton style={styles.profileCorner} />

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
                <SelectedPoiPanel poi={selectedPoi} onBack={clearSelectedPoi} />
              ) : (
                <>
                  <View style={styles.listHeader}>
                    <Text style={styles.listTitle}>{loading ? 'Yüklənir...' : listTitle}</Text>
                    <TouchableOpacity
                      onPress={() => router.push('/feed' as never)}
                      hitSlop={8}
                      accessibilityLabel="Paylaş"
                    >
                      <Text style={styles.shareHeaderButton}>Paylaş</Text>
                    </TouchableOpacity>
                  </View>

                  {loading ? (
                    <ActivityIndicator color={colors.accent} style={styles.loader} />
                  ) : errorMessage ? (
                    <Text style={styles.errorText}>{errorMessage}</Text>
                  ) : (
                    <FlatList
                      ref={listRef}
                      data={pois}
                      keyExtractor={(item) => item.id}
                      style={{ flex: 1 }}
                      showsVerticalScrollIndicator={false}
                      contentContainerStyle={styles.listContent}
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
                            viewPosition: 0.1,
                          });
                        }, 100);
                      }}
                      renderItem={({ item }) => {
                        const isSelected =
                          selectedPoi?.id === item.id || highlightedPoiId === item.id;
                        const hasSelection =
                          selectedPoi != null || highlightedPoiId != null;
                        return (
                        <MemoPoiListCard
                          item={item}
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
          onConfirm={(category, name) => {
            void handleConfirmAdminInsert(category, name);
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
              <ScrollView>
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
              <ScrollView>
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

function SelectedPoiPanel({ poi, onBack }: { poi: Poi; onBack: () => void }) {
  const initialRating =
    typeof (poi as PoiListItem).averageRating === 'number'
      ? (poi as PoiListItem).averageRating
      : typeof poi.rating === 'number' && Number.isFinite(poi.rating)
        ? poi.rating
        : null;
  const [averageRating, setAverageRating] = useState<number | null>(initialRating);
  const [userScore, setUserScore] = useState<number | null>(null);
  const [submittingScore, setSubmittingScore] = useState(false);
  const [ratingError, setRatingError] = useState<string | null>(null);

  const regionLabel =
    REGIONS.find((region) => region.id === poi.region)?.label ?? poi.region;

  useEffect(() => {
    let active = true;
    const fallback =
      typeof (poi as PoiListItem).averageRating === 'number'
        ? (poi as PoiListItem).averageRating
        : typeof poi.rating === 'number' && Number.isFinite(poi.rating)
          ? poi.rating
          : null;
    setAverageRating(fallback);
    setUserScore(null);

    if (!isDatabasePoiId(poi.id)) {
      // Live Google — yalnız Google rating (Place Details / Nearby)
      return () => {
        active = false;
      };
    }

    (async () => {
      setRatingError(null);
      const {
        data: { user },
      } = await supabase.auth.getUser();

      const { data, error } = await supabase
        .from('ratings')
        .select('score, rater_id')
        .eq('target_type', 'poi')
        .eq('target_id', poi.id);

      if (!active) {
        return;
      }

      if (error) {
        setRatingError(getErrorMessage(error));
        return;
      }

      const rows = data ?? [];
      if (rows.length === 0) {
        setAverageRating(fallback);
      } else {
        const sum = rows.reduce((acc, row) => acc + row.score, 0);
        setAverageRating(sum / rows.length);
      }

      if (user) {
        setUserScore(rows.find((row) => row.rater_id === user.id)?.score ?? null);
      } else {
        setUserScore(null);
      }
    })();

    return () => {
      active = false;
    };
  }, [poi]);

  async function handleSubmitScore(score: number) {
    if (submittingScore) {
      return;
    }

    // Live Google marker — icma reytinqi yalnız DB POI üçün
    if (!isDatabasePoiId(poi.id)) {
      setRatingError('Google məkanında icma reytinqi hələ aktiv deyil.');
      return;
    }

    setSubmittingScore(true);
    setRatingError(null);

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        setRatingError(userError ? getErrorMessage(userError) : 'Reytinq vermək üçün daxil olun.');
        return;
      }

      const { error } = await supabase.from('ratings').upsert(
        {
          rater_id: user.id,
          target_type: 'poi',
          target_id: poi.id,
          score,
        },
        { onConflict: 'rater_id,target_type,target_id' }
      );

      if (error) {
        setRatingError(getErrorMessage(error));
        return;
      }

      setUserScore(score);

      const { data: refreshed } = await supabase
        .from('ratings')
        .select('score')
        .eq('target_type', 'poi')
        .eq('target_id', poi.id);

      if (refreshed && refreshed.length > 0) {
        const sum = refreshed.reduce((acc, row) => acc + row.score, 0);
        setAverageRating(sum / refreshed.length);
      }
    } catch (err) {
      setRatingError(getErrorMessage(err));
    } finally {
      setSubmittingScore(false);
    }
  }

  return (
    <ScrollView style={styles.detailPanel} contentContainerStyle={styles.detailPanelContent}>
      <View style={styles.detailTopRow}>
        <TouchableOpacity onPress={onBack} hitSlop={8} style={styles.backButton}>
          <Text style={styles.backButtonText}>← Geri</Text>
        </TouchableOpacity>
        <View style={styles.categoryBadge}>
          <CategoryIcon
            category={poi.category}
            size={12}
            color={colors.accentPressed}
          />
          <Text style={styles.categoryBadgeText}>{getCategoryLabel(poi.category)}</Text>
        </View>
      </View>

      <Text style={styles.detailName}>{poi.name}</Text>

      <View style={styles.detailMetaRow}>
        <Text style={styles.detailMeta}>📍 {regionLabel}</Text>
        <Text style={styles.detailMeta}>
          ⭐ {averageRating === null ? '—' : averageRating.toFixed(1)}
        </Text>
      </View>

      {poi.description?.trim() ? (
        <Text style={styles.detailDescription} numberOfLines={3}>
          {poi.description.trim()}
        </Text>
      ) : null}

      <View style={styles.detailActions}>
        {poi.phone ? (
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => Linking.openURL(`tel:${poi.phone}`)}
          >
            <Text style={styles.actionButtonText}>📞 Zəng et</Text>
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
      </View>

      <Text style={styles.ratingPrompt}>⭐ Reytinq ver</Text>
      <View style={styles.starRow}>
        {[1, 2, 3, 4, 5].map((score) => {
          const filled = (userScore ?? 0) >= score;
          return (
            <TouchableOpacity
              key={score}
              onPress={() => handleSubmitScore(score)}
              disabled={submittingScore}
              hitSlop={6}
            >
              <Text style={[styles.starButton, filled && styles.starButtonFilled]}>
                {filled ? '⭐' : '☆'}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {ratingError ? <Text style={styles.ratingError}>{ratingError}</Text> : null}
    </ScrollView>
  );
}

function PoiListCard({
  item,
  highlighted,
  dimmed,
  userLocation,
  onPress,
}: {
  item: PoiListItem;
  highlighted: boolean;
  dimmed?: boolean;
  userLocation: { latitude: number; longitude: number } | null;
  onPress: () => void;
}) {
  const distanceLabel = userLocation
    ? calculateDistance(
        userLocation.latitude,
        userLocation.longitude,
        item.lat,
        item.lng
      )
    : null;

  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.card,
        highlighted && styles.cardHighlighted,
        dimmed && styles.cardDimmed,
      ]}
    >
      <View style={styles.cardEmojiWrap}>
        <CategoryIcon
          category={item.category}
          size={15}
          color={highlighted ? colors.accentPressed : colors.text}
        />
      </View>

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
            {distanceLabel ? (
              <Text style={styles.distanceText}>{distanceLabel}</Text>
            ) : null}
          </View>
        </View>

        <Text style={styles.cardCategory} numberOfLines={1}>
          {getCategoryLabel(item.category)}
        </Text>
      </View>
    </Pressable>
  );
}

const MemoPoiListCard = memo(PoiListCard);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  mapPane: {
    flex: 1,
    position: 'relative',
  },
  map: {
    ...StyleSheet.absoluteFill,
  },
  mapFilterStack: {
    position: 'absolute',
    left: 10,
    bottom: 10,
    zIndex: 20,
    gap: 6,
  },
  mapIconButton: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSoft,
  },
  mapIconButtonActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  pickerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-end',
  },
  pickerSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '65%',
    paddingBottom: 20,
  },
  pickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  pickerTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  pickerClose: {
    fontSize: 16,
    color: colors.textMuted,
    fontWeight: '600',
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.chip,
  },
  pickerRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    minWidth: 0,
  },
  pickerRowLabel: {
    fontSize: 13,
    color: colors.text,
    fontWeight: '500',
  },
  pickerCheck: {
    fontSize: 14,
    color: colors.accent,
    fontWeight: '700',
  },
  userMarker: {
    alignItems: 'center',
  },
  userMarkerDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.accent,
    borderWidth: 2,
    borderColor: colors.surface,
  },
  userMarkerLabel: {
    marginTop: 3,
    fontSize: 9,
    fontWeight: '600',
    color: colors.accentPressed,
    backgroundColor: colors.accentSoft,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
    overflow: 'hidden',
  },
  poiMarkerBubble: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 3,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  poiMarkerBubbleHighlighted: {
    borderColor: colors.accent,
    borderWidth: 2,
    backgroundColor: colors.accentSoft,
    transform: [{ scale: 1.2 }],
  },
  poiMarkerBubbleDimmed: {
    opacity: 0.4,
    borderColor: colors.border,
  },
  poiMarkerBubbleAdmin: {
    borderColor: colors.danger,
    borderStyle: 'dashed',
  },
  adminBadge: {
    position: 'absolute',
    top: 48,
    alignSelf: 'center',
    backgroundColor: 'rgba(220, 38, 38, 0.88)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    zIndex: 5,
  },
  adminBadgeText: {
    color: colors.textOnAccent,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  poiMarkerEmoji: {
    fontSize: 14,
  },
  poiMarkerEmojiSelected: {
    fontSize: 16,
  },
  detailPanel: {
    flex: 1,
  },
  detailPanelContent: {
    paddingHorizontal: 12,
    paddingBottom: 16,
  },
  detailTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  backButton: {
    paddingVertical: 2,
    paddingRight: 6,
  },
  backButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.accent,
  },
  categoryBadge: {
    backgroundColor: colors.accentSoft,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  categoryBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.accentPressed,
  },
  detailName: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 6,
  },
  detailMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  detailMeta: {
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  detailDescription: {
    fontSize: 12,
    lineHeight: 17,
    color: colors.textSecondary,
    marginBottom: 12,
  },
  detailActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 12,
  },
  actionButton: {
    backgroundColor: colors.chip,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  actionButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.text,
  },
  ratingPrompt: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.chipText,
    marginBottom: 6,
  },
  starRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  starButton: {
    fontSize: 22,
    color: colors.border,
  },
  starButtonFilled: {
    color: colors.warning,
  },
  ratingError: {
    marginTop: 6,
    fontSize: 11,
    color: colors.dangerText,
  },
  shareHeaderButton: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  profileCorner: {
    position: 'absolute',
    top: 10,
    right: 10,
    zIndex: 12,
  },
  locateButton: {
    position: 'absolute',
    bottom: 10,
    right: 10,
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSoft,
    zIndex: 10,
  },
  listPane: {
    flex: 1,
    backgroundColor: colors.surface,
    paddingTop: 4,
  },
  listHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    marginBottom: 4,
  },
  listTitle: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
    marginRight: 8,
  },
  listContent: {
    paddingHorizontal: 10,
    paddingBottom: 12,
  },
  card: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bg,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 6,
    marginBottom: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSoft,
  },
  cardHighlighted: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent,
    borderWidth: 1,
  },
  cardDimmed: {
    opacity: 0.45,
  },
  cardEmojiWrap: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: colors.chip,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardEmoji: {
    fontSize: 15,
  },
  cardBody: {
    flex: 1,
    marginLeft: 8,
    justifyContent: 'center',
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  cardName: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  cardMetaRight: {
    alignItems: 'flex-end',
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  ratingStar: {
    fontSize: 10,
    color: colors.warning,
  },
  ratingText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.chipText,
  },
  distanceText: {
    marginTop: 1,
    fontSize: 10,
    color: colors.textMuted,
    fontWeight: '500',
  },
  cardCategory: {
    marginTop: 1,
    fontSize: 11,
    color: colors.textMuted,
  },
  loader: {
    marginTop: 20,
  },
  errorText: {
    marginHorizontal: 12,
    color: colors.dangerText,
    fontSize: 12,
  },
  emptyWrap: {
    alignItems: 'center',
    marginTop: 20,
    paddingHorizontal: 20,
  },
  emptyTitle: {
    color: colors.chipText,
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  emptySubtitle: {
    marginTop: 4,
    color: colors.textMuted,
    fontSize: 12,
    textAlign: 'center',
  },
});
