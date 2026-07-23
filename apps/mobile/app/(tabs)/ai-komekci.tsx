import * as Location from 'expo-location';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import MapView, {
  Marker,
  Polyline,
  PROVIDER_GOOGLE,
  type MapPressEvent,
  type PoiClickEvent,
  type Region as MapRegion,
} from '../../components/AppMap';
import { CategoryIcon } from '../../components/CategoryIcon';
import { DropdownButton } from '../../components/DropdownButton';
import { ProfileCornerButton } from '../../components/ProfileCornerButton';
import { ResizableSplit } from '../../components/ResizableSplit';
import { ShareAsTourModal } from '../../components/ShareAsTourModal';
import { useInfoToast } from '../../components/InfoToastProvider';
import { REGIONS } from '../../constants/regions';
import { getErrorMessage } from '../../lib/errors';
import { saveRoute, manualStopsToSavedStops } from '../../lib/savedRoutes';
import {
  POI_PAGE_SIZE,
  createManualStop,
  formatOriginToFirstLeg,
  haversineKm,
  insertStopAfter,
  manualStopsToNavStops,
  manualStopsToShareRoute,
  maxRouteStops,
  moveStop,
  removeStop,
  replaceStopAt,
  stopsToPolyline,
  type ManualStop,
} from '../../lib/manualRoute';
import {
  fetchLivePlaces,
  livePlaceToPoi,
  mergeLivePlacesById,
  radiusMetersFromLongitudeDelta,
  viewportTileKey,
} from '../../lib/livePlaces';
import { openRouteInGoogleMaps } from '../../lib/openNavigation';
import { shareRouteText } from '../../lib/shareRoute';
import { supabase } from '../../lib/supabase';
import type { Poi } from '../../types/database';

import { colors } from '../../constants/theme';

type LatLng = { latitude: number; longitude: number };

type MapRef = {
  animateToRegion: (region: MapRegion, duration?: number) => void;
  fitToCoordinates: (
    coordinates: LatLng[],
    options?: {
      edgePadding?: { top: number; right: number; bottom: number; left: number };
      animated?: boolean;
    }
  ) => void;
};

type RegionPoi = Pick<Poi, 'id' | 'name' | 'category' | 'lat' | 'lng' | 'region'>;

type EditMode =
  | { type: 'append' }
  | { type: 'insert'; afterIndex: number }
  | { type: 'replace'; index: number };

const REGION_OPTIONS = REGIONS.map((r) => ({ label: r.label, value: r.id }));

export default function AiKomekciScreen() {
  const mapRef = useRef<MapRef | null>(null);
  const { showInfo } = useInfoToast();
  /** Google POI klikindən sonra onPress də gələ bilər — ikiqat əlavənin qarşısı. */
  const lastPoiClickAt = useRef(0);
  const viewportFetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadedViewportTiles = useRef<Set<string>>(new Set());
  const viewportFetchGen = useRef(0);

  const [selectedRegion, setSelectedRegion] = useState<string | null>(null);
  const [routeStops, setRouteStops] = useState<ManualStop[]>([]);
  const [regionPois, setRegionPois] = useState<RegionPoi[]>([]);
  const [loadingPois, setLoadingPois] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [poiPage, setPoiPage] = useState(1);
  const [editMode, setEditMode] = useState<EditMode>({ type: 'append' });
  const [error, setError] = useState<string | null>(null);
  const [fromOrigin, setFromOrigin] = useState(false);
  const [userLocation, setUserLocation] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [mapSize, setMapSize] = useState<{ width: number; height: number } | null>(null);
  /** Custom marker-lər üçün — false olanda Android-də çoxu görünməz qalır. */
  const [tracksMarkers, setTracksMarkers] = useState(true);
  const [savingRoute, setSavingRoute] = useState(false);
  const [shareTourVisible, setShareTourVisible] = useState(false);

  const regionMeta = useMemo(
    () => REGIONS.find((r) => r.id === selectedRegion) ?? null,
    [selectedRegion]
  );
  const regionLabel = regionMeta?.label ?? selectedRegion ?? 'Region';
  const stopLimit = maxRouteStops(fromOrigin);

  const filteredPois = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) {
      return regionPois;
    }
    return regionPois.filter((p) => p.name.toLowerCase().includes(q));
  }, [regionPois, searchQuery]);

  const visiblePois = useMemo(
    () => filteredPois.slice(0, poiPage * POI_PAGE_SIZE),
    [filteredPois, poiPage]
  );
  const hasMorePois = visiblePois.length < filteredPois.length;

  const polylineCoords = useMemo(() => stopsToPolyline(routeStops), [routeStops]);

  const originLegHint = useMemo(() => {
    if (!fromOrigin || !userLocation || routeStops.length === 0) {
      return null;
    }
    return formatOriginToFirstLeg(
      { lat: userLocation.latitude, lng: userLocation.longitude },
      routeStops[0]
    );
  }, [fromOrigin, userLocation, routeStops]);

  const loadRegionPoisFromDb = useCallback(async (regionId: string): Promise<RegionPoi[]> => {
    const { data, error: fetchError } = await supabase
      .from('pois')
      .select('id, name, category, lat, lng, region')
      .eq('region', regionId)
      .eq('status', 'approved')
      .neq('category', 'cafe')
      .order('name');

    if (fetchError) {
      throw fetchError;
    }
    return (data as RegionPoi[]) ?? [];
  }, []);

  const loadRegionPois = useCallback(async (regionId: string) => {
    setLoadingPois(true);
    setError(null);
    loadedViewportTiles.current = new Set();
    viewportFetchGen.current += 1;
    try {
      const live = await fetchLivePlaces(regionId, { limit: 60 });
      if (live && live.places.length > 0) {
        const mapped: RegionPoi[] = live.places.map((place) => {
          const poi = livePlaceToPoi(place, regionId);
          return {
            id: poi.id,
            name: poi.name,
            category: poi.category,
            lat: poi.lat,
            lng: poi.lng,
            region: poi.region,
          };
        });
        setRegionPois(mapped);
        return;
      }

      setRegionPois(await loadRegionPoisFromDb(regionId));
    } catch (err) {
      setError(getErrorMessage(err));
      setRegionPois([]);
    } finally {
      setLoadingPois(false);
    }
  }, [loadRegionPoisFromDb]);

  const fetchViewportPois = useCallback(
    (region: MapRegion) => {
      if (!selectedRegion) return;
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

          const live = await fetchLivePlaces(selectedRegion, {
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

          const incoming: RegionPoi[] = live.places.map((place) => {
            const poi = livePlaceToPoi(place, selectedRegion);
            return {
              id: poi.id,
              name: poi.name,
              category: poi.category,
              lat: poi.lat,
              lng: poi.lng,
              region: poi.region,
            };
          });
          setRegionPois((prev) => mergeLivePlacesById(prev, incoming));
        })();
      }, 650);
    },
    [selectedRegion]
  );

  useEffect(() => {
    if (!selectedRegion || !regionMeta) {
      return;
    }
    void loadRegionPois(selectedRegion);
    mapRef.current?.animateToRegion(
      {
        latitude: regionMeta.latitude,
        longitude: regionMeta.longitude,
        latitudeDelta: regionMeta.latitudeDelta,
        longitudeDelta: regionMeta.longitudeDelta,
      },
      400
    );
  }, [selectedRegion, regionMeta, loadRegionPois]);

  useEffect(() => {
    return () => {
      if (viewportFetchTimer.current) {
        clearTimeout(viewportFetchTimer.current);
      }
    };
  }, []);

  // Marker custom view — qısa müddət tracksViewChanges=true ki, hamısı çəkilsin
  useEffect(() => {
    setTracksMarkers(true);
    const t = setTimeout(() => setTracksMarkers(false), 600);
    return () => clearTimeout(t);
  }, [routeStops, fromOrigin, userLocation]);

  async function enableFromOrigin(next: boolean) {
    if (!next) {
      setFromOrigin(false);
      return;
    }
    // Switch dərhal açılsın — GPS arxa planda, xəritə zoom dəyişməsin
    setFromOrigin(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'İcazə lazımdır',
          'Cari məkandan başlamaq üçün məkan icazəsi verin.'
        );
        setFromOrigin(false);
        return;
      }
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setUserLocation({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      });
      if (routeStops.length > maxRouteStops(true)) {
        Alert.alert(
          'Limit',
          `Cari məkan aktiv olanda ən çox ${maxRouteStops(true)} dayandırma tövsiyə olunur.`
        );
      }
    } catch (err) {
      Alert.alert('Məkan', getErrorMessage(err));
      setFromOrigin(false);
    }
  }

  function handleSelectRegion(value: string) {
    setSelectedRegion(value);
    setRouteStops([]);
    setSearchQuery('');
    setPoiPage(1);
    setEditMode({ type: 'append' });
    setError(null);
  }

  function handleSearchChange(text: string) {
    setSearchQuery(text);
    setPoiPage(1);
  }

  function canAddMore(replacing: boolean): boolean {
    if (replacing) {
      return true;
    }
    if (routeStops.length >= stopLimit) {
      Alert.alert(
        'Limit',
        fromOrigin
          ? `Cari məkan + ən çox ${stopLimit} dayandırma (naviqasiya limiti).`
          : `Naviqasiya üçün ən çox ${stopLimit} nöqtə tövsiyə olunur.`
      );
      return false;
    }
    return true;
  }

  function applyStop(stop: ManualStop) {
    setRouteStops((current) => {
      if (editMode.type === 'replace') {
        return replaceStopAt(current, editMode.index, stop);
      }
      const limit = maxRouteStops(fromOrigin);
      if (editMode.type === 'insert') {
        if (current.length >= limit) {
          return current;
        }
        return insertStopAfter(current, editMode.afterIndex, stop);
      }
      if (current.length >= limit) {
        return current;
      }
      return [...current, stop];
    });
    setEditMode({ type: 'append' });
  }

  function addPoiStop(poi: RegionPoi) {
    if (!canAddMore(editMode.type === 'replace')) {
      return;
    }
    if (editMode.type !== 'replace' && routeStops.some((s) => s.id === poi.id)) {
      Alert.alert('Artıq əlavə olunub', 'Bu yer marşrutda var.');
      return;
    }
    applyStop(
      createManualStop({
        poiId: poi.id,
        name: poi.name,
        lat: poi.lat,
        lng: poi.lng,
        category: poi.category,
        source: 'poi',
      })
    );
  }

  function addNamedPlace(input: {
    name: string;
    lat: number;
    lng: number;
    placeId?: string;
    category?: string;
  }) {
    if (!selectedRegion) {
      Alert.alert('Region seçin', 'Əvvəlcə region seçin.');
      return;
    }
    if (!canAddMore(editMode.type === 'replace')) {
      return;
    }

    const name = input.name.trim() || 'Seçilmiş yer';
    const stopId = input.placeId ? `gmap_${input.placeId}` : undefined;

    if (
      editMode.type !== 'replace' &&
      stopId &&
      routeStops.some((s) => s.id === stopId)
    ) {
      Alert.alert('Artıq əlavə olunub', `"${name}" marşrutda var.`);
      return;
    }

    // Eyni ada yaxın TripPoint POI varsa onu üstün tut
    const nearDb = findNearestPoi(regionPois, input.lat, input.lng, 0.15);
    if (nearDb && namesSimilar(nearDb.name, name)) {
      addPoiStop(nearDb);
      return;
    }

    applyStop(
      createManualStop({
        poiId: stopId,
        name,
        lat: input.lat,
        lng: input.lng,
        category: input.category ?? 'other',
        source: 'map',
      })
    );
  }

  function addMapPin(lat: number, lng: number) {
    if (!selectedRegion) {
      Alert.alert('Region seçin', 'Əvvəlcə region seçin.');
      return;
    }
    if (!canAddMore(editMode.type === 'replace')) {
      return;
    }
    const n = routeStops.length + 1;
    applyStop(
      createManualStop({
        name: `Nöqtə ${n}`,
        lat,
        lng,
        category: 'other',
        source: 'map',
      })
    );
  }

  /** Google xəritə obyekti (otel, restoran, kafe və s.) */
  function handleGooglePoiClick(event: PoiClickEvent) {
    lastPoiClickAt.current = Date.now();
    const { placeId, name, coordinate } = event.nativeEvent;
    if (!coordinate) {
      return;
    }
    addNamedPlace({
      name: name?.trim() || 'Seçilmiş yer',
      lat: coordinate.latitude,
      lng: coordinate.longitude,
      placeId: placeId || undefined,
    });
  }

  function handleMapPress(event: MapPressEvent) {
    // POI klikindən dərhal sonra gələn boş basmanı ignore et
    if (Date.now() - lastPoiClickAt.current < 500) {
      return;
    }
    const { latitude, longitude } = event.nativeEvent.coordinate;
    // Əvvəl DB-dəki yaxın TripPoint POI
    const near = findNearestPoi(regionPois, latitude, longitude, 0.2);
    if (near) {
      Alert.alert(near.name, 'Bu yeri marşruta əlavə edək?', [
        { text: 'Ləğv et', style: 'cancel' },
        { text: 'Əlavə et', onPress: () => addPoiStop(near) },
        { text: 'Boş nöqtə', onPress: () => addMapPin(latitude, longitude) },
      ]);
      return;
    }
    // Boş ərazi — adsız pin
    addMapPin(latitude, longitude);
  }

  function handleClear() {
    Alert.alert('Marşrutu təmizlə', 'Bütün nöqtələr silinsin?', [
      { text: 'Ləğv et', style: 'cancel' },
      {
        text: 'Təmizlə',
        style: 'destructive',
        onPress: () => {
          setRouteStops([]);
          setEditMode({ type: 'append' });
        },
      },
    ]);
  }

  async function handleShare() {
    if (routeStops.length === 0) {
      Alert.alert('Boş marşrut', 'Ən azı bir nöqtə əlavə edin.');
      return;
    }
    try {
      await shareRouteText(
        manualStopsToShareRoute(routeStops, regionLabel, {
          fromOrigin,
          legHint: originLegHint,
        }),
        regionLabel
      );
    } catch (err) {
      Alert.alert('Paylaşım', getErrorMessage(err));
    }
  }

  async function handleSaveRoute() {
    if (routeStops.length === 0) {
      Alert.alert('Boş marşrut', 'Ən azı bir nöqtə əlavə edin.');
      return;
    }
    setSavingRoute(true);
    try {
      const title = `${regionLabel} · ${routeStops.length} nöqtə`;
      const result = await saveRoute({
        source: 'manual',
        title,
        summary: fromOrigin
          ? `Cari məkandan · ${routeStops.map((s) => s.name).join(' → ')}`
          : routeStops.map((s) => s.name).join(' → '),
        region: selectedRegion,
        daysCount: 1,
        fromOrigin,
        originLat: fromOrigin ? userLocation?.latitude ?? null : null,
        originLng: fromOrigin ? userLocation?.longitude ?? null : null,
        stops: manualStopsToSavedStops(routeStops),
      });
      if (result.error) {
        Alert.alert('Yadda saxla', result.error);
        return;
      }
      showInfo('Yadda saxlandı · Sevimlilər → Marşrutlar');
    } catch (err) {
      Alert.alert('Yadda saxla', getErrorMessage(err));
    } finally {
      setSavingRoute(false);
    }
  }

  async function handleNavigate() {
    if (routeStops.length === 0) {
      Alert.alert('Naviqasiya', 'Əvvəlcə ən azı bir yer seçin.');
      return;
    }
    if (fromOrigin) {
      if (!userLocation) {
        Alert.alert('Məkan', 'Cari məkan tapılmadı. Switch-i yenidən yandırın.');
        return;
      }
    } else if (routeStops.length < 2) {
      Alert.alert('Naviqasiya', 'Ən azı 2 nöqtə lazımdır (və ya cari məkandan başla).');
      return;
    }

    try {
      const origin =
        fromOrigin && userLocation
          ? {
              lat: userLocation.latitude,
              lng: userLocation.longitude,
              name: 'Mənim yerim',
            }
          : null;
      await openRouteInGoogleMaps(manualStopsToNavStops(routeStops, origin), {
        startNavigation: false,
      });
    } catch (err) {
      Alert.alert('Naviqasiya', getErrorMessage(err));
    }
  }

  const editHint =
    editMode.type === 'insert'
      ? `${editMode.afterIndex + 1}-dən sonra insert — yer seçin`
      : editMode.type === 'replace'
        ? `${editMode.index + 1}-ci nöqtəni əvəz et — yer seçin`
        : null;

  const canNavigate =
    routeStops.length >= 2 || (fromOrigin && !!userLocation && routeStops.length >= 1);

  const listHeader = (
    <View style={styles.headerBlock}>
      <Text style={styles.title}>Marşrut qur</Text>
      <Text style={styles.subtitle}>
        Region seç → axtar, siyahıdan və ya xəritədə yerə toxun
      </Text>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {editHint ? (
        <TouchableOpacity
          onPress={() => setEditMode({ type: 'append' })}
          style={styles.editHintBox}
        >
          <Text style={styles.editHint}>{editHint}</Text>
          <Text style={styles.editHintCancel}>Ləğv</Text>
        </TouchableOpacity>
      ) : null}

      <DropdownButton
        label="Region"
        value={selectedRegion}
        options={REGION_OPTIONS}
        onSelect={handleSelectRegion}
      />

      <View style={styles.fromOriginRow}>
        <View style={styles.fromOriginTextWrap}>
          <Text style={styles.fromOriginLabel}>Cari məkandan gedirəm</Text>
          <Text style={styles.fromOriginHint}>
            Marşrut olduğun yerdən 1-ci nöqtəyə başlayır
          </Text>
        </View>
        <Switch
          value={fromOrigin}
          onValueChange={(v) => void enableFromOrigin(v)}
          trackColor={{ false: colors.chip, true: colors.accentSoft }}
          thumbColor={fromOrigin ? colors.accent : colors.textMuted}
        />
      </View>

      {fromOrigin && originLegHint ? (
        <Text style={styles.legHint}>{originLegHint}</Text>
      ) : null}
      {fromOrigin && routeStops.length === 0 ? (
        <Text style={styles.hint}>Əvvəlcə regionda ən azı 1 yer seçin.</Text>
      ) : null}

      {!selectedRegion ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyTitle}>Region seçin</Text>
          <Text style={styles.emptyBody}>
            Sonra axtarış və ya xəritə ilə nöqtə əlavə edin.
          </Text>
        </View>
      ) : (
        <>
          <View style={styles.searchRow}>
            <Ionicons name="search-outline" size={16} color={colors.textMuted} />
            <TextInput
              style={styles.searchInput}
              value={searchQuery}
              onChangeText={handleSearchChange}
              placeholder="Yer axtar..."
              placeholderTextColor={colors.textMuted}
              autoCorrect={false}
              returnKeyType="search"
            />
            {searchQuery ? (
              <TouchableOpacity onPress={() => handleSearchChange('')} hitSlop={8}>
                <Ionicons name="close-circle" size={16} color={colors.textMuted} />
              </TouchableOpacity>
            ) : null}
          </View>

          <Text style={styles.sectionLabel}>
            Nöqtələr ({routeStops.length}/{stopLimit})
          </Text>

          {routeStops.length === 0 ? (
            <Text style={styles.hint}>Aşağıdan yer seçin və ya xəritəyə toxunun.</Text>
          ) : (
            routeStops.map((stop, index) => (
              <View key={stop.id} style={styles.stopRow}>
                <View style={styles.stopIndex}>
                  <Text style={styles.stopIndexText}>{index + 1}</Text>
                </View>
                <View style={styles.stopBody}>
                  <Text style={styles.stopName} numberOfLines={1}>
                    {stop.name}
                  </Text>
                  <Text style={styles.stopMeta} numberOfLines={1}>
                    {stop.source === 'map' ? 'Xəritə' : 'POI'}
                  </Text>
                </View>
                <View style={styles.stopActions}>
                  <TouchableOpacity
                    hitSlop={6}
                    disabled={index === 0}
                    onPress={() => setRouteStops((s) => moveStop(s, index, index - 1))}
                  >
                    <Ionicons
                      name="chevron-up"
                      size={18}
                      color={index === 0 ? colors.border : colors.text}
                    />
                  </TouchableOpacity>
                  <TouchableOpacity
                    hitSlop={6}
                    disabled={index === routeStops.length - 1}
                    onPress={() => setRouteStops((s) => moveStop(s, index, index + 1))}
                  >
                    <Ionicons
                      name="chevron-down"
                      size={18}
                      color={
                        index === routeStops.length - 1 ? colors.border : colors.text
                      }
                    />
                  </TouchableOpacity>
                  <TouchableOpacity
                    hitSlop={6}
                    onPress={() => setEditMode({ type: 'insert', afterIndex: index })}
                  >
                    <Ionicons
                      name="add-circle-outline"
                      size={18}
                      color={
                        editMode.type === 'insert' && editMode.afterIndex === index
                          ? colors.accent
                          : colors.textSecondary
                      }
                    />
                  </TouchableOpacity>
                  <TouchableOpacity
                    hitSlop={6}
                    onPress={() => setEditMode({ type: 'replace', index })}
                  >
                    <Ionicons
                      name="swap-horizontal-outline"
                      size={18}
                      color={
                        editMode.type === 'replace' && editMode.index === index
                          ? colors.accent
                          : colors.textSecondary
                      }
                    />
                  </TouchableOpacity>
                  <TouchableOpacity
                    hitSlop={6}
                    onPress={() => setRouteStops((s) => removeStop(s, stop.id))}
                  >
                    <Ionicons name="trash-outline" size={16} color={colors.danger} />
                  </TouchableOpacity>
                </View>
              </View>
            ))
          )}

          {routeStops.length > 0 ? (
            <>
              <View style={styles.actionRow}>
                <TouchableOpacity
                  style={styles.saveBtn}
                  onPress={() => void handleSaveRoute()}
                  disabled={savingRoute}
                >
                  <Text style={styles.saveBtnText}>
                    {savingRoute ? 'Saxlanır…' : 'Yadda saxla'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.tourShareBtn}
                  onPress={() => setShareTourVisible(true)}
                >
                  <Text style={styles.tourShareBtnText}>Tur kimi paylaş</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.actionRow}>
                <TouchableOpacity style={styles.shareBtn} onPress={() => void handleShare()}>
                  <Text style={styles.shareBtnText}>Paylaş</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.navBtn, !canNavigate && styles.navBtnDisabled]}
                  onPress={() => void handleNavigate()}
                  disabled={!canNavigate}
                >
                  <Text style={styles.navBtnText}>Xəritədə bax</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : null}

          <Text style={styles.sectionLabel}>
            Yerlər
            {filteredPois.length > 0
              ? ` (${Math.min(visiblePois.length, filteredPois.length)}/${filteredPois.length})`
              : ''}
          </Text>
        </>
      )}
    </View>
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ResizableSplit
        storageKey="manual-route-split-v3"
        initialTopRatio={0.5}
        minTopRatio={0.28}
        maxTopRatio={0.72}
        top={
          <View
            style={styles.mapSection}
            onLayout={(e) => {
              const { width, height } = e.nativeEvent.layout;
              if (width > 0 && height > 0) {
                setMapSize((prev) =>
                  prev && prev.width === width && prev.height === height
                    ? prev
                    : { width, height }
                );
              }
            }}
          >
            {mapSize ? (
              <MapView
                key="manual-route-map"
                ref={mapRef as never}
                style={styles.map}
                provider={Platform.OS === 'web' ? undefined : PROVIDER_GOOGLE}
                initialRegion={
                  regionMeta
                    ? {
                        latitude: regionMeta.latitude,
                        longitude: regionMeta.longitude,
                        latitudeDelta: regionMeta.latitudeDelta,
                        longitudeDelta: regionMeta.longitudeDelta,
                      }
                    : {
                        latitude: 40.4093,
                        longitude: 49.8671,
                        latitudeDelta: 2.5,
                        longitudeDelta: 2.5,
                      }
                }
                showsUserLocation={false}
                showsMyLocationButton={false}
                onRegionChangeComplete={
                  selectedRegion
                    ? (region) => {
                        fetchViewportPois(region);
                      }
                    : undefined
                }
                onPress={handleMapPress}
                onPoiClick={handleGooglePoiClick}
              >
                {fromOrigin && userLocation ? (
                  <Marker
                    coordinate={userLocation}
                    title="Mənim yerim"
                    tracksViewChanges={tracksMarkers}
                  >
                    <View style={styles.meMarker}>
                      <View style={styles.meMarkerDot} />
                    </View>
                  </Marker>
                ) : null}

                {routeStops.map((stop, index) => (
                  <Marker
                    key={`stop-${stop.id}-${index}`}
                    coordinate={{ latitude: stop.lat, longitude: stop.lng }}
                    title={`${index + 1}. ${stop.name}`}
                    tracksViewChanges={tracksMarkers}
                  >
                    <View style={styles.stopMarker}>
                      <Text style={styles.stopMarkerText}>{index + 1}</Text>
                    </View>
                  </Marker>
                ))}

                {polylineCoords.length > 1 ? (
                  <Polyline
                    coordinates={
                      fromOrigin && userLocation
                        ? [
                            {
                              latitude: userLocation.latitude,
                              longitude: userLocation.longitude,
                            },
                            ...polylineCoords,
                          ]
                        : polylineCoords
                    }
                    strokeColor={colors.accent}
                    strokeWidth={3}
                  />
                ) : fromOrigin && userLocation && routeStops.length === 1 ? (
                  <Polyline
                    coordinates={[
                      {
                        latitude: userLocation.latitude,
                        longitude: userLocation.longitude,
                      },
                      {
                        latitude: routeStops[0].lat,
                        longitude: routeStops[0].lng,
                      },
                    ]}
                    strokeColor={colors.accent}
                    strokeWidth={3}
                    lineDashPattern={[8, 6]}
                  />
                ) : null}
              </MapView>
            ) : (
              <View style={styles.mapPlaceholder}>
                <Text style={styles.mapPlaceholderText}>Xəritə yüklənir…</Text>
              </View>
            )}

            <ProfileCornerButton style={styles.profileCorner} />

            {routeStops.length > 0 ? (
              <TouchableOpacity style={styles.clearBadge} onPress={handleClear} hitSlop={6}>
                <Text style={styles.clearBadgeText}>Təmizlə</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        }
        bottom={
          <View style={styles.panel}>
            {!selectedRegion ? (
              <View style={styles.panelPad}>{listHeader}</View>
            ) : (
              <FlatList
                data={visiblePois}
                keyExtractor={(item) => item.id}
                style={styles.flex}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
                ListHeaderComponent={listHeader}
                ListEmptyComponent={
                  loadingPois ? (
                    <ActivityIndicator color={colors.accent} style={{ marginVertical: 16 }} />
                  ) : (
                    <Text style={[styles.hint, styles.panelPad]}>
                      Bu regionda yer tapılmadı.
                    </Text>
                  )
                }
                contentContainerStyle={styles.listContent}
                renderItem={({ item }) => {
                  const added = routeStops.some((s) => s.id === item.id);
                  return (
                    <TouchableOpacity
                      style={[styles.poiRow, added && styles.poiRowAdded]}
                      onPress={() => addPoiStop(item)}
                      disabled={added && editMode.type !== 'replace'}
                    >
                      <CategoryIcon
                        category={item.category}
                        size={14}
                        color={colors.text}
                      />
                      <Text style={styles.poiName} numberOfLines={1}>
                        {item.name}
                      </Text>
                      {added ? (
                        <Text style={styles.poiAdded}>✓</Text>
                      ) : (
                        <Ionicons name="add" size={16} color={colors.accent} />
                      )}
                    </TouchableOpacity>
                  );
                }}
                ListFooterComponent={
                  hasMorePois ? (
                    <TouchableOpacity
                      style={styles.moreBtn}
                      onPress={() => setPoiPage((p) => p + 1)}
                    >
                      <Text style={styles.moreBtnText}>Daha çox</Text>
                    </TouchableOpacity>
                  ) : filteredPois.length > POI_PAGE_SIZE ? (
                    <Text style={styles.listEnd}>Hamısı göstərildi</Text>
                  ) : null
                }
                onEndReached={() => {
                  if (hasMorePois) {
                    setPoiPage((p) => p + 1);
                  }
                }}
                onEndReachedThreshold={0.35}
              />
            )}
          </View>
        }
      />
      <ShareAsTourModal
        visible={shareTourVisible}
        onClose={() => setShareTourVisible(false)}
        regionId={selectedRegion}
        defaultTitle={selectedRegion ? `${regionLabel} turu` : undefined}
        stops={routeStops.map((stop) => ({
          name: stop.name,
          lat: stop.lat,
          lng: stop.lng,
          poiId: stop.source === 'poi' ? stop.id : null,
        }))}
      />
    </SafeAreaView>
  );
}

function namesSimilar(a: string, b: string): boolean {
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9əöğçşıüа-яё\s]/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) {
    return false;
  }
  return na === nb || na.includes(nb) || nb.includes(na);
}

function findNearestPoi(
  pois: RegionPoi[],
  lat: number,
  lng: number,
  maxKm: number
): RegionPoi | null {
  let best: RegionPoi | null = null;
  let bestD = maxKm;
  for (const poi of pois) {
    const d = haversineKm(lat, lng, poi.lat, poi.lng);
    if (d < bestD) {
      bestD = d;
      best = poi;
    }
  }
  return best;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safeArea: { flex: 1, backgroundColor: colors.bg },
  mapSection: {
    flex: 1,
    position: 'relative',
    overflow: 'hidden',
    backgroundColor: colors.chip,
    width: '100%',
    height: '100%',
  },
  map: {
    width: '100%',
    height: '100%',
  },
  mapPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.chip,
  },
  mapPlaceholderText: {
    fontSize: 12,
    color: colors.textMuted,
  },
  profileCorner: {
    position: 'absolute',
    top: 10,
    right: 10,
    zIndex: 12,
  },
  clearBadge: {
    position: 'absolute',
    top: 10,
    left: 10,
    zIndex: 12,
    backgroundColor: colors.surface,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSoft,
  },
  clearBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  meMarker: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  meMarkerDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: colors.accent,
    borderWidth: 2,
    borderColor: '#fff',
  },
  stopMarker: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  stopMarkerText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  panel: {
    flex: 1,
    backgroundColor: colors.surface,
    minHeight: 0,
  },
  panelPad: {
    paddingHorizontal: 12,
    paddingTop: 10,
  },
  headerBlock: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 4,
    gap: 8,
  },
  listContent: {
    paddingBottom: 24,
    flexGrow: 1,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: -4,
  },
  errorText: {
    fontSize: 12,
    color: colors.dangerText,
    backgroundColor: colors.dangerSoft,
    padding: 8,
    borderRadius: 8,
  },
  editHint: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    color: colors.accent,
  },
  editHintBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.accentSoft,
    padding: 8,
    borderRadius: 8,
  },
  editHintCancel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  fromOriginRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  fromOriginTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  fromOriginLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  fromOriginHint: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
  },
  legHint: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.accentPressed,
    backgroundColor: colors.accentSoft,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 8,
  },
  emptyBox: {
    marginTop: 8,
    padding: 14,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSoft,
    backgroundColor: colors.bg,
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 4,
  },
  emptyBody: {
    fontSize: 12,
    color: colors.textMuted,
    lineHeight: 17,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSoft,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: colors.bg,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    color: colors.text,
    padding: 0,
  },
  sectionLabel: {
    marginTop: 4,
    fontSize: 12,
    fontWeight: '600',
    color: colors.chipText,
  },
  hint: {
    fontSize: 12,
    color: colors.textMuted,
  },
  stopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 10,
    backgroundColor: colors.bg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSoft,
  },
  stopIndex: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopIndexText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  stopBody: { flex: 1, minWidth: 0 },
  stopName: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  stopMeta: {
    fontSize: 10,
    color: colors.textMuted,
    marginTop: 1,
  },
  stopActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 2,
  },
  saveBtn: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSoft,
  },
  saveBtnText: {
    color: colors.text,
    fontWeight: '700',
    fontSize: 13,
  },
  tourShareBtn: {
    flex: 1.15,
    backgroundColor: colors.successSoft,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.success,
  },
  tourShareBtnText: {
    color: colors.success,
    fontWeight: '700',
    fontSize: 13,
  },
  shareBtn: {
    flex: 1,
    backgroundColor: colors.accent,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  shareBtnText: {
    color: colors.textOnAccent,
    fontWeight: '700',
    fontSize: 13,
  },
  navBtn: {
    flex: 1.2,
    backgroundColor: colors.chipSelected,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  navBtnDisabled: {
    opacity: 0.45,
  },
  navBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 13,
  },
  poiRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSoft,
  },
  poiRowAdded: {
    opacity: 0.45,
  },
  poiName: {
    flex: 1,
    fontSize: 13,
    color: colors.text,
    fontWeight: '500',
  },
  poiAdded: {
    fontSize: 13,
    color: colors.accent,
    fontWeight: '700',
  },
  moreBtn: {
    marginHorizontal: 12,
    marginTop: 10,
    marginBottom: 8,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSoft,
    alignItems: 'center',
    backgroundColor: colors.bg,
  },
  moreBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.accent,
  },
  listEnd: {
    textAlign: 'center',
    fontSize: 11,
    color: colors.textMuted,
    paddingVertical: 10,
  },
});
