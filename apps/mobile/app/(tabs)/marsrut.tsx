import Constants from 'expo-constants';
import * as Location from 'expo-location';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
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
import { CategoryIcon } from '../../components/CategoryIcon';
import { ProfileCornerButton } from '../../components/ProfileCornerButton';
import { ResizableSplit } from '../../components/ResizableSplit';
import { DEFAULT_REGION_ID, REGIONS } from '../../constants/regions';
import { colors } from '../../constants/theme';
import { getErrorMessage } from '../../lib/errors';
import { collectRouteStops, openRouteInGoogleMaps } from '../../lib/openNavigation';
import { planRoute as requestPlanRoute } from '../../lib/planRoute';
import { fetchRouteCandidates } from '../../lib/routeCandidates';
import { saveRoute, planDaysToSavedStops } from '../../lib/savedRoutes';
import { shareRouteText } from '../../lib/shareRoute';
import { supabase } from '../../lib/supabase';
import { useInfoToast } from '../../components/InfoToastProvider';
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

type DayOption = 1 | 2 | 3 | 4;
type BudgetOption = 'budget' | 'mid' | 'premium';
type InterestId = 'nature' | 'history' | 'food' | 'family' | 'active' | 'photo';
type GroupOption = 'solo' | 'couple' | 'family' | 'group';

type PlanStop = {
  time: string;
  poi_id: string;
  name: string;
  category: string;
  duration: string;
  lat: number;
  lng: number;
  tip: string;
  daypart?: string;
  sequence_order?: number | null;
  arrival_time?: string;
  visiting_time?: string;
};

type PlanDay = {
  day: number;
  title: string;
  stops: PlanStop[];
  estimated_cost?: string;
  notes?: string;
};

type GeneratedPlan = {
  summary: string;
  days: PlanDay[];
  total_cost?: string;
  best_time?: string;
  regionLabel: string;
  daysCount: number;
  budgetLabel: string;
  interestLabels: string[];
  groupLabel: string | null;
  source?: string;
  travel?: {
    from_origin?: boolean;
    outbound_minutes?: number;
    return_minutes?: number;
    distance_km?: number;
    depart_origin_at?: string;
    arrive_region_at?: string;
  } | null;
  lodging?: {
    name?: string;
    category?: string;
    note?: string;
  } | null;
};

type LatLng = { latitude: number; longitude: number };

type RouteSegment = {
  coordinates: LatLng[];
  color: string;
};

type StopDuration = {
  duration: string;
  distance: string;
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

function isTravelStop(stop: {
  category?: string | null;
  daypart?: string | null;
}): boolean {
  const cat = String(stop.category || '').toLowerCase();
  const daypart = String(stop.daypart || '').toLowerCase();
  return cat === 'travel' || daypart.startsWith('travel');
}

const DAY_COLORS = [
  colors.accent,
  colors.success,
  colors.warning,
  colors.accentPressed,
  colors.danger,
];

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

const DAY_OPTIONS: { value: DayOption; label: string }[] = [
  { value: 1, label: '1 gün' },
  { value: 2, label: '2 gün' },
  { value: 3, label: '3 gün' },
  { value: 4, label: '4+ gün' },
];

const BUDGET_OPTIONS: { value: BudgetOption; label: string }[] = [
  { value: 'budget', label: 'Qənaətcil (0-50₼)' },
  { value: 'mid', label: 'Orta (50-150₼)' },
  { value: 'premium', label: 'Premium (150₼+)' },
];

const INTEREST_OPTIONS: { id: InterestId; label: string }[] = [
  { id: 'nature', label: '🌿 Təbiət' },
  { id: 'history', label: '🏛 Tarix' },
  { id: 'food', label: '🍽 Qastronomiya' },
  { id: 'family', label: '👨‍👩‍👧 Ailəvi' },
  { id: 'active', label: '🏃 Aktiv' },
  { id: 'photo', label: '📸 Fotoqrafiya' },
];

const INTEREST_ATTRACTION_CATS: Record<InterestId, string[]> = {
  nature: ['nature', 'waterfall', 'mountain', 'lake'],
  history: ['historical', 'monument'],
  food: [],
  family: ['historical', 'nature', 'lake', 'other', 'monument'],
  active: ['mountain', 'nature', 'waterfall'],
  photo: ['nature', 'waterfall', 'historical', 'monument', 'lake'],
};

function preferAttractionsForInterests<T extends { category: string }>(
  attractions: T[],
  selected: InterestId[]
): T[] {
  const prefer = new Set(
    selected.flatMap((id) => INTEREST_ATTRACTION_CATS[id] ?? [])
  );
  if (prefer.size === 0) {
    return attractions;
  }
  const matched = attractions.filter((a) => prefer.has(a.category));
  const rest = attractions.filter((a) => !prefer.has(a.category));
  return [...matched, ...rest];
}

const GROUP_OPTIONS: { value: GroupOption; label: string }[] = [
  { value: 'solo', label: 'Tək' },
  { value: 'couple', label: '2 nəfər' },
  { value: 'family', label: 'Ailə' },
  { value: 'group', label: 'Qrup' },
];

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

function legKey(dayIdx: number, stopIdx: number): string {
  return `${dayIdx}-${stopIdx}`;
}

/** Forma açılanda xəritə gizlidir; plan hazır olanda yarı-yarı */
const MARSRUT_FORM_SPLIT = 0;
const MARSRUT_PLAN_SPLIT = 0.5;

export default function MarsrutScreen() {
  const mapRef = useRef<MapRef | null>(null);
  const { showInfo } = useInfoToast();
  const GOOGLE_MAPS_KEY =
    Constants.expoConfig?.extra?.googleMapsKey ||
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY ||
    '';

  const [regionId, setRegionId] = useState(DEFAULT_REGION_ID);
  const [days, setDays] = useState<DayOption>(2);
  const [budget, setBudget] = useState<BudgetOption>('mid');
  const [interests, setInterests] = useState<InterestId[]>(['nature']);
  const [group, setGroup] = useState<GroupOption | null>(null);

  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [plan, setPlan] = useState<GeneratedPlan | null>(null);
  const [weatherAdvice, setWeatherAdvice] = useState<WeatherAdvice | null>(null);
  const [routeSegments, setRouteSegments] = useState<RouteSegment[]>([]);
  const [stopDurations, setStopDurations] = useState<Record<string, StopDuration>>({});
  const [fromOrigin, setFromOrigin] = useState(false);
  const [userLocation, setUserLocation] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [mapSize, setMapSize] = useState<{ width: number; height: number } | null>(null);
  /** Forma: xəritə gizli; plan: ~yarı yarı — istifadəçi yenə sürükləyə bilər */
  const [splitRatio, setSplitRatio] = useState(MARSRUT_FORM_SPLIT);
  const [savingRoute, setSavingRoute] = useState(false);

  const canSubmit = useMemo(
    () => Boolean(regionId && days && budget && interests.length > 0),
    [regionId, days, budget, interests]
  );

  const regionMeta = useMemo(
    () => REGIONS.find((r) => r.id === regionId) ?? REGIONS[0],
    [regionId]
  );

  function toggleInterest(id: InterestId) {
    setInterests((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    );
  }

  async function enableFromOrigin(next: boolean) {
    if (!next) {
      setFromOrigin(false);
      return;
    }
    // Switch dərhal açılsın — GPS arxa planda
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
    } catch (err) {
      Alert.alert('Məkan', getErrorMessage(err));
      setFromOrigin(false);
    }
  }

  function handleReset() {
    setPlan(null);
    setWeatherAdvice(null);
    setRouteSegments([]);
    setStopDurations({});
    setErrorMessage(null);
    setSplitRatio(MARSRUT_FORM_SPLIT);
  }

  async function handleSavePlan() {
    if (!plan) {
      return;
    }
    setSavingRoute(true);
    try {
      const stops = planDaysToSavedStops(plan.days ?? []);
      const result = await saveRoute({
        source: 'ai',
        title: `${plan.regionLabel} · ${plan.daysCount} gün`,
        summary: plan.summary,
        region: regionId,
        daysCount: plan.daysCount,
        budget,
        interests,
        groupType: group,
        fromOrigin: Boolean(plan.travel?.from_origin || fromOrigin),
        originLat: fromOrigin ? userLocation?.latitude ?? null : null,
        originLng: fromOrigin ? userLocation?.longitude ?? null : null,
        totalCost: plan.total_cost ?? null,
        bestTime: plan.best_time ?? null,
        travel: plan.travel ? { ...plan.travel } : null,
        stops,
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

  const fetchRouteFromGoogle = async (planData: GeneratedPlan) => {
    try {
      const dayStopLists: Array<Array<{ lat: number; lng: number; name: string }>> = [];
      (planData.days ?? []).forEach((day) => {
        const stops: Array<{ lat: number; lng: number; name: string }> = [];
        (day.stops ?? []).forEach((stop) => {
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
      const durations: Record<string, StopDuration> = {};
      const allCoords: LatLng[] = [];
      let colorIdx = 0;

      for (let dayIdx = 0; dayIdx < dayStopLists.length; dayIdx++) {
        const stops = dayStopLists[dayIdx];
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
            durations[legKey(dayIdx, i)] = {
              duration: leg?.duration?.text || '',
              distance: leg?.distance?.text || '',
            };
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
      setErrorMessage(null);

      if (!regionId) {
        setErrorMessage('Region seçin.');
        return;
      }
      if (!days) {
        setErrorMessage('Gün sayını seçin.');
        return;
      }
      if (!budget) {
        setErrorMessage('Büdcə seçin.');
        return;
      }
      if (interests.length === 0) {
        setErrorMessage('Ən azı bir maraq seçin.');
        return;
      }
      if (fromOrigin && !userLocation) {
        setErrorMessage('Cari məkan tapılmadı. Switch-i yenidən yandırın.');
        return;
      }

      const weather = await fetchRegionWeather(regionId, days);
      setWeatherAdvice(weather);

      let restaurants: any[] = [];
      let accommodations: any[] = [];
      let attractions: any[] = [];

      const ranked = await fetchRouteCandidates(regionId, 16, {
        interests,
      });
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
        attractions = preferAttractionsForInterests(
          ranked.attractions.filter((p) => keep.has(p.id)),
          interests
        );
      } else {
        const { data: poisRaw, error: poisError } = await supabase
          .from('pois')
          .select('id, name, category, description, lat, lng, region, rating, rating_count')
          .eq('status', 'approved')
          .eq('region', regionId.toLowerCase())
          .order('rating', { ascending: false, nullsFirst: false })
          .limit(80);

        if (poisError) {
          throw poisError;
        }

        if (!poisRaw || poisRaw.length === 0) {
          setErrorMessage('Bu bölgədə hələ yer əlavə edilməyib. Başqa rayon seçin.');
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
          .filter((p) => ['restaurant', 'home_restaurant'].includes(p.category))
          .sort(byRating)
          .slice(0, 12);
        accommodations = pois
          .filter((p) => ['hotel', 'hostel', 'guesthouse'].includes(p.category))
          .sort(byRating)
          .slice(0, 12);
        attractions = preferAttractionsForInterests(
          pois
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
            .sort(byRating),
          interests
        ).slice(0, 16);
      }

      if (restaurants.length + accommodations.length + attractions.length === 0) {
        setErrorMessage('Bu bölgədə hələ yer əlavə edilməyib. Başqa rayon seçin.');
        return;
      }

      const excludePoiIds = plan
        ? plan.days.flatMap((day) =>
            (day.stops || [])
              .filter((s) => s.category !== 'travel' && s.poi_id)
              .map((s) => s.poi_id)
          )
        : [];

      const data = await requestPlanRoute({
        region: regionId,
        days,
        budget,
        interests,
        groupType: group ?? 'solo',
        weather: weather
          ? {
              prefer_indoor: weather.prefer_indoor,
              summary_az: weather.summary_az,
              exclude_categories: weather.exclude_categories,
              prefer_categories: weather.prefer_categories,
            }
          : null,
        pois: { restaurants, accommodations, attractions },
        fromOrigin,
        originLat: fromOrigin && userLocation ? userLocation.latitude : null,
        originLng: fromOrigin && userLocation ? userLocation.longitude : null,
        varietySeed: Date.now(),
        excludePoiIds,
      });

      const regionLabel = REGIONS.find((r) => r.id === regionId)?.label ?? regionId;
      const budgetLabel = BUDGET_OPTIONS.find((b) => b.value === budget)?.label ?? budget;
      const interestLabels = INTEREST_OPTIONS.filter((i) => interests.includes(i.id)).map(
        (i) => i.label
      );
      const groupLabel = group
        ? (GROUP_OPTIONS.find((g) => g.value === group)?.label ?? null)
        : null;

      const trustServerOrder = data.source === 'fastapi_geo';
      const startLat =
        fromOrigin && userLocation ? userLocation.latitude : regionMeta.latitude;
      const startLng =
        fromOrigin && userLocation ? userLocation.longitude : regionMeta.longitude;

      const mappedDays: PlanDay[] = data.days.map((day) => {
        const rawStops = Array.isArray(day.stops) ? day.stops : [];

        if (trustServerOrder) {
          let visitSeq = 0;
          return {
            day: day.day,
            title: day.title,
            estimated_cost: day.estimated_cost,
            notes: day.notes,
            stops: rawStops
              .map((stop) => {
                const category = String(stop.category ?? 'other');
                const daypart = String(stop.daypart ?? '');
                const travel = isTravelStop({ category, daypart });
                if (!travel) visitSeq += 1;
                return {
                  time: String(stop.time ?? ''),
                  poi_id: String(stop.poi_id ?? stop.id ?? ''),
                  name: String(stop.name ?? 'Yer'),
                  category,
                  duration: String(stop.duration ?? ''),
                  lat: Number(stop.lat),
                  lng: Number(stop.lng),
                  tip: travel ? '' : String(stop.tip ?? ''),
                  daypart,
                  sequence_order: travel ? null : visitSeq,
                  arrival_time: String(stop.time ?? ''),
                  visiting_time: String(stop.time ?? ''),
                };
              })
              .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng)),
          };
        }

        const pois: POI[] = rawStops
          .map((stop) => ({
            id: String(stop.poi_id ?? stop.id ?? ''),
            name: String(stop.name ?? 'Yer'),
            lat: Number(stop.lat),
            lng: Number(stop.lng),
            category: String(stop.category ?? 'other'),
            duration_hours: parseDurationHours(stop.duration),
          }))
          .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));

        const optimized = optimizeRouteAndTimeline(pois, startLat, startLng, '09:00');

        return {
          day: day.day,
          title: day.title,
          estimated_cost: day.estimated_cost,
          notes: day.notes,
          stops: optimized.map((step) => {
            const original =
              rawStops.find((s) => String(s.poi_id ?? s.id ?? '') === step.id) ?? {};
            const daypart = String((original as { daypart?: string }).daypart ?? '');
            const travel = isTravelStop({ category: step.category, daypart });
            return {
              time: step.arrival_time,
              poi_id: step.id,
              name: step.name,
              category: step.category,
              duration: String((original as { duration?: string }).duration ?? ''),
              lat: step.lat,
              lng: step.lng,
              tip: travel ? '' : String((original as { tip?: string }).tip ?? ''),
              daypart,
              sequence_order: travel ? null : step.sequence_order,
              arrival_time: step.arrival_time,
              visiting_time: step.arrival_time,
            };
          }),
        };
      });

      const planData: GeneratedPlan = {
        summary: data.summary ?? `${regionLabel} üçün marşrut hazırlandı.`,
        days: mappedDays,
        total_cost: data.total_cost,
        best_time: data.best_time,
        regionLabel,
        daysCount: days,
        budgetLabel,
        interestLabels,
        groupLabel,
        source: data.source,
        travel: data.travel ?? null,
        lodging: data.lodging ?? null,
      };

      setPlan(planData);
      setSplitRatio(MARSRUT_PLAN_SPLIT);

      if (mapRef.current) {
        mapRef.current.animateToRegion(
          {
            latitude: regionMeta.latitude,
            longitude: regionMeta.longitude,
            latitudeDelta: 0.3,
            longitudeDelta: 0.3,
          },
          800
        );
      }

      await fetchRouteFromGoogle(planData);
    } catch (err) {
      setErrorMessage(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ResizableSplit
        initialTopRatio={MARSRUT_FORM_SPLIT}
        topRatio={splitRatio}
        onTopRatioChange={setSplitRatio}
        minTopRatio={0}
        maxTopRatio={0.85}
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
                key={`marsrut-map-${mapSize.width}x${mapSize.height}`}
                ref={mapRef as never}
                style={{ width: mapSize.width, height: mapSize.height }}
                provider={Platform.OS === 'web' ? undefined : PROVIDER_GOOGLE}
                initialRegion={{
                  latitude: regionMeta.latitude,
                  longitude: regionMeta.longitude,
                  latitudeDelta: regionMeta.latitudeDelta,
                  longitudeDelta: regionMeta.longitudeDelta,
                }}
                showsUserLocation={false}
                showsMyLocationButton={false}
              >
                  {fromOrigin && userLocation ? (
                    <Marker
                      coordinate={userLocation}
                      title="Mənim yerim"
                      tracksViewChanges={false}
                    >
                      <View style={styles.meMarker}>
                        <View style={styles.meMarkerDot} />
                      </View>
                    </Marker>
                  ) : null}

                  {plan?.days?.map((day, dayIdx) => {
                    const totalDays = plan.days?.length ?? 1;
                    const isSingleDay = totalDays <= 1;
                    const lastDayIdx = totalDays - 1;
                    const lastDayVisitIdx = (plan.days?.[lastDayIdx]?.stops || [])
                      .map((s, i) => (isTravelStop(s) ? -1 : i))
                      .filter((i) => i >= 0)
                      .pop();

                    return (day.stops || []).map((stop, stopIdx) => {
                      const lat = Number(stop.lat);
                      const lng = Number(stop.lng);
                      if (!lat || !lng || Number.isNaN(lat) || Number.isNaN(lng)) {
                        return null;
                      }

                      const travel = isTravelStop(stop);
                      if (travel) {
                        return (
                          <Marker
                            key={`${dayIdx}-${stopIdx}-travel-${stop.name || stopIdx}`}
                            coordinate={{ latitude: lat, longitude: lng }}
                            title={stop.name || 'Yol'}
                            description={stop.duration || 'Transfer'}
                            tracksViewChanges={false}
                          >
                            <View style={styles.travelMarker}>
                              <FontAwesome name="car" size={11} color="#fff" />
                            </View>
                          </Marker>
                        );
                      }

                      const sequenceNumber = stop.sequence_order;
                      if (sequenceNumber == null) return null;

                      const isFirstVisit = dayIdx === 0 && sequenceNumber === 1;
                      const isLastVisit =
                        dayIdx === lastDayIdx && stopIdx === lastDayVisitIdx;

                      const label = isSingleDay
                        ? String(sequenceNumber)
                        : `${dayIdx + 1}.${sequenceNumber}`;

                      return (
                        <Marker
                          key={`${dayIdx}-${stopIdx}-${stop.poi_id || stopIdx}`}
                          coordinate={{ latitude: lat, longitude: lng }}
                          title={stop.name || 'Yer'}
                          description={`${stop.arrival_time || stop.visiting_time || stop.time || ''} — ${stop.duration || ''}`}
                          tracksViewChanges={false}
                        >
                          <View
                            style={[
                              styles.markerBubble,
                              isFirstVisit && styles.markerBubbleStart,
                              isLastVisit && !isFirstVisit && styles.markerBubbleFinish,
                              !isFirstVisit &&
                                !isLastVisit && {
                                  backgroundColor: DAY_COLORS[dayIdx % DAY_COLORS.length],
                                },
                            ]}
                          >
                            {isFirstVisit || isLastVisit ? (
                              <View style={styles.markerInner}>
                                <FontAwesome
                                  name={isFirstVisit ? 'flag' : 'flag-checkered'}
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
                    });
                  })}

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
              ) : (
                <View style={styles.mapPlaceholder}>
                  <Text style={styles.mapPlaceholderText}>Xəritə yüklənir…</Text>
                </View>
              )}

              {plan ? (
                <TouchableOpacity onPress={handleReset} style={styles.resetBadge}>
                  <Text style={styles.resetBadgeText} numberOfLines={1}>
                    Yenidən planla
                  </Text>
                </TouchableOpacity>
              ) : null}
              <ProfileCornerButton style={styles.profileCorner} />
            </View>
          }
          bottom={
            <View style={styles.panel}>
              {!plan ? (
                <ScrollView
                  style={styles.flex}
                  contentContainerStyle={styles.formContent}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                >
                  <Text style={styles.title}>AI Marşrut Planlayıcı</Text>
                  <Text style={styles.subtitle}>
                    Sizin üçün ən optimal marşrutu hazırlayırıq
                  </Text>

                  {errorMessage ? (
                    <Text style={styles.errorText}>{errorMessage}</Text>
                  ) : null}

                  <View style={styles.fromOriginRow}>
                    <View style={styles.fromOriginTextWrap}>
                      <Text style={styles.fromOriginLabel}>Cari məkandan gedirəm</Text>
                      <Text style={styles.fromOriginHint}>
                        Marşrut olduğun yerdən regiona başlayır (gediş+qayıdış)
                      </Text>
                    </View>
                    <Switch
                      value={fromOrigin}
                      onValueChange={(v) => void enableFromOrigin(v)}
                      trackColor={{ false: colors.chip, true: colors.accentSoft }}
                      thumbColor={fromOrigin ? colors.accent : colors.textMuted}
                    />
                  </View>

                  <Text style={styles.label}>
                    Region <Text style={styles.required}>*</Text>
                  </Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.chipRow}
                  >
                    {REGIONS.map((region) => {
                      const selected = region.id === regionId;
                      return (
                        <Pressable
                          key={region.id}
                          onPress={() => {
                            setRegionId(region.id);
                            mapRef.current?.animateToRegion(
                              {
                                latitude: region.latitude,
                                longitude: region.longitude,
                                latitudeDelta: region.latitudeDelta,
                                longitudeDelta: region.longitudeDelta,
                              },
                              600
                            );
                          }}
                          style={[styles.chip, selected && styles.chipSelected]}
                        >
                          <Text
                            style={[styles.chipText, selected && styles.chipTextSelected]}
                          >
                            {region.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>

                  <Text style={styles.label}>
                    Gün sayı <Text style={styles.required}>*</Text>
                  </Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.chipRow}
                  >
                    {DAY_OPTIONS.map((option) => {
                      const selected = option.value === days;
                      return (
                        <Pressable
                          key={option.value}
                          onPress={() => setDays(option.value)}
                          style={[styles.chip, selected && styles.chipSelected]}
                        >
                          <Text
                            style={[styles.chipText, selected && styles.chipTextSelected]}
                          >
                            {option.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>

                  <Text style={styles.label}>
                    Büdcə <Text style={styles.required}>*</Text>
                  </Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.chipRow}
                  >
                    {BUDGET_OPTIONS.map((option) => {
                      const selected = option.value === budget;
                      return (
                        <Pressable
                          key={option.value}
                          onPress={() => setBudget(option.value)}
                          style={[styles.chip, selected && styles.chipSelected]}
                        >
                          <Text
                            style={[styles.chipText, selected && styles.chipTextSelected]}
                          >
                            {option.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>

                  <Text style={styles.label}>
                    Maraqlar <Text style={styles.required}>*</Text>
                  </Text>
                  <View style={styles.interestGrid}>
                    {INTEREST_OPTIONS.map((option) => {
                      const selected = interests.includes(option.id);
                      return (
                        <Pressable
                          key={option.id}
                          onPress={() => toggleInterest(option.id)}
                          style={[
                            styles.interestChip,
                            selected && styles.interestChipSelected,
                          ]}
                        >
                          <Text
                            style={[
                              styles.interestText,
                              selected && styles.interestTextSelected,
                            ]}
                          >
                            {option.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  <Text style={styles.label}>Neçə nəfər (istəyə bağlı)</Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.chipRow}
                  >
                    {GROUP_OPTIONS.map((option) => {
                      const selected = option.value === group;
                      return (
                        <Pressable
                          key={option.value}
                          onPress={() => setGroup(selected ? null : option.value)}
                          style={[styles.chip, selected && styles.chipSelected]}
                        >
                          <Text
                            style={[styles.chipText, selected && styles.chipTextSelected]}
                          >
                            {option.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>

                  <Pressable
                    style={[
                      styles.primaryButton,
                      (!canSubmit || loading) && styles.primaryButtonDisabled,
                    ]}
                    onPress={planRoute}
                    disabled={!canSubmit || loading}
                  >
                    {loading ? (
                      <View style={styles.loadingRow}>
                        <ActivityIndicator color="#fff" />
                        <Text style={styles.primaryButtonText}>
                          AI marşrutunuzu hazırlayır...
                        </Text>
                      </View>
                    ) : (
                      <Text style={styles.primaryButtonText}>Marşrut Hazırla</Text>
                    )}
                  </Pressable>
                </ScrollView>
              ) : (
                <ScrollView
                  style={styles.flex}
                  contentContainerStyle={styles.planContent}
                  showsVerticalScrollIndicator={false}
                >
                  <View style={styles.summaryCard}>
                    <Text style={styles.summaryText}>{plan.summary}</Text>
                    {weatherAdvice?.summary_az ? (
                      <Text style={styles.weatherNote}>{weatherAdvice.summary_az}</Text>
                    ) : null}
                    <View style={styles.summaryMetaRow}>
                      {plan.total_cost ? (
                        <Text style={styles.summaryMeta} numberOfLines={1}>
                          💰 {plan.total_cost}
                        </Text>
                      ) : null}
                      {plan.best_time ? (
                        <Text style={styles.summaryMeta} numberOfLines={1}>
                          ⏱ {plan.best_time}
                        </Text>
                      ) : null}
                    </View>
                    {plan.travel?.from_origin ? (
                      <Text style={styles.travelNote}>
                        Cari məkandan ~{Math.round(plan.travel.outbound_minutes ?? 0)} dəq
                        {plan.travel.distance_km
                          ? ` · ${plan.travel.distance_km.toFixed(0)} km`
                          : ''}
                        {plan.travel.depart_origin_at
                          ? ` · çıxış ${plan.travel.depart_origin_at}`
                          : ''}
                      </Text>
                    ) : null}
                    {plan.lodging?.name ? (
                      <Text style={styles.lodgingNote}>
                        Gecələmə bazası: {plan.lodging.name}
                        {plan.daysCount > 1 ? ' · bütün gecələr eyni otel' : ''}
                      </Text>
                    ) : null}
                    <View style={styles.shareRow}>
                      <TouchableOpacity
                        style={styles.saveButton}
                        onPress={() => void handleSavePlan()}
                        disabled={savingRoute}
                      >
                        <Text style={styles.saveButtonText}>
                          {savingRoute ? 'Saxlanır…' : 'Yadda saxla'}
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.shareButton}
                        onPress={() =>
                          void shareRouteText(
                            plan,
                            plan.regionLabel,
                            weatherAdvice?.summary_az
                          ).catch((err) =>
                            Alert.alert('Paylaşım', getErrorMessage(err))
                          )
                        }
                      >
                        <Text style={styles.shareButtonText}>Paylaş</Text>
                      </TouchableOpacity>
                    </View>
                    <View style={styles.shareRow}>
                      <TouchableOpacity
                        style={styles.navButton}
                        onPress={() => {
                          if (fromOrigin && !userLocation) {
                            Alert.alert(
                              'Məkan',
                              'Cari məkan tapılmadı. Switch-i yenidən yandırın.'
                            );
                            return;
                          }
                          const stops = collectRouteStops(plan);
                          const withOrigin =
                            fromOrigin && userLocation
                              ? [
                                  {
                                    lat: userLocation.latitude,
                                    lng: userLocation.longitude,
                                    name: 'Mənim yerim',
                                  },
                                  ...stops,
                                ]
                              : stops;
                          void openRouteInGoogleMaps(withOrigin).catch((err) =>
                            Alert.alert('Naviqasiya', getErrorMessage(err))
                          );
                        }}
                      >
                        <Text style={styles.navButtonText}>Naviqasiyanı başlat</Text>
                      </TouchableOpacity>
                    </View>
                  </View>

                  {plan.days.map((day, dayIdx) => (
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
                        {day.estimated_cost ? (
                          <Text style={styles.dayCost} numberOfLines={1}>
                            {day.estimated_cost}
                          </Text>
                        ) : null}
                      </View>

                      {day.stops.map((stop, stopIdx) => {
                        const leg = stopDurations[legKey(dayIdx, stopIdx)];
                        const travel = isTravelStop(stop);
                        return (
                          <View
                            key={`${stop.poi_id}-${stopIdx}`}
                            style={styles.stopRow}
                          >
                            <View style={styles.stopTimeCol}>
                              <Text
                                style={[
                                  styles.stopTime,
                                  travel && styles.stopTimeTravel,
                                ]}
                              >
                                {stop.arrival_time || stop.visiting_time || stop.time}
                              </Text>
                              {stopIdx < day.stops.length - 1 ? (
                                <View
                                  style={[
                                    styles.stopTimeline,
                                    {
                                      backgroundColor: travel
                                        ? colors.textMuted + '55'
                                        : DAY_COLORS[dayIdx % DAY_COLORS.length] + '40',
                                    },
                                  ]}
                                />
                              ) : null}
                            </View>

                            <View
                              style={[
                                styles.stopCard,
                                travel && styles.stopCardTravel,
                              ]}
                            >
                              {travel ? (
                                <>
                                  <View style={styles.stopTitleRow}>
                                    <FontAwesome
                                      name="car"
                                      size={12}
                                      color={colors.textMuted}
                                    />
                                    <Text style={styles.travelBadge}>Yol / transfer</Text>
                                  </View>
                                  <Text style={styles.stopNameTravel} numberOfLines={2}>
                                    {stop.name}
                                  </Text>
                                  {stop.duration ? (
                                    <Text style={styles.stopDuration}>{stop.duration}</Text>
                                  ) : null}
                                </>
                              ) : (
                                <>
                                  <View style={styles.stopTitleRow}>
                                    {stop.sequence_order != null ? (
                                      <View
                                        style={[
                                          styles.stopSeqBadge,
                                          {
                                            backgroundColor:
                                              DAY_COLORS[dayIdx % DAY_COLORS.length],
                                          },
                                        ]}
                                      >
                                        <Text style={styles.stopSeqBadgeText}>
                                          {stop.sequence_order}
                                        </Text>
                                      </View>
                                    ) : null}
                                    <CategoryIcon
                                      category={stop.category}
                                      size={14}
                                      color={colors.text}
                                    />
                                    <Text style={styles.stopName} numberOfLines={2}>
                                      {stop.name}
                                    </Text>
                                  </View>
                                  {stop.duration ? (
                                    <Text style={styles.stopDuration}>{stop.duration}</Text>
                                  ) : null}
                                  {stop.tip ? (
                                    <Text style={styles.stopTip}>{stop.tip}</Text>
                                  ) : null}
                                  {leg ? (
                                    <View style={styles.stopLegBox}>
                                      <Text style={styles.stopLegPrimary}>
                                        🚗 {leg.duration}
                                      </Text>
                                      <Text style={styles.stopLegSecondary}>
                                        📍 {leg.distance}
                                      </Text>
                                    </View>
                                  ) : null}
                                </>
                              )}
                            </View>
                          </View>
                        );
                      })}

                      {day.notes ? (
                        <Text style={styles.dayNotes}>{day.notes}</Text>
                      ) : null}
                    </View>
                  ))}

                  <Pressable style={styles.secondaryButton} onPress={handleReset}>
                    <Text style={styles.secondaryButtonText}>Yeni marşrut hazırla</Text>
                  </Pressable>
                </ScrollView>
              )}
            </View>
          }
        />
    </SafeAreaView>
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
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.chip,
  },
  mapPlaceholderText: {
    fontSize: 12,
    color: colors.textMuted,
  },
  meMarker: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(37, 99, 235, 0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  meMarkerDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#2563EB',
  },
  travelMarker: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#64748B',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fff',
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
  profileCorner: {
    position: 'absolute',
    top: 12,
    right: 12,
    zIndex: 12,
  },
  resetBadge: {
    position: 'absolute',
    top: 12,
    left: 12,
    zIndex: 12,
    backgroundColor: 'white',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: colors.border,
    flexShrink: 1,
    maxWidth: '70%',
  },
  resetBadgeText: {
    fontSize: 13,
    color: colors.textSecondary,
    flexShrink: 1,
  },
  fromOriginRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
    marginTop: 4,
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
  travelNote: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.accentPressed,
    backgroundColor: colors.accentSoft,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 8,
  },
  lodgingNote: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.text,
    backgroundColor: colors.chip,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 8,
    marginTop: 6,
  },
  panel: {
    flex: 1,
    minHeight: 0,
    backgroundColor: colors.bg,
    overflow: 'hidden',
  },
  formContent: {
    paddingHorizontal: 12,
    paddingBottom: 24,
    flexGrow: 1,
  },
  planContent: {
    paddingHorizontal: 12,
    paddingBottom: 40,
    flexGrow: 1,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.4,
    marginTop: 4,
  },
  subtitle: {
    marginTop: 4,
    marginBottom: 12,
    fontSize: 12,
    fontWeight: '500',
    color: colors.textMuted,
    lineHeight: 17,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.chipText,
    marginBottom: 6,
    marginTop: 6,
  },
  required: {
    color: colors.danger,
  },
  chipRow: {
    paddingBottom: 6,
    gap: 6,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSoft,
    marginRight: 4,
    overflow: 'hidden',
  },
  chipSelected: {
    backgroundColor: colors.chipSelected,
    borderColor: colors.chipSelected,
  },
  chipText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.chipText,
  },
  chipTextSelected: {
    color: colors.textOnAccent,
  },
  interestGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 6,
  },
  interestChip: {
    width: '48%',
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSoft,
    backgroundColor: colors.surface,
    paddingVertical: 8,
    paddingHorizontal: 8,
    overflow: 'hidden',
  },
  interestChipSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  interestText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.chipText,
    textAlign: 'center',
    flexShrink: 1,
  },
  interestTextSelected: {
    color: colors.accentPressed,
  },
  primaryButton: {
    marginTop: 16,
    marginBottom: 16,
    backgroundColor: colors.accent,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    overflow: 'hidden',
  },
  primaryButtonDisabled: {
    opacity: 0.55,
  },
  primaryButtonText: {
    color: colors.textOnAccent,
    fontSize: 14,
    fontWeight: '700',
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  secondaryButton: {
    marginTop: 12,
    marginBottom: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.accent,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    overflow: 'hidden',
  },
  secondaryButtonText: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: '600',
  },
  errorText: {
    backgroundColor: colors.dangerSoft,
    color: colors.dangerText,
    borderRadius: 10,
    padding: 8,
    marginBottom: 6,
    fontSize: 12,
    overflow: 'hidden',
  },
  summaryCard: {
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSoft,
    gap: 8,
  },
  summaryText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    lineHeight: 20,
  },
  weatherNote: {
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 17,
  },
  summaryMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  summaryMeta: {
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: '600',
  },
  shareRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  saveButton: {
    flex: 1,
    borderRadius: 10,
    backgroundColor: colors.successSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.success,
    paddingVertical: 10,
    alignItems: 'center',
  },
  saveButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.success,
  },
  shareButton: {
    flex: 1,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSoft,
    backgroundColor: colors.bg,
    paddingVertical: 10,
    alignItems: 'center',
  },
  shareButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
  },
  navButton: {
    flex: 1,
    borderRadius: 10,
    backgroundColor: colors.accent,
    paddingVertical: 10,
    alignItems: 'center',
  },
  navButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textOnAccent,
  },
  dayBlock: {
    borderRadius: 12,
    padding: 10,
    marginBottom: 8,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSoft,
  },
  dayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  dayBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayBadgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  dayTitle: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
  },
  dayCost: {
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: '600',
  },
  dayNotes: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 6,
    fontStyle: 'italic',
  },
  stopRow: {
    flexDirection: 'row',
    paddingVertical: 6,
  },
  stopTimeCol: {
    width: 42,
    alignItems: 'center',
  },
  stopTime: {
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: '600',
  },
  stopTimeline: {
    width: 2,
    flex: 1,
    marginTop: 3,
    borderRadius: 1,
  },
  stopCard: {
    flex: 1,
    minWidth: 0,
    paddingLeft: 8,
    paddingBottom: 6,
  },
  stopCardTravel: {
    opacity: 0.92,
    paddingVertical: 4,
    paddingHorizontal: 6,
    marginLeft: 2,
    borderLeftWidth: 2,
    borderLeftColor: colors.textMuted,
    backgroundColor: colors.chip,
    borderRadius: 8,
  },
  stopTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  stopSeqBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  stopSeqBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#fff',
  },
  travelBadge: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  stopName: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
    flex: 1,
    minWidth: 0,
  },
  stopNameTravel: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textSecondary,
    marginTop: 2,
  },
  stopTimeTravel: {
    color: colors.textMuted,
    fontWeight: '500',
  },
  stopDuration: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 1,
  },
  stopTip: {
    fontSize: 11,
    color: colors.chipText,
    marginTop: 3,
    fontStyle: 'italic',
  },
  stopLegBox: {
    marginTop: 4,
    flexDirection: 'row',
    gap: 10,
  },
  stopLegPrimary: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.accent,
  },
  stopLegSecondary: {
    fontSize: 11,
    color: colors.textMuted,
  },
});
