import Constants from 'expo-constants';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import MapView, {
  Marker,
  Polyline,
  PROVIDER_GOOGLE,
  type Region as MapRegion,
} from '../../components/AppMap';
import { DropdownButton } from '../../components/DropdownButton';
import { ProfileCornerButton } from '../../components/ProfileCornerButton';
import { ResizableSplit } from '../../components/ResizableSplit';
import { getCategoryEmoji } from '../../lib/categoryUtils';
import { getErrorMessage } from '../../lib/errors';
import { collectRouteStops, openRouteInGoogleMaps } from '../../lib/openNavigation';
import { fetchRouteCandidates } from '../../lib/routeCandidates';
import { planRoute as requestPlanRoute } from '../../lib/planRoute';
import { shareRouteText } from '../../lib/shareRoute';
import { supabase } from '../../lib/supabase';
import {
  applyWeatherPoiFilter,
  fetchRegionWeather,
  type WeatherAdvice,
} from '../../lib/weather';
import {
  optimizeRouteAndTimeline,
  parseDurationHours,
  type POI,
} from '../../utils/routeOptimizer';

import { colors } from '../../constants/theme';

const DAY_COLORS = [colors.accent, colors.success, colors.warning, colors.accentPressed, colors.danger];

/** Distinct colors per leg A→B, B→C, … (high contrast on map tiles) */
const SEGMENT_COLORS = [
  '#E85D04',
  '#9B5DE5',
  '#00A8E8',
  '#F15BB5',
  '#2EC4B6',
  '#EF233C',
  '#4361EE',
  '#F77F00',
];

const REGION_COORDS: Record<string, { latitude: number; longitude: number }> = {
  quba: { latitude: 41.3625, longitude: 48.5128 },
  qusar: { latitude: 41.601, longitude: 48.4295 },
  seki: { latitude: 41.1997, longitude: 47.1706 },
  lerik: { latitude: 38.7736, longitude: 48.415 },
  qebele: { latitude: 40.9981, longitude: 47.8453 },
  qabala: { latitude: 40.9981, longitude: 47.8453 },
};

const REGIONS = [
  { label: '📍 Quba', value: 'quba' },
  { label: '📍 Qusar', value: 'qusar' },
  { label: '📍 Şəki', value: 'seki' },
  { label: '📍 Lerik', value: 'lerik' },
  { label: '📍 Qəbələ', value: 'qabala' },
];

const INTERESTS = [
  { label: 'Təbiət', value: 'tabiet', emoji: '🌿' },
  { label: 'Tarix', value: 'tarix', emoji: '🏛️' },
  { label: 'Qastronomiya', value: 'qastro', emoji: '🍽️' },
  { label: 'Ailəvi', value: 'aile', emoji: '👨‍👩‍👧' },
  { label: 'Aktiv', value: 'aktiv', emoji: '🏃' },
  { label: 'Fotoqrafiya', value: 'foto', emoji: '📸' },
];

const DAY_OPTIONS = [
  { label: '1 gün', value: '1' },
  { label: '2 gün', value: '2' },
  { label: '3 gün', value: '3' },
  { label: '4+ gün', value: '4' },
];

const BUDGET_OPTIONS = [
  { label: 'Qənaətcil (0-50₼)', value: 'qenaetcil' },
  { label: 'Orta (50-150₼)', value: 'orta' },
  { label: 'Premium (150₼+)', value: 'premium' },
];

const GROUP_OPTIONS = [
  { label: '🧍 Tək', value: 'tek' },
  { label: '👫 2 nəfər', value: '2nefer' },
  { label: '👨‍👩‍👧 Ailə', value: 'aile' },
  { label: '👥 Qrup', value: 'qrup' },
];

type StopDuration = {
  from: string;
  to: string;
  duration: string;
  distance: string;
};

type LatLng = { latitude: number; longitude: number };

type RouteSegment = {
  coordinates: LatLng[];
  color: string;
};

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

function decodePolyline(encoded: string): LatLng[] {
  const poly: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let b: number;
    let shift = 0;
    let result = 0;

    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);

    const dlat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += dlat;

    shift = 0;
    result = 0;

    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);

    const dlng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += dlng;

    poly.push({
      latitude: lat / 1e5,
      longitude: lng / 1e5,
    });
  }

  return poly;
}

export default function AiKomekciScreen() {
  const [selectedRegion, setSelectedRegion] = useState<string | null>(null);
  const [selectedDays, setSelectedDays] = useState<number>(1);
  const [selectedBudget, setSelectedBudget] = useState<string | null>(null);
  const [selectedInterests, setSelectedInterests] = useState<string[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [plan, setPlan] = useState<any | null>(null);
  const [weatherAdvice, setWeatherAdvice] = useState<WeatherAdvice | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [routeSegments, setRouteSegments] = useState<RouteSegment[]>([]);
  const [stopDurations, setStopDurations] = useState<StopDuration[]>([]);
  const mapRef = useRef<MapRef | null>(null);
  const GOOGLE_MAPS_KEY =
    Constants.expoConfig?.extra?.googleMapsKey ||
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY ||
    '';

  const fetchRouteFromGoogle = async (planData: any) => {
    try {
      // Build legs only WITHIN each day — never Day N last → Day N+1 first
      const dayStopLists: Array<Array<{ lat: number; lng: number; name: string }>> = [];
      (planData.days ?? []).forEach((day: any) => {
        const stops: Array<{ lat: number; lng: number; name: string }> = [];
        (day.stops ?? []).forEach((stop: any) => {
          if (stop.lat && stop.lng) {
            stops.push({
              lat: Number(stop.lat),
              lng: Number(stop.lng),
              name: String(stop.name ?? ''),
            });
          }
        });
        if (stops.length > 0) {
          dayStopLists.push(stops);
        }
      });

      const fitCoords: LatLng[] = dayStopLists.flatMap((stops) =>
        stops.map((s) => ({ latitude: s.lat, longitude: s.lng }))
      );

      if (!GOOGLE_MAPS_KEY) {
        const segments: RouteSegment[] = [];
        let colorIdx = 0;
        dayStopLists.forEach((stops) => {
          for (let i = 0; i < stops.length - 1; i++) {
            segments.push({
              coordinates: [
                { latitude: stops[i].lat, longitude: stops[i].lng },
                { latitude: stops[i + 1].lat, longitude: stops[i + 1].lng },
              ],
              color: SEGMENT_COLORS[colorIdx % SEGMENT_COLORS.length],
            });
            colorIdx += 1;
          }
        });
        setRouteSegments(segments);
        if (fitCoords.length > 0 && mapRef.current) {
          mapRef.current.fitToCoordinates(fitCoords, {
            edgePadding: { top: 60, right: 40, bottom: 40, left: 40 },
            animated: true,
          });
        }
        return;
      }

      const segments: RouteSegment[] = [];
      const durations: StopDuration[] = [];
      const allCoords: LatLng[] = [];
      let colorIdx = 0;

      for (const stops of dayStopLists) {
        for (let i = 0; i < stops.length - 1; i++) {
          const origin = stops[i];
          const dest = stops[i + 1];
          const url =
            'https://maps.googleapis.com/maps/api/directions/json?' +
            `origin=${origin.lat},${origin.lng}` +
            `&destination=${dest.lat},${dest.lng}` +
            '&mode=driving&language=az&key=' +
            GOOGLE_MAPS_KEY;

          const response = await fetch(url);
          const data = await response.json();
          const color = SEGMENT_COLORS[colorIdx % SEGMENT_COLORS.length];
          colorIdx += 1;

          if (data.status === 'OK' && data.routes?.[0]) {
            const route = data.routes[0];
            const leg = route.legs?.[0];
            const points = decodePolyline(route.overview_polyline.points);
            const segmentCoords: LatLng[] = [
              { latitude: origin.lat, longitude: origin.lng },
              ...points,
              { latitude: dest.lat, longitude: dest.lng },
            ];
            segments.push({ coordinates: segmentCoords, color });
            allCoords.push(...segmentCoords);
            durations.push({
              from: origin.name,
              to: dest.name,
              duration: leg?.duration?.text || '',
              distance: leg?.distance?.text || '',
            });
          } else {
            const fallback: LatLng[] = [
              { latitude: origin.lat, longitude: origin.lng },
              { latitude: dest.lat, longitude: dest.lng },
            ];
            segments.push({ coordinates: fallback, color });
            allCoords.push(...fallback);
          }
        }
      }

      setRouteSegments(segments);
      setStopDurations(durations);

      const toFit = allCoords.length > 0 ? allCoords : fitCoords;
      if (toFit.length > 0 && mapRef.current) {
        mapRef.current.fitToCoordinates(toFit, {
          edgePadding: { top: 60, right: 40, bottom: 40, left: 40 },
          animated: true,
        });
      }
    } catch (err) {
      console.log('Route fetch xətası:', err);
    }
  };

  const planRoute = async () => {
    try {
      setLoading(true);
      setError(null);

      if (!selectedRegion) {
        setError('Region seçin.');
        return;
      }
      if (!selectedBudget) {
        setError('Büdcə seçin.');
        return;
      }
      if (selectedInterests.length === 0) {
        setError('Ən azı bir maraq seçin.');
        return;
      }

      const weather = await fetchRegionWeather(selectedRegion, selectedDays);
      setWeatherAdvice(weather);

      // Prefer Python-ranked high-rating candidates; fallback to Supabase + local sort
      let restaurants: any[] = [];
      let accommodations: any[] = [];
      let attractions: any[] = [];

      const ranked = await fetchRouteCandidates(selectedRegion, 12);
      if (
        ranked &&
        (ranked.restaurants.length > 0 ||
          ranked.accommodations.length > 0 ||
          ranked.attractions.length > 0)
      ) {
        const flat = applyWeatherPoiFilter(
          [...ranked.restaurants, ...ranked.accommodations, ...ranked.attractions],
          weather
        );
        const keep = new Set(flat.map((p) => p.id));
        restaurants = ranked.restaurants.filter((p) => keep.has(p.id));
        accommodations = ranked.accommodations.filter((p) => keep.has(p.id));
        attractions = ranked.attractions.filter((p) => keep.has(p.id));
      } else {
        const { data: poisRaw, error: poisError } = await supabase
          .from('pois')
          .select('id, name, category, description, lat, lng, region, rating, rating_count')
          .eq('status', 'approved')
          .eq('region', selectedRegion.toLowerCase())
          .order('rating', { ascending: false, nullsFirst: false })
          .limit(80);

        if (poisError) {
          throw poisError;
        }

        if (!poisRaw || poisRaw.length === 0) {
          setError('Bu bölgədə hələ yer əlavə edilməyib. Başqa rayon seçin.');
          return;
        }

        const pois = applyWeatherPoiFilter(poisRaw, weather);
        const byRating = (a: any, b: any) => {
          const ra = typeof a.rating === 'number' ? a.rating : -1;
          const rb = typeof b.rating === 'number' ? b.rating : -1;
          if (rb !== ra) {
            return rb - ra;
          }
          const ca = typeof a.rating_count === 'number' ? a.rating_count : 0;
          const cb = typeof b.rating_count === 'number' ? b.rating_count : 0;
          return cb - ca;
        };

        restaurants = pois
          .filter((p) => ['restaurant', 'home_restaurant', 'cafe'].includes(p.category))
          .sort(byRating)
          .slice(0, 12);
        accommodations = pois
          .filter((p) => ['hotel', 'hostel', 'guesthouse'].includes(p.category))
          .sort(byRating)
          .slice(0, 12);
        attractions = pois
          .filter((p) =>
            [
              'nature',
              'waterfall',
              'mountain',
              'lake',
              'historical',
              'monument',
              'other',
            ].includes(p.category)
          )
          .sort(byRating)
          .slice(0, 12);
      }

      if (
        restaurants.length + accommodations.length + attractions.length === 0
      ) {
        setError('Bu bölgədə hələ yer əlavə edilməyib. Başqa rayon seçin.');
        return;
      }

      const planFromApi = await requestPlanRoute({
        region: selectedRegion,
        days: selectedDays,
        budget: selectedBudget,
        interests: selectedInterests,
        groupType: selectedGroup ?? 'tek',
        weather: weather
          ? {
              prefer_indoor: weather.prefer_indoor,
              summary_az: weather.summary_az,
              exclude_categories: weather.exclude_categories,
              prefer_categories: weather.prefer_categories,
            }
          : null,
        pois: {
          restaurants,
          accommodations,
          attractions,
        },
      });

      let planData: any = {
        ...planFromApi,
        days: planFromApi.days.map((day) => ({
          ...day,
          stops: Array.isArray(day.stops) ? day.stops : [],
        })),
      };

      const trustServerOrder = planFromApi.source === 'fastapi_geo';

      const regionCoord = selectedRegion
        ? REGION_COORDS[selectedRegion.toLowerCase()]
        : null;

      const startLat = regionCoord?.latitude ?? 41.3625;
      const startLng = regionCoord?.longitude ?? 48.5128;

      planData = {
        ...planData,
        summary: planData.summary ?? 'Marşrut hazırlandı.',
        days: planData.days.map((day: any) => {
          const rawStops = Array.isArray(day.stops) ? day.stops : [];

          if (trustServerOrder) {
            return {
              ...day,
              stops: rawStops
                .map((stop: any, index: number) => ({
                  ...stop,
                  poi_id: String(stop.poi_id ?? stop.id ?? ''),
                  name: String(stop.name ?? 'Yer'),
                  lat: Number(stop.lat),
                  lng: Number(stop.lng),
                  category: String(stop.category ?? 'other'),
                  time: String(stop.time ?? ''),
                  visiting_time: String(stop.time ?? ''),
                  sequence_order: index + 1,
                  duration: stop.duration,
                  tip: stop.tip,
                }))
                .filter(
                  (s: any) => Number.isFinite(s.lat) && Number.isFinite(s.lng)
                ),
            };
          }

          const pois: POI[] = rawStops
            .map((stop: any) => ({
              id: String(stop.poi_id ?? stop.id ?? ''),
              name: String(stop.name ?? 'Yer'),
              lat: Number(stop.lat),
              lng: Number(stop.lng),
              category: String(stop.category ?? 'other'),
              duration_hours: parseDurationHours(stop.duration),
            }))
            .filter(
              (p: POI) => Number.isFinite(p.lat) && Number.isFinite(p.lng)
            );

          const optimized = optimizeRouteAndTimeline(
            pois,
            startLat,
            startLng,
            '09:00'
          );

          return {
            ...day,
            stops: optimized.map((step) => {
              const original =
                rawStops.find(
                  (s: any) => String(s.poi_id ?? s.id ?? '') === step.id
                ) ?? {};
              return {
                ...original,
                ...step,
                poi_id: step.id,
                sequence_order: step.sequence_order,
                visiting_time: step.arrival_time,
                time: step.arrival_time,
              };
            }),
          };
        }),
      };

      setPlan(planData);

      if (regionCoord && mapRef.current) {
        mapRef.current.animateToRegion(
          {
            ...regionCoord,
            latitudeDelta: 0.3,
            longitudeDelta: 0.3,
          },
          800
        );
      }

      await fetchRouteFromGoogle(planData);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const canSubmit =
    Boolean(selectedRegion) &&
    Boolean(selectedBudget) &&
    selectedInterests.length > 0 &&
    !loading;

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 64 : 0}
    >
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ResizableSplit
          storageKey="ai-map-split-ratio"
          initialTopRatio={0.34}
          minTopRatio={0.2}
          maxTopRatio={0.75}
          top={
        <View style={styles.mapSection}>
          <MapView
            ref={mapRef as never}
            style={styles.map}
            provider={PROVIDER_GOOGLE}
            initialRegion={{
              latitude: 41.3625,
              longitude: 48.5128,
              latitudeDelta: 0.5,
              longitudeDelta: 0.5,
            }}
          >
            {plan?.days?.map((day: any, dayIdx: number) =>
              (day.stops || []).map((stop: any, stopIdx: number) => {
                const lat = Number(stop.lat);
                const lng = Number(stop.lng);

                if (!lat || !lng || isNaN(lat) || isNaN(lng)) {
                  return null;
                }

                const totalDays = plan.days?.length ?? 1;
                const isSingleDay = totalDays <= 1;
                const isFirstStop = dayIdx === 0 && stopIdx === 0;
                const lastDayIdx = totalDays - 1;
                const lastDayStops = plan.days?.[lastDayIdx]?.stops || [];
                const isLastStop =
                  dayIdx === lastDayIdx && stopIdx === lastDayStops.length - 1;

                const sequenceNumber = stop.sequence_order ?? stopIdx + 1;
                const label = isSingleDay
                  ? String(sequenceNumber)
                  : `${dayIdx + 1}.${sequenceNumber}`;

                return (
                  <Marker
                    key={`${dayIdx}-${stopIdx}-${stop.poi_id || stopIdx}`}
                    coordinate={{
                      latitude: lat,
                      longitude: lng,
                    }}
                    title={stop.name || 'Yer'}
                    description={`${stop.arrival_time || stop.visiting_time || stop.time || ''} — ${stop.duration || ''}`}
                    tracksViewChanges={false}
                  >
                    <View
                      style={[
                        styles.markerBubble,
                        isFirstStop && styles.markerBubbleStart,
                        isLastStop && !isFirstStop && styles.markerBubbleFinish,
                        !isFirstStop &&
                          !isLastStop && {
                            backgroundColor: DAY_COLORS[dayIdx % DAY_COLORS.length],
                          },
                      ]}
                    >
                      {isFirstStop || isLastStop ? (
                        <View style={styles.markerInner}>
                          <FontAwesome
                            name={isFirstStop ? 'flag' : 'flag-checkered'}
                            size={10}
                            color="#fff"
                          />
                          <Text style={styles.markerText}>{label}</Text>
                        </View>
                      ) : (
                        <Text style={styles.markerText}>{label}</Text>
                      )}
                    </View>
                  </Marker>
                );
              })
            )}

            {routeSegments.map((segment, idx) =>
              segment.coordinates.length > 1 ? (
                <Polyline
                  key={`seg-${idx}`}
                  coordinates={segment.coordinates}
                  strokeColor={segment.color}
                  strokeWidth={4}
                  lineDashPattern={[12, 8]}
                />
              ) : null
            )}
          </MapView>

          <View style={styles.headerBadges}>
            <View style={styles.aiBadge}>
              <Text style={styles.aiBadgeEmoji}>✨</Text>
              <Text style={styles.aiBadgeText} numberOfLines={1}>
                AI Köməkçi
              </Text>
            </View>

            {plan ? (
              <TouchableOpacity
                onPress={() => {
                  setPlan(null);
                  setWeatherAdvice(null);
                  setRouteSegments([]);
                  setStopDurations([]);
                }}
                style={styles.resetBadge}
              >
                <Text style={styles.resetBadgeText} numberOfLines={1}>
                  ↩ Yenidən planla
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
          <ProfileCornerButton style={styles.profileCorner} />
        </View>
          }
          bottom={
        <View style={styles.panel}>
          {!plan ? (
            <ScrollView
              style={styles.flex}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.formContent}
              keyboardShouldPersistTaps="handled"
            >
              {error ? (
                <View style={styles.errorBox}>
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              ) : null}

              <DropdownButton
                label="📍 Məkan"
                value={selectedRegion}
                options={REGIONS}
                onSelect={setSelectedRegion}
              />

              <DropdownButton
                label="📅 Gün sayı"
                value={selectedDays.toString()}
                options={DAY_OPTIONS}
                onSelect={(v) => setSelectedDays(Number(v))}
              />

              <DropdownButton
                label="💰 Büdcə"
                value={selectedBudget}
                options={BUDGET_OPTIONS}
                onSelect={setSelectedBudget}
              />

              <View>
                <Text style={styles.sectionLabel}>🎯 Maraqlar</Text>
                <View style={styles.interestWrap}>
                  {INTERESTS.map((interest) => {
                    const selected = selectedInterests.includes(interest.value);
                    return (
                      <TouchableOpacity
                        key={interest.value}
                        onPress={() => {
                          setSelectedInterests((prev) =>
                            prev.includes(interest.value)
                              ? prev.filter((i) => i !== interest.value)
                              : [...prev, interest.value]
                          );
                        }}
                        style={[
                          styles.interestChip,
                          selected && styles.interestChipSelected,
                        ]}
                      >
                        <Text style={styles.interestEmoji}>{interest.emoji}</Text>
                        <Text
                          style={[
                            styles.interestLabel,
                            selected && styles.interestLabelSelected,
                          ]}
                          numberOfLines={1}
                        >
                          {interest.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              <DropdownButton
                label="👥 Qrup"
                value={selectedGroup}
                options={GROUP_OPTIONS}
                onSelect={setSelectedGroup}
              />

              <TouchableOpacity
                onPress={planRoute}
                disabled={!canSubmit}
                style={[
                  styles.submitButton,
                  !canSubmit && styles.submitButtonDisabled,
                ]}
              >
                {loading ? (
                  <View style={styles.loadingRow}>
                    <ActivityIndicator color="white" size="small" />
                    <Text style={styles.submitButtonText} numberOfLines={2}>
                      AI marşrutunuzu hazırlayır...
                    </Text>
                  </View>
                ) : (
                  <Text style={styles.submitButtonText}>✨ Marşrut Hazırla</Text>
                )}
              </TouchableOpacity>
            </ScrollView>
          ) : (
            <ScrollView
              style={styles.flex}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.planContent}
            >
              <View style={styles.summaryCard}>
                <Text style={styles.summaryText}>{plan.summary}</Text>
                {weatherAdvice?.summary_az ? (
                  <Text style={styles.weatherNote}>{weatherAdvice.summary_az}</Text>
                ) : null}
                <View style={styles.summaryMetaRow}>
                  <Text style={styles.summaryMeta} numberOfLines={1}>
                    💰 {plan.total_cost}
                  </Text>
                  <Text style={styles.summaryMeta} numberOfLines={1}>
                    ⏰ {plan.best_time}
                  </Text>
                </View>
                <View style={styles.shareRow}>
                  <TouchableOpacity
                    style={styles.shareButton}
                    onPress={() =>
                      void shareRouteText(
                        plan,
                        selectedRegion ?? 'region',
                        weatherAdvice?.summary_az
                      ).catch((err) => Alert.alert('Paylaşım', getErrorMessage(err)))
                    }
                  >
                    <Text style={styles.shareButtonText}>Paylaş</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.navButton}
                    onPress={() => {
                      const stops = collectRouteStops(plan);
                      void openRouteInGoogleMaps(stops).catch((err) =>
                        Alert.alert('Naviqasiya', getErrorMessage(err))
                      );
                    }}
                  >
                    <Text style={styles.navButtonText}>Naviqasiyanı başlat</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {plan.days?.map((day: any, dayIdx: number) => (
                <View key={day.day} style={styles.dayBlock}>
                  <View style={styles.dayHeader}>
                    <View
                      style={[
                        styles.dayBadge,
                        { backgroundColor: DAY_COLORS[dayIdx % DAY_COLORS.length] },
                      ]}
                    >
                      <Text style={styles.dayBadgeText}>{day.day}</Text>
                    </View>
                    <Text style={styles.dayTitle} numberOfLines={2}>
                      {day.title}
                    </Text>
                    <Text style={styles.dayCost} numberOfLines={1}>
                      💰 {day.estimated_cost}
                    </Text>
                  </View>

                  {day.stops?.map((stop: any, stopIdx: number) => (
                    <View
                      key={String(stop.poi_id) + stopIdx}
                      style={styles.stopRow}
                    >
                      <View style={styles.stopTimeCol}>
                        <Text style={styles.stopTime}>
                          {stop.arrival_time || stop.visiting_time || stop.time}
                        </Text>
                        {stopIdx < day.stops.length - 1 ? (
                          <View
                            style={[
                              styles.stopTimeline,
                              {
                                backgroundColor:
                                  DAY_COLORS[dayIdx % DAY_COLORS.length] + '40',
                              },
                            ]}
                          />
                        ) : null}
                      </View>

                      <View style={styles.stopCard}>
                        <View style={styles.stopTitleRow}>
                          <Text style={styles.stopEmoji}>
                            {getCategoryEmoji(stop.category)}
                          </Text>
                          <Text style={styles.stopName} numberOfLines={2}>
                            {stop.name}
                          </Text>
                        </View>
                        <Text style={styles.stopDuration}>⏱ {stop.duration}</Text>
                        {stop.tip ? (
                          <Text style={styles.stopTip}>💡 {stop.tip}</Text>
                        ) : null}

                        {stopDurations[dayIdx * 10 + stopIdx] ? (
                          <View style={styles.stopLegBox}>
                            <Text style={styles.stopLegPrimary}>
                              🚗 {stopDurations[dayIdx * 10 + stopIdx].duration}
                            </Text>
                            <Text style={styles.stopLegSecondary}>
                              📏 {stopDurations[dayIdx * 10 + stopIdx].distance}
                            </Text>
                          </View>
                        ) : null}
                      </View>
                    </View>
                  ))}

                  {day.notes ? (
                    <Text style={styles.dayNotes}>📝 {day.notes}</Text>
                  ) : null}
                </View>
              ))}
            </ScrollView>
          )}
        </View>
          }
        />
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  mapSection: {
    flex: 1,
    width: '100%',
    overflow: 'hidden',
    position: 'relative',
  },
  map: {
    ...StyleSheet.absoluteFill,
  },
  markerBubble: {
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderWidth: 2,
    borderColor: 'white',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    elevation: 5,
    minWidth: 32,
    minHeight: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markerBubbleStart: {
    backgroundColor: '#2F9E44',
    borderRadius: 16,
    minWidth: 34,
    minHeight: 34,
  },
  markerBubbleFinish: {
    backgroundColor: '#C92A2A',
    borderRadius: 16,
    minWidth: 34,
    minHeight: 34,
  },
  markerInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  markerText: {
    color: 'white',
    fontSize: 11,
    fontWeight: '700',
  },
  headerBadges: {
    position: 'absolute',
    top: 12,
    left: 12,
    right: 60,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  profileCorner: {
    position: 'absolute',
    top: 12,
    right: 12,
    zIndex: 12,
  },
  aiBadge: {
    backgroundColor: colors.accent,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
    maxWidth: '100%',
  },
  aiBadgeEmoji: {
    fontSize: 14,
  },
  aiBadgeText: {
    color: 'white',
    fontWeight: '700',
    fontSize: 14,
    flexShrink: 1,
  },
  resetBadge: {
    backgroundColor: 'white',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: colors.border,
    flexShrink: 1,
    maxWidth: '100%',
  },
  resetBadgeText: {
    fontSize: 13,
    color: colors.textSecondary,
    flexShrink: 1,
  },
  panel: {
    flex: 1,
    minHeight: 0,
    backgroundColor: colors.surfaceMuted,
    overflow: 'hidden',
  },
  formContent: {
    padding: 16,
    gap: 12,
    flexGrow: 1,
  },
  planContent: {
    padding: 16,
    paddingBottom: 40,
    flexGrow: 1,
  },
  errorBox: {
    backgroundColor: '#FEF2F2',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#FECACA',
    overflow: 'hidden',
  },
  errorText: {
    color: colors.danger,
    fontSize: 13,
    flexShrink: 1,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.chipText,
    marginBottom: 8,
  },
  interestWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  interestChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: 'white',
    maxWidth: '100%',
    overflow: 'hidden',
  },
  interestChipSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  interestEmoji: {
    fontSize: 14,
  },
  interestLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.textSecondary,
    flexShrink: 1,
  },
  interestLabelSelected: {
    color: colors.accent,
  },
  submitButton: {
    backgroundColor: colors.accent,
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 12,
    alignItems: 'center',
    marginTop: 8,
    overflow: 'hidden',
  },
  submitButtonDisabled: {
    backgroundColor: colors.chip,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    maxWidth: '100%',
  },
  submitButtonText: {
    color: 'white',
    fontWeight: '700',
    fontSize: 15,
    flexShrink: 1,
    textAlign: 'center',
  },
  summaryCard: {
    backgroundColor: colors.accentSoft,
    borderRadius: 24,
    padding: 12,
    marginBottom: 12,
    overflow: 'hidden',
  },
  summaryText: {
    fontSize: 13,
    color: colors.accentPressed,
    lineHeight: 18,
    flexShrink: 1,
  },
  summaryMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 8,
  },
  summaryMeta: {
    fontSize: 12,
    color: colors.accent,
    fontWeight: '600',
    flexShrink: 1,
    minWidth: 0,
  },
  weatherNote: {
    marginTop: 8,
    fontSize: 13,
    lineHeight: 18,
    color: colors.accentPressed,
    fontWeight: '500',
  },
  shareRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
    alignItems: 'stretch',
  },
  shareButton: {
    flex: 0.85,
    backgroundColor: colors.accent,
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shareButtonText: {
    color: colors.textOnAccent,
    fontWeight: '700',
    fontSize: 13,
  },
  navButton: {
    flex: 1.35,
    backgroundColor: '#E85D04',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 13,
  },
  dayBlock: {
    marginBottom: 16,
  },
  dayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  dayBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dayBadgeText: {
    color: 'white',
    fontWeight: '700',
    fontSize: 13,
  },
  dayTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
    flex: 1,
    minWidth: 0,
    flexShrink: 1,
  },
  dayCost: {
    fontSize: 12,
    color: colors.textSecondary,
    flexShrink: 1,
    minWidth: 0,
    maxWidth: '35%',
  },
  stopRow: {
    flexDirection: 'row',
    paddingBottom: 12,
  },
  stopTimeCol: {
    width: 52,
    alignItems: 'center',
  },
  stopTime: {
    fontSize: 11,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  stopTimeline: {
    width: 2,
    flex: 1,
    minHeight: 20,
    marginTop: 4,
  },
  stopCard: {
    flex: 1,
    minWidth: 0,
    paddingLeft: 10,
    backgroundColor: 'white',
    borderRadius: 16,
    padding: 10,
    marginLeft: 4,
    overflow: 'hidden',
  },
  stopTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  stopEmoji: {
    fontSize: 16,
  },
  stopName: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
    flex: 1,
    minWidth: 0,
    flexShrink: 1,
  },
  stopDuration: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
  },
  stopTip: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 4,
    fontStyle: 'italic',
    flexShrink: 1,
  },
  stopLegBox: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 6,
    padding: 6,
    backgroundColor: colors.accentSoft,
    borderRadius: 8,
    overflow: 'hidden',
  },
  stopLegPrimary: {
    fontSize: 11,
    color: colors.accent,
    fontWeight: '600',
    flexShrink: 1,
  },
  stopLegSecondary: {
    fontSize: 11,
    color: colors.accent,
    flexShrink: 1,
  },
  dayNotes: {
    fontSize: 12,
    color: colors.textSecondary,
    fontStyle: 'italic',
    marginTop: 4,
    marginLeft: 56,
    flexShrink: 1,
  },
});
