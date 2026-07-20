import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
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
} from '../../components/AppMap';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AddPoiModal } from '../../components/AddPoiModal';
import { AdminPoiCategoryModal } from '../../components/AdminPoiCategoryModal';
import { ResizableSplit } from '../../components/ResizableSplit';
import { useToast } from '../../components/Toast';
import { DEFAULT_REGION_ID, REGIONS } from '../../constants/regions';
import {
  insertApprovedPoiFromGoogle,
  updatePoiCoordinates,
  type GoogleMapPoiPayload,
} from '../../lib/adminMap';
import {
  getCategoryEmoji,
  getCategoryLabel,
  type HomeCategoryFilterId,
} from '../../lib/categoryUtils';
import { getErrorMessage } from '../../lib/errors';
import { createDebouncedSyncPlaces } from '../../lib/syncPlaces';
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
  { label: '🗺️ Hamısı', value: null },
  { label: '🍽️ Restoran', value: 'restaurant' },
  { label: '🏨 Otel', value: 'hotel' },
  { label: '🛏️ Hostel', value: 'hostel' },
  { label: '🏠 Ev restoranı', value: 'home_restaurant' },
  { label: '🏡 Qonaq evi', value: 'guesthouse' },
  { label: '🌿 Təbiət', value: 'nature' },
  { label: '💧 Şəlalə', value: 'waterfall' },
  { label: '⛰️ Dağ', value: 'mountain' },
  { label: '🏞️ Göl', value: 'lake' },
  { label: '🏛️ Tarixi', value: 'historical' },
  { label: '🗿 Abidə', value: 'monument' },
  { label: '📍 Digər', value: 'other' },
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
  const { isAdmin } = useIsAdmin();
  const { showToast, ToastHost } = useToast();

  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<HomeCategoryFilterId>('all');
  const [pois, setPois] = useState<PoiListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [highlightedPoiId, setHighlightedPoiId] = useState<string | null>(null);
  const [selectedPoi, setSelectedPoi] = useState<Poi | null>(null);
  const [addPoiVisible, setAddPoiVisible] = useState(false);
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
      return '📍 Yaxınlıqda';
    }

    const locative = selectedRegionId
      ? (REGION_LOCATIVE[selectedRegionId] ?? `${selectedRegion?.label ?? ''}da`)
      : null;

    if (selectedRegionId && categoryFilter === 'all') {
      return `🗺️ ${locative} yerlər`;
    }

    if (selectedRegionId && selectedCategory) {
      return `${getCategoryEmoji(selectedCategory)} ${locative} ${getCategoryLabel(selectedCategory).toLowerCase()}`;
    }

    if (!selectedRegionId && selectedCategory) {
      return `${getCategoryEmoji(selectedCategory)} Yaxınlıqda ${getCategoryLabel(selectedCategory).toLowerCase()}`;
    }

    return '📍 Yaxınlıqda';
  }, [selectedRegionId, categoryFilter, selectedRegion, selectedCategory]);

  const fetchPois = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent === true;
    try {
      if (!silent) {
        setLoading(true);
        setErrorMessage(null);
      }

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
        .order('created_at', { ascending: false });

      if (selectedRegionId) {
        // Region id həmişə lowercase (quba); DB-də köhnə "Quba" olsa belə tapılsın
        query = query.ilike('region', selectedRegionId);
      }

      if (categoryFilter && categoryFilter !== 'all') {
        query = query.eq('category', categoryFilter);
      }

      // Cafe temporarily ignored (low tourism value / noisy OSM tags)
      query = query.neq('category', 'cafe');

      const { data, error } = await query.limit(50);

      if (error) {
        console.log('POI xətası:', JSON.stringify(error));
        if (!silent) {
          setErrorMessage('Xəta: ' + error.message + ' | Kod: ' + error.code);
        }
        return;
      }

      console.log('POI sayı:', data?.length);

      const rows = (data ?? []) as PoiQueryRow[];
      setPois(
        rows.map((poi) => {
          const photos = [...(poi.poi_photos ?? [])]
            .filter((photo) => !('status' in photo) || photo.status === 'approved')
            .sort((a, b) => a.order_index - b.order_index);
          const { poi_photos: _ignored, ...rest } = poi;
          return {
            ...rest,
            photoUrl: photos[0]?.photo_url ?? null,
            averageRating: null,
            ratingCount: 0,
          };
        })
      );
    } catch (err: unknown) {
      console.log('Catch xətası:', err);
      if (!silent) {
        const message = err instanceof Error ? err.message : String(err);
        setErrorMessage('Xəta: ' + message);
      }
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, [selectedRegionId, categoryFilter]);

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

  const fetchPoisRef = useRef(fetchPois);
  fetchPoisRef.current = fetchPois;
  const showToastRef = useRef(showToast);
  showToastRef.current = showToast;

  // Region/filter dəyişəndə arxa fonda API sync; oxuma yenə Supabase-dən.
  useEffect(() => {
    if (!selectedRegionId) {
      return;
    }

    const debounced = createDebouncedSyncPlaces((result) => {
      if (result.ok && result.attempted) {
        // Loading spinner olmadan yenilə — UI donmur
        void fetchPoisRef.current({ silent: true });
        return;
      }
      if (!result.ok && result.attempted && result.error) {
        showToastRef.current('Yeniləmə alınmadı — köhnə siyahı saxlanıldı');
      }
    });

    debounced.schedule(selectedRegionId, categoryFilter);

    return () => {
      debounced.cancel();
    };
  }, [selectedRegionId, categoryFilter]);

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
      console.log('Lokasiya xətası:', err);
    }
  };

  function selectPoi(poi: Poi) {
    setSelectedPoi(poi);
    setHighlightedPoiId(poi.id);
    mapRef.current?.animateToRegion(
      {
        latitude: poi.lat,
        longitude: poi.lng,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      },
      600
    );
  }

  function clearSelectedPoi() {
    setSelectedPoi(null);
    setHighlightedPoiId(null);

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
      setSelectedPoi(null);
    } else {
      setSelectedPoi(poi);
      mapRef.current?.animateToRegion(
        {
          latitude: poi.lat,
          longitude: poi.lng,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        },
        600
      );
    }
  }

  function handleCardPress(poi: PoiListItem) {
    selectPoi(poi);
  }

  async function handleAdminMarkerDragEnd(poiId: string, event: MarkerDragStartEndEvent) {
    if (!isAdmin) {
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

    setPendingGooglePoi({
      placeId: placeId ?? '',
      name: name?.trim() || '',
      latitude: coordinate.latitude,
      longitude: coordinate.longitude,
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
      });

      if (error || !data) {
        showToast(error ?? 'POI əlavə edilmədi');
        return;
      }

      const listItem: PoiListItem = {
        ...data,
        photoUrl: null,
        averageRating: null,
        ratingCount: 0,
      };

      setPois((current) => [listItem, ...current.filter((p) => p.id !== data.id)]);
      setSelectedPoi(data);
      setPendingGooglePoi(null);
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
                onPoiClick={isAdmin ? handleGooglePoiClick : undefined}
                onPress={isAdmin && Platform.OS === 'web' ? handleAdminMapPress : undefined}
              >
                {userLocation ? (
                  <Marker
                    coordinate={userLocation}
                    title="Siz buradasınız"
                    pinColor={colors.accent}
                  >
                    <View style={styles.userMarker}>
                      <View style={styles.userMarkerDot} />
                      <Text style={styles.userMarkerLabel}>Siz buradasınız</Text>
                    </View>
                  </Marker>
                ) : null}

                {pois.map((poi) => (
                  <Marker
                    key={poi.id}
                    coordinate={{ latitude: poi.lat, longitude: poi.lng }}
                    title={poi.name}
                    description={getCategoryLabel(poi.category)}
                    pinColor={isAdmin ? colors.success : undefined}
                    onPress={() => handleMarkerPress(poi)}
                    draggable={isAdmin}
                    onDragStart={
                      isAdmin
                        ? () => {
                            setDraggingPoiId(poi.id);
                          }
                        : undefined
                    }
                    onDragEnd={
                      isAdmin
                        ? (event) => {
                            void handleAdminMarkerDragEnd(poi.id, event);
                          }
                        : undefined
                    }
                    tracksViewChanges={isAdmin ? draggingPoiId === poi.id : false}
                  >
                    {/* Admin sürüşdürmədə custom child ghost marker yaradır — yalnız pin */}
                    {isAdmin ? null : (
                      <View
                        style={[
                          styles.poiMarkerBubble,
                          (selectedPoi?.id === poi.id || highlightedPoiId === poi.id) &&
                            styles.poiMarkerBubbleHighlighted,
                        ]}
                      >
                        <Text
                          style={[
                            styles.poiMarkerEmoji,
                            selectedPoi?.id === poi.id && styles.poiMarkerEmojiSelected,
                          ]}
                        >
                          {getCategoryEmoji(poi.category)}
                        </Text>
                      </View>
                    )}
                  </Marker>
                ))}
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

              <TouchableOpacity
                style={styles.locationDropdown}
                onPress={() => setShowLocationPicker(true)}
              >
                <Text style={styles.dropdownEmoji}>📍</Text>
                <Text style={styles.dropdownLabel} numberOfLines={1}>
                  {locationButtonLabel}
                </Text>
                <Text style={styles.dropdownCaret}>▼</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.categoryDropdown}
                onPress={() => setShowCategoryPicker(true)}
              >
                <Text style={styles.dropdownEmoji}>
                  {selectedCategory ? getCategoryEmoji(selectedCategory) : '🗂️'}
                </Text>
                <Text style={styles.dropdownLabel} numberOfLines={1}>
                  {categoryButtonLabel}
                </Text>
                <Text style={styles.dropdownCaret}>▼</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.addPoiButton}
                onPress={() => setAddPoiVisible(true)}
                accessibilityLabel="Yeni yer əlavə et"
              >
                <Text style={styles.addPoiButtonText}>+</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.locateButton}
                onPress={goToCurrentLocation}
                accessibilityLabel="Cari məkana qayıt"
              >
                <Text style={styles.locateButtonText}>📍</Text>
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
                      <Text style={styles.shareHeaderButton}>📷 Paylaş</Text>
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
                      onScrollToIndexFailed={(info) => {
                        setTimeout(() => {
                          listRef.current?.scrollToIndex({
                            index: info.index,
                            animated: true,
                            viewPosition: 0.1,
                          });
                        }, 100);
                      }}
                      renderItem={({ item }) => (
                        <PoiListCard
                          item={item}
                          highlighted={highlightedPoiId === item.id}
                          userLocation={userLocation}
                          onPress={() => handleCardPress(item)}
                        />
                      )}
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

        <AddPoiModal
          visible={addPoiVisible}
          onClose={() => setAddPoiVisible(false)}
          initialRegionId={selectedRegionId ?? DEFAULT_REGION_ID}
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
                      <Text style={styles.pickerRowLabel}>{option.label}</Text>
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
  const [averageRating, setAverageRating] = useState<number | null>(null);
  const [userScore, setUserScore] = useState<number | null>(null);
  const [submittingScore, setSubmittingScore] = useState(false);
  const [ratingError, setRatingError] = useState<string | null>(null);

  const regionLabel =
    REGIONS.find((region) => region.id === poi.region)?.label ?? poi.region;

  useEffect(() => {
    let active = true;

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
        setAverageRating(null);
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
  }, [poi.id]);

  async function handleSubmitScore(score: number) {
    if (submittingScore) {
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
          <Text style={styles.categoryBadgeText}>
            {getCategoryEmoji(poi.category)} {getCategoryLabel(poi.category)}
          </Text>
        </View>
      </View>

      <Text style={styles.detailName}>
        {getCategoryEmoji(poi.category)} {poi.name}
      </Text>

      <View style={styles.detailMetaRow}>
        <Text style={styles.detailMeta}>📍 {regionLabel}</Text>
        <Text style={styles.detailMeta}>
          ⭐ {averageRating === null ? '—' : averageRating.toFixed(1)}
        </Text>
      </View>

      <Text style={styles.detailDescription} numberOfLines={3}>
        {poi.description?.trim() ? poi.description : 'Təsvir yoxdur'}
      </Text>

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
  userLocation,
  onPress,
}: {
  item: PoiListItem;
  highlighted: boolean;
  userLocation: { latitude: number; longitude: number } | null;
  onPress: () => void;
}) {
  const emoji = getCategoryEmoji(item.category as PoiCategory);
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
      style={[styles.card, highlighted && styles.cardHighlighted]}
    >
      <View style={styles.cardEmojiWrap}>
        <Text style={styles.cardEmoji}>{emoji}</Text>
      </View>

      <View style={styles.cardBody}>
        <View style={styles.cardTopRow}>
          <Text style={styles.cardName} numberOfLines={1}>
            {item.name}
          </Text>
          <View style={styles.cardMetaRight}>
            <View style={styles.ratingRow}>
              <Text style={styles.ratingStar}>⭐</Text>
              <Text style={styles.ratingText}>
                {item.averageRating === null ? '—' : item.averageRating.toFixed(1)}
              </Text>
            </View>
            {distanceLabel ? (
              <Text style={styles.distanceText}>📍{distanceLabel}</Text>
            ) : null}
          </View>
        </View>

        <Text style={styles.cardCategory} numberOfLines={1}>
          {getCategoryLabel(item.category)}
        </Text>
        <Text style={styles.cardDescription} numberOfLines={1}>
          {item.description?.trim() ? item.description : 'Təsvir yoxdur'}
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
  mapPane: {
    flex: 1,
    position: 'relative',
  },
  map: {
    ...StyleSheet.absoluteFill,
  },
  locationDropdown: {
    position: 'absolute',
    top: 12,
    left: 12,
    zIndex: 20,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
    gap: 4,
    maxWidth: 140,
  },
  categoryDropdown: {
    position: 'absolute',
    top: 12,
    right: 60,
    zIndex: 20,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'white',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    elevation: 4,
    gap: 4,
    maxWidth: 140,
  },
  dropdownEmoji: {
    fontSize: 14,
  },
  dropdownLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
    flexShrink: 1,
  },
  dropdownCaret: {
    fontSize: 10,
    color: colors.textSecondary,
  },
  pickerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  pickerSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '70%',
    paddingBottom: 24,
  },
  pickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  pickerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
  },
  pickerClose: {
    fontSize: 18,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.chip,
  },
  pickerRowLabel: {
    fontSize: 14,
    color: colors.text,
    fontWeight: '500',
  },
  pickerCheck: {
    fontSize: 16,
    color: colors.accent,
    fontWeight: '700',
  },
  userMarker: {
    alignItems: 'center',
  },
  userMarkerDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.accent,
    borderWidth: 3,
    borderColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.3,
    shadowRadius: 2,
    elevation: 4,
  },
  userMarkerLabel: {
    marginTop: 4,
    fontSize: 10,
    fontWeight: '700',
    color: colors.accentPressed,
    backgroundColor: colors.accentSoft,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    overflow: 'hidden',
  },
  poiMarkerBubble: {
    backgroundColor: 'white',
    borderRadius: 20,
    padding: 4,
    borderWidth: 1,
    borderColor: '#ddd',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    elevation: 3,
  },
  poiMarkerBubbleHighlighted: {
    borderColor: colors.accent,
    borderWidth: 2,
    transform: [{ scale: 1.25 }],
  },
  poiMarkerBubbleAdmin: {
    borderColor: colors.danger,
    borderStyle: 'dashed',
  },
  adminBadge: {
    position: 'absolute',
    top: 56,
    alignSelf: 'center',
    backgroundColor: 'rgba(220, 38, 38, 0.92)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    zIndex: 5,
  },
  adminBadgeText: {
    color: colors.textOnAccent,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  poiMarkerEmoji: {
    fontSize: 18,
  },
  poiMarkerEmojiSelected: {
    fontSize: 22,
  },
  detailPanel: {
    flex: 1,
  },
  detailPanelContent: {
    paddingHorizontal: 14,
    paddingBottom: 20,
  },
  detailTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  backButton: {
    paddingVertical: 4,
    paddingRight: 8,
  },
  backButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.accent,
  },
  categoryBadge: {
    backgroundColor: colors.accentSoft,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  categoryBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.accentPressed,
  },
  detailName: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 8,
  },
  detailMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 10,
  },
  detailMeta: {
    fontSize: 13,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  detailDescription: {
    fontSize: 13,
    lineHeight: 19,
    color: colors.textSecondary,
    marginBottom: 14,
  },
  detailActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  actionButton: {
    backgroundColor: colors.chip,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  actionButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  ratingPrompt: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.chipText,
    marginBottom: 8,
  },
  starRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  starButton: {
    fontSize: 28,
    color: colors.border,
  },
  starButtonFilled: {
    color: '#F59E0B',
  },
  ratingError: {
    marginTop: 8,
    fontSize: 12,
    color: colors.dangerText,
  },
  shareHeaderButton: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
  },
  addPoiButton: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.accent,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    elevation: 5,
    zIndex: 10,
  },
  addPoiButtonText: {
    color: 'white',
    fontSize: 24,
    fontWeight: 'bold',
    lineHeight: 28,
  },
  locateButton: {
    position: 'absolute',
    bottom: 12,
    right: 12,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'white',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    elevation: 5,
    zIndex: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  locateButtonText: {
    fontSize: 20,
  },
  listPane: {
    flex: 1,
    backgroundColor: colors.surface,
    paddingTop: 8,
  },
  listHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    marginBottom: 8,
  },
  listTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
    marginRight: 8,
  },
  listContent: {
    paddingHorizontal: 12,
    paddingBottom: 16,
  },
  card: {
    height: 80,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 3,
    borderRadius: 24,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 8,
  },
  cardHighlighted: {
    backgroundColor: colors.accentSoft,
  },
  cardEmojiWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.chip,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardEmoji: {
    fontSize: 32,
  },
  cardBody: {
    flex: 1,
    marginLeft: 10,
    justifyContent: 'center',
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  cardName: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
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
    fontSize: 11,
  },
  ratingText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.chipText,
  },
  distanceText: {
    marginTop: 2,
    fontSize: 11,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  cardCategory: {
    marginTop: 2,
    fontSize: 12,
    color: colors.textSecondary,
  },
  cardDescription: {
    marginTop: 2,
    fontSize: 12,
    color: colors.textMuted,
  },
  loader: {
    marginTop: 24,
  },
  errorText: {
    marginHorizontal: 14,
    color: colors.dangerText,
    fontSize: 13,
  },
  emptyWrap: {
    alignItems: 'center',
    marginTop: 24,
    paddingHorizontal: 24,
  },
  emptyTitle: {
    color: colors.chipText,
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  emptySubtitle: {
    marginTop: 6,
    color: colors.textMuted,
    fontSize: 13,
    textAlign: 'center',
  },
});
