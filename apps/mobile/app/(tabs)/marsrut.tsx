import Constants from 'expo-constants';
import * as Location from 'expo-location';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useEffect, useMemo, useRef, useState } from 'react';
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
import { DropdownButton } from '../../components/DropdownButton';
import { ProfileCornerButton } from '../../components/ProfileCornerButton';
import { ResizableSplit } from '../../components/ResizableSplit';
import { TripScheduleFields } from '../../components/TripScheduleFields';
import { DEFAULT_REGION_ID, REGIONS } from '../../constants/regions';
import { colors } from '../../constants/theme';
import { getErrorMessage } from '../../lib/errors';
import { useResponsiveLayout } from '../../lib/layout';
import { collectRouteStops, openRouteInGoogleMaps } from '../../lib/openNavigation';
import { planRoute as requestPlanRoute } from '../../lib/planRoute';
import { fetchRouteCandidates } from '../../lib/routeCandidates';
import { saveRoute, planDaysToSavedStops } from '../../lib/savedRoutes';
import { shareRouteText } from '../../lib/shareRoute';
import { supabase } from '../../lib/supabase';
import { triggerRegionPlacesSync } from '../../lib/syncPlaces';
import {
  defaultReturnAt,
  defaultTripStartAt,
  formatHhMm,
  isWithinWeatherForecast,
  startDayOffsetFromDate,
  syncReturnForTrip,
} from '../../lib/tripSchedule';
import { useInfoToast } from '../../components/InfoToastProvider';
import {
  applyWeatherPoiFilter,
  fetchRegionWeather,
  formatDayWeatherLabel,
  formatWeatherLabel,
  type WeatherAdvice,
} from '../../lib/weather';
import {
  optimizeRouteAndTimeline,
  parseDurationHours,
  type POI,
} from '../../utils/routeOptimizer';

type DayOption = 1 | 2 | 3;
type BudgetOption = 'budget' | 'mid' | 'premium';
type InterestId = 'nature' | 'history';
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
    leave_region_by?: string;
    return_origin_by?: string;
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

/** Hotel/travel legs create false zigzags on the map — keep them off polylines. */
function isMapPathStop(stop: {
  category?: string | null;
  daypart?: string | null;
}): boolean {
  if (isTravelStop(stop)) {
    return false;
  }
  const cat = String(stop.category || '').toLowerCase();
  const daypart = String(stop.daypart || '').toLowerCase();
  if (daypart === 'hotel') {
    return false;
  }
  if (cat === 'hotel' || cat === 'hostel' || cat === 'guesthouse') {
    return false;
  }
  return true;
}

const DAY_COLORS = [
  colors.accent,
  colors.success,
  colors.warning,
  colors.accentPressed,
  colors.danger,
];

const DAY_OPTIONS: { value: DayOption; label: string }[] = [
  { value: 1, label: '1 gün' },
  { value: 2, label: '2 gün' },
  { value: 3, label: '3 gün' },
];

const BUDGET_OPTIONS: { value: BudgetOption; label: string }[] = [
  { value: 'budget', label: 'Ekonom' },
  { value: 'mid', label: 'Orta' },
  { value: 'premium', label: 'Premium' },
];

const INTEREST_OPTIONS: { id: InterestId; label: string }[] = [
  { id: 'nature', label: 'Təbiət' },
  { id: 'history', label: 'Tarixi' },
];

const INTEREST_ATTRACTION_CATS: Record<InterestId, string[]> = {
  nature: ['nature', 'waterfall', 'mountain', 'lake'],
  history: ['historical', 'monument'],
};

const AI_LOADING_MESSAGES = [
  'Region üzrə yerlər yığılır...',
  'Maraqlarınıza uyğun dayanacaqlar seçilir...',
  'Günlər üzrə marşrut düzülür...',
  'Məsafə və vaxtlar hesablanır...',
  'AI ən yaxşı ardıcıllığı axtarır...',
  'Son toxunuşlar edilir...',
  'Demək olar hazırdır...',
];

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
  const fitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { showInfo } = useInfoToast();
  const responsive = useResponsiveLayout();
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
  const [loadingMessage, setLoadingMessage] = useState(AI_LOADING_MESSAGES[0]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [plan, setPlan] = useState<GeneratedPlan | null>(null);
  const [weatherAdvice, setWeatherAdvice] = useState<WeatherAdvice | null>(null);
  const [routeSegments, setRouteSegments] = useState<RouteSegment[]>([]);
  const [stopDurations, setStopDurations] = useState<Record<string, StopDuration>>({});
  const [fromOrigin, setFromOrigin] = useState(false);
  const [startAt, setStartAt] = useState(() => defaultTripStartAt());
  const [returnAt, setReturnAt] = useState(() => defaultReturnAt());
  const startDayOffset = startDayOffsetFromDate(startAt);
  const departTime = formatHhMm(startAt);
  const returnByTime = formatHhMm(returnAt);
  const [userLocation, setUserLocation] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [mapSize, setMapSize] = useState<{ width: number; height: number } | null>(null);
  /** Forma: xəritə gizli; plan: ~yarı yarı — istifadəçi yenə sürükləyə bilər */
  const [splitRatio, setSplitRatio] = useState(MARSRUT_FORM_SPLIT);
  const [savingRoute, setSavingRoute] = useState(false);
  /**
   * Android: custom Marker children often invisible unless tracksViewChanges
   * is true during first paint. Split resize remounts the map — re-pulse.
   */
  const [tracksMarkers, setTracksMarkers] = useState(true);

  useEffect(
    () => () => {
      if (fitTimerRef.current) {
        clearTimeout(fitTimerRef.current);
      }
    },
    []
  );

  useEffect(() => {
    if (!plan) {
      return;
    }
    let alive = true;
    setTracksMarkers(true);
    const t = setTimeout(() => {
      if (alive) {
        setTracksMarkers(false);
      }
    }, 600);
    return () => {
      alive = false;
      clearTimeout(t);
    };
    // Only when plan identity changes — not on map resize / polyline updates
  }, [plan]);

  const canSubmit = useMemo(
    () => Boolean(regionId && days && budget && interests.length > 0),
    [regionId, days, budget, interests]
  );

  const regionMeta = useMemo(
    () => REGIONS.find((r) => r.id === regionId) ?? REGIONS[0],
    [regionId]
  );

  /** Flat map markers for every day — jitter stacked coords so day-1 isn't hidden under day-2. */
  const planMapMarkers = useMemo(() => {
    if (!plan?.days?.length) {
      return [] as Array<{
        key: string;
        dayIdx: number;
        lat: number;
        lng: number;
        travel: boolean;
        title: string;
        description: string;
        label: string;
        isFirstVisit: boolean;
        isLastVisit: boolean;
        zIndex: number;
      }>;
    }

    const totalDays = plan.days.length;
    const isSingleDay = totalDays <= 1;
    const lastDayIdx = totalDays - 1;
    const lastDayVisitIdx = (plan.days[lastDayIdx]?.stops || [])
      .map((s, i) => (isTravelStop(s) ? -1 : i))
      .filter((i) => i >= 0)
      .pop();

    const coordCount = new Map<string, number>();
    const out: Array<{
      key: string;
      dayIdx: number;
      lat: number;
      lng: number;
      travel: boolean;
      title: string;
      description: string;
      label: string;
      isFirstVisit: boolean;
      isLastVisit: boolean;
      zIndex: number;
    }> = [];

    plan.days.forEach((day, dayIdx) => {
      const visitStops = (day.stops || []).filter((s) => !isTravelStop(s));
      (day.stops || []).forEach((stop, stopIdx) => {
        let lat = Number(stop.lat);
        let lng = Number(stop.lng);
        if (
          !Number.isFinite(lat) ||
          !Number.isFinite(lng) ||
          (Math.abs(lat) < 0.01 && Math.abs(lng) < 0.01)
        ) {
          return;
        }

        // Separate pins that share the same GPS (common for nearby cafes)
        const slot = `${lat.toFixed(5)},${lng.toFixed(5)}`;
        const n = coordCount.get(slot) ?? 0;
        coordCount.set(slot, n + 1);
        if (n > 0) {
          lat += n * 0.00022;
          lng += n * 0.00016;
        }

        const travel = isTravelStop(stop);
        if (travel) {
          out.push({
            key: `d${dayIdx}-s${stopIdx}-travel`,
            dayIdx,
            lat,
            lng,
            travel: true,
            title: stop.name || 'Yol',
            description: stop.duration || 'Transfer',
            label: '',
            isFirstVisit: false,
            isLastVisit: false,
            zIndex: 50 + dayIdx,
          });
          return;
        }

        const visitIndex =
          visitStops.findIndex(
            (s) =>
              s === stop ||
              (Boolean(s.poi_id) &&
                s.poi_id === stop.poi_id &&
                s.time === stop.time)
          ) + 1;
        const sequenceNumber =
          stop.sequence_order != null && stop.sequence_order > 0
            ? stop.sequence_order
            : visitIndex > 0
              ? visitIndex
              : stopIdx + 1;
        const isFirstVisit = dayIdx === 0 && sequenceNumber === 1;
        const isLastVisit = dayIdx === lastDayIdx && stopIdx === lastDayVisitIdx;
        const label = isSingleDay
          ? String(sequenceNumber)
          : `${dayIdx + 1}.${sequenceNumber}`;

        out.push({
          key: `d${dayIdx}-s${stopIdx}-v${sequenceNumber}-${stop.poi_id || stopIdx}`,
          dayIdx,
          lat,
          lng,
          travel: false,
          title: stop.name || 'Yer',
          description: `${stop.arrival_time || stop.visiting_time || stop.time || ''} — ${stop.duration || ''}`,
          label,
          isFirstVisit,
          isLastVisit: Boolean(isLastVisit),
          // Day 1 on top of later days when overlapping
          zIndex: isFirstVisit ? 1000 : 200 - dayIdx * 10 + sequenceNumber,
        });
      });
    });

    return out;
  }, [plan]);

  // After plan + map layout: fit every day's pins (day-1 included)
  useEffect(() => {
    if (!plan || !mapSize || planMapMarkers.length === 0) {
      return;
    }
    const coords = planMapMarkers.map((m) => ({
      latitude: m.lat,
      longitude: m.lng,
    }));
    const t = setTimeout(() => {
      mapRef.current?.fitToCoordinates(coords, {
        edgePadding: { top: 72, right: 48, bottom: 48, left: 48 },
        animated: true,
      });
    }, 400);
    return () => clearTimeout(t);
  }, [plan, mapSize, planMapMarkers]);

  useEffect(() => {
    if (!loading) {
      setLoadingMessage(AI_LOADING_MESSAGES[0]);
      return;
    }

    let index = 0;
    setLoadingMessage(AI_LOADING_MESSAGES[0]);
    const timer = setInterval(() => {
      index = (index + 1) % AI_LOADING_MESSAGES.length;
      setLoadingMessage(AI_LOADING_MESSAGES[index]);
    }, 2200);

    return () => clearInterval(timer);
  }, [loading]);

  // Seçilmiş rayon üçün hava — forma açıq olanda (OpenWeather ~5 gün)
  useEffect(() => {
    if (plan) {
      return;
    }
    if (!isWithinWeatherForecast(startAt)) {
      setWeatherAdvice(null);
      return;
    }
    let cancelled = false;
    void fetchRegionWeather(regionId, days, startDayOffset).then((data) => {
      if (!cancelled) {
        setWeatherAdvice(data);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [regionId, days, startDayOffset, startAt, plan]);

  // Background: OSM attractions → pois (insert-if-missing); AI still reads DB
  useEffect(() => {
    triggerRegionPlacesSync(regionId);
  }, [regionId]);

  useEffect(() => {
    setReturnAt((prev) => syncReturnForTrip(startAt, prev, days, false));
    // Only re-align return day when trip length changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

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
    setMapSize(null);
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
          if (!isMapPathStop(stop)) {
            return;
          }
          const lat = Number(stop.lat);
          const lng = Number(stop.lng);
          if (Number.isFinite(lat) && Number.isFinite(lng) && (Math.abs(lat) > 0.01 || Math.abs(lng) > 0.01)) {
            stops.push({
              lat,
              lng,
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

      // Instant straight segments so UI stays responsive while Directions loads
      const straightSegments: RouteSegment[] = [];
      dayStopLists.forEach((stops, dayIdx) => {
        const color = DAY_COLORS[dayIdx % DAY_COLORS.length];
        for (let i = 0; i < stops.length - 1; i++) {
          straightSegments.push({
            coordinates: [
              { latitude: stops[i].lat, longitude: stops[i].lng },
              { latitude: stops[i + 1].lat, longitude: stops[i + 1].lng },
            ],
            color,
          });
        }
      });
      setRouteSegments(straightSegments);

      if (fitCoords.length > 0 && mapRef.current) {
        if (fitTimerRef.current) {
          clearTimeout(fitTimerRef.current);
        }
        fitTimerRef.current = setTimeout(() => {
          fitTimerRef.current = null;
          mapRef.current?.fitToCoordinates(fitCoords, {
            edgePadding: { top: 72, right: 48, bottom: 48, left: 48 },
            animated: true,
          });
        }, 350);
      }

      if (!GOOGLE_MAPS_KEY) {
        return;
      }

      type LegJob = {
        dayIdx: number;
        legIdx: number;
        origin: { lat: number; lng: number };
        dest: { lat: number; lng: number };
        color: string;
      };
      const jobs: LegJob[] = [];
      dayStopLists.forEach((stops, dayIdx) => {
        const color = DAY_COLORS[dayIdx % DAY_COLORS.length];
        for (let i = 0; i < stops.length - 1; i++) {
          jobs.push({
            dayIdx,
            legIdx: i,
            origin: stops[i],
            dest: stops[i + 1],
            color,
          });
        }
      });

      const durations: Record<string, StopDuration> = {};
      const enriched: RouteSegment[] = new Array(jobs.length);

      const fetchLeg = async (job: LegJob, index: number) => {
        const url =
          'https://maps.googleapis.com/maps/api/directions/json?' +
          `origin=${job.origin.lat},${job.origin.lng}` +
          `&destination=${job.dest.lat},${job.dest.lng}` +
          '&mode=driving&language=az&key=' +
          GOOGLE_MAPS_KEY;
        try {
          const response = await fetch(url);
          const data = await response.json();
          if (data.status === 'OK' && data.routes?.[0]) {
            const route = data.routes[0];
            const leg = route.legs?.[0];
            const raw = decodePolyline(route.overview_polyline.points);
            const points =
              raw.length > 40 ? raw.filter((_, i) => i % 3 === 0 || i === raw.length - 1) : raw;
            enriched[index] = {
              coordinates: [
                { latitude: job.origin.lat, longitude: job.origin.lng },
                ...points,
                { latitude: job.dest.lat, longitude: job.dest.lng },
              ],
              color: job.color,
            };
            durations[legKey(job.dayIdx, job.legIdx)] = {
              duration: leg?.duration?.text || '',
              distance: leg?.distance?.text || '',
            };
            return;
          }
        } catch {
          // fall through
        }
        enriched[index] = {
          coordinates: [
            { latitude: job.origin.lat, longitude: job.origin.lng },
            { latitude: job.dest.lat, longitude: job.dest.lng },
          ],
          color: job.color,
        };
      };

      const CONCURRENCY = 4;
      for (let i = 0; i < jobs.length; i += CONCURRENCY) {
        await Promise.all(
          jobs.slice(i, i + CONCURRENCY).map((job, offset) => fetchLeg(job, i + offset))
        );
      }

      setRouteSegments(enriched.filter(Boolean));
      setStopDurations(durations);
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

      const weather = await fetchRegionWeather(regionId, days, startDayOffset);
      setWeatherAdvice(weather);

      let restaurants: any[] = [];
      let accommodations: any[] = [];
      let attractions: any[] = [];

      const ranked = await fetchRouteCandidates(regionId, 48, {
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
          .select(
            'id, name, category, categories, description, lat, lng, region, rating, rating_count'
          )
          .eq('status', 'approved')
          .eq('region', regionId.toLowerCase())
          .order('rating', { ascending: false, nullsFirst: false })
          .limit(400);

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
        const poiCats = (p: any): string[] => {
          if (Array.isArray(p.categories) && p.categories.length > 0) {
            return p.categories.map(String);
          }
          return p.category ? [String(p.category)] : [];
        };
        const hasAny = (p: any, allowed: string[]) =>
          poiCats(p).some((c) => allowed.includes(c));

        restaurants = pois
          .filter((p) => hasAny(p, ['restaurant', 'home_restaurant', 'cafe']))
          .sort(byRating)
          .slice(0, 40);
        accommodations = pois
          .filter((p) => hasAny(p, ['hotel', 'hostel', 'guesthouse', 'camping']))
          .sort(byRating)
          .slice(0, 40);
        attractions = preferAttractionsForInterests(
          pois
            .filter((p) =>
              hasAny(p, [
                'nature',
                'waterfall',
                'mountain',
                'lake',
                'historical',
                'monument',
                'other',
              ])
            )
            .sort(byRating),
          interests
        ).slice(0, 60);
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
        departTime: fromOrigin ? departTime : undefined,
        returnByTime: fromOrigin ? returnByTime : undefined,
        varietySeed: Date.now() ^ (Math.floor(Math.random() * 1_000_000_000) + 1),
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
                  tip: String(stop.tip ?? ''),
                  daypart,
                  sequence_order: travel ? null : visitSeq,
                  arrival_time: String(stop.time ?? ''),
                  visiting_time: String(stop.time ?? ''),
                };
              })
              .filter(
                (s) =>
                  Number.isFinite(s.lat) &&
                  Number.isFinite(s.lng) &&
                  !(Math.abs(s.lat) < 0.01 && Math.abs(s.lng) < 0.01)
              ),
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
          .filter(
            (p) =>
              Number.isFinite(p.lat) &&
              Number.isFinite(p.lng) &&
              !(Math.abs(p.lat) < 0.01 && Math.abs(p.lng) < 0.01)
          );

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
              tip: String((original as { tip?: string }).tip ?? ''),
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
      // Fit all days after layout; do not animateToRegion (hides day-1 cluster)
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
              } else {
                setMapSize(null);
              }
            }}
          >
            {mapSize ? (
              <MapView
                key={plan ? `marsrut-plan-${plan.regionLabel}-${plan.daysCount}` : 'marsrut-form'}
                ref={mapRef as never}
                style={{ width: mapSize.width, height: mapSize.height }}
                provider={PROVIDER_GOOGLE}
                {...(Platform.OS === 'web'
                  ? {
                      googleMapsApiKey:
                        process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY || undefined,
                    }
                  : {})}
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
                      tracksViewChanges={tracksMarkers}
                    >
                      <View style={styles.meMarker}>
                        <View style={styles.meMarkerDot} />
                      </View>
                    </Marker>
                  ) : null}

                  {planMapMarkers.map((m) => {
                    if (m.travel) {
                      return (
                        <Marker
                          key={m.key}
                          coordinate={{ latitude: m.lat, longitude: m.lng }}
                          title={m.title}
                          description={m.description}
                          tracksViewChanges={tracksMarkers}
                          zIndex={m.zIndex}
                        >
                          <View style={styles.travelMarker}>
                            <FontAwesome name="car" size={11} color="#fff" />
                          </View>
                        </Marker>
                      );
                    }
                    return (
                      <Marker
                        key={m.key}
                        coordinate={{ latitude: m.lat, longitude: m.lng }}
                        title={m.title}
                        description={m.description}
                        tracksViewChanges={tracksMarkers}
                        zIndex={m.zIndex}
                      >
                        <View
                          style={[
                            styles.markerBubble,
                            m.isFirstVisit && styles.markerBubbleStart,
                            m.isLastVisit && !m.isFirstVisit && styles.markerBubbleFinish,
                            !m.isFirstVisit &&
                              !m.isLastVisit && {
                                backgroundColor: DAY_COLORS[m.dayIdx % DAY_COLORS.length],
                              },
                          ]}
                        >
                          {m.isFirstVisit || m.isLastVisit ? (
                            <View style={styles.markerInner}>
                              <FontAwesome
                                name={m.isFirstVisit ? 'flag' : 'flag-checkered'}
                                size={10}
                                color="#fff"
                              />
                              <Text style={styles.markerText}>{m.label}</Text>
                            </View>
                          ) : (
                            <Text style={styles.markerText}>{m.label}</Text>
                          )}
                        </View>
                      </Marker>
                    );
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
              {plan ? <ProfileCornerButton style={styles.profileCorner} /> : null}
            </View>
          }
          bottom={
            <View style={styles.panel}>
              {!plan ? (
                <ScrollView
                  style={styles.flex}
                  contentContainerStyle={[
                    styles.formContent,
                    {
                      paddingHorizontal: responsive.padH,
                      paddingBottom: responsive.formBottomPad,
                    },
                  ]}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                >
                  <View style={styles.formHeader}>
                    <View style={styles.formHeaderText}>
                      <Text
                        style={[styles.title, { fontSize: responsive.titleSize }]}
                        numberOfLines={2}
                      >
                        AI Marşrut Planlayıcı
                      </Text>
                      <Text
                        style={[styles.subtitle, { fontSize: responsive.subtitleSize }]}
                        numberOfLines={2}
                      >
                        Sizin üçün ən optimal marşrutu hazırlayırıq
                      </Text>
                    </View>
                    <ProfileCornerButton />
                  </View>

                  {errorMessage ? (
                    <Text style={styles.errorText}>{errorMessage}</Text>
                  ) : null}

                  <View style={styles.regionDaysRow}>
                    <DropdownButton
                      caption="Region"
                      label="Region seç"
                      value={regionId}
                      options={REGIONS.map((r) => ({ value: r.id, label: r.label }))}
                      compact
                      onSelect={(id) => {
                        setRegionId(id);
                        const region = REGIONS.find((r) => r.id === id);
                        if (region) {
                          mapRef.current?.animateToRegion(
                            {
                              latitude: region.latitude,
                              longitude: region.longitude,
                              latitudeDelta: region.latitudeDelta,
                              longitudeDelta: region.longitudeDelta,
                            },
                            600
                          );
                        }
                      }}
                      style={styles.regionDaysField}
                    />
                    <DropdownButton
                      caption="Gün sayı"
                      label="Gün seç"
                      value={String(days)}
                      options={DAY_OPTIONS.map((o) => ({
                        value: String(o.value),
                        label: o.label,
                      }))}
                      compact
                      onSelect={(v) => setDays(Number(v) as DayOption)}
                      style={styles.regionDaysField}
                    />
                  </View>

                  <TripScheduleFields
                    fromOrigin={fromOrigin}
                    startAt={startAt}
                    returnAt={returnAt}
                    onStartAtChange={setStartAt}
                    onReturnAtChange={setReturnAt}
                    tripDays={days}
                    showStartDay
                    showTimes={false}
                    weather={weatherAdvice}
                    showWeather={Boolean(regionId)}
                  />

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
                  <TripScheduleFields
                    fromOrigin={fromOrigin}
                    startAt={startAt}
                    returnAt={returnAt}
                    onStartAtChange={setStartAt}
                    onReturnAtChange={setReturnAt}
                    tripDays={days}
                    showStartDay={false}
                    showTimes
                    weather={weatherAdvice}
                    showWeather={false}
                  />

                  <Text style={styles.label}>
                    Büdcə <Text style={styles.required}>*</Text>
                  </Text>
                  <View style={styles.optionRow}>
                    {BUDGET_OPTIONS.map((option) => {
                      const selected = option.value === budget;
                      return (
                        <Pressable
                          key={option.value}
                          onPress={() => setBudget(option.value)}
                          style={[styles.optionChip, selected && styles.optionChipSelected]}
                        >
                          <Text
                            style={[
                              styles.optionChipText,
                              selected && styles.optionChipTextSelected,
                            ]}
                            numberOfLines={1}
                          >
                            {option.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  <Text style={styles.label}>
                    Maraqlar <Text style={styles.required}>*</Text>
                  </Text>
                  <View style={styles.optionRow}>
                    {INTEREST_OPTIONS.map((option) => {
                      const selected = interests.includes(option.id);
                      return (
                        <Pressable
                          key={option.id}
                          onPress={() => toggleInterest(option.id)}
                          style={[
                            styles.optionChip,
                            selected && styles.optionChipAccent,
                          ]}
                        >
                          <Text
                            style={[
                              styles.optionChipText,
                              selected && styles.optionChipTextAccent,
                            ]}
                            numberOfLines={1}
                          >
                            {option.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  <Text style={styles.label}>Neçə nəfər (istəyə bağlı)</Text>
                  <View style={styles.optionRow}>
                    {GROUP_OPTIONS.map((option) => {
                      const selected = option.value === group;
                      return (
                        <Pressable
                          key={option.value}
                          onPress={() => setGroup(selected ? null : option.value)}
                          style={[styles.optionChip, selected && styles.optionChipSelected]}
                        >
                          <Text
                            style={[
                              styles.optionChipText,
                              selected && styles.optionChipTextSelected,
                            ]}
                            numberOfLines={1}
                          >
                            {option.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  <Pressable
                    style={[
                      styles.primaryButton,
                      (!canSubmit || loading) && styles.primaryButtonDisabled,
                    ]}
                    onPress={planRoute}
                    disabled={!canSubmit || loading}
                  >
                    {loading ? (
                      <View style={styles.loadingBlock}>
                        <View style={styles.loadingRow}>
                          <ActivityIndicator color="#fff" />
                          <Text style={styles.primaryButtonText} numberOfLines={2}>
                            {loadingMessage}
                          </Text>
                        </View>
                        <Text style={styles.loadingHint}>
                          Bir neçə saniyə çəkə bilər — rahat gözləyin
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
                    <View style={styles.summaryTitleRow}>
                      <Text style={styles.summaryText} numberOfLines={1}>
                        {plan.regionLabel} · {plan.daysCount} gün
                      </Text>
                    </View>
                    {plan.total_cost ? (
                      <View style={styles.summaryMetaRow}>
                        <Text style={styles.summaryMeta} numberOfLines={1}>
                          {plan.total_cost}
                        </Text>
                      </View>
                    ) : null}
                    {plan.travel?.from_origin ? (
                      <Text style={styles.travelNote}>
                        Yola ~{Math.round(plan.travel.outbound_minutes ?? 0)} dəq
                        {plan.travel.distance_km
                          ? ` · ${plan.travel.distance_km.toFixed(0)} km`
                          : ''}
                        {plan.travel.depart_origin_at
                          ? ` · çıxış ${plan.travel.depart_origin_at}`
                          : ''}
                        {plan.travel.return_origin_by
                          ? ` · qayıdış ${plan.travel.return_origin_by}`
                          : ''}
                      </Text>
                    ) : null}
                    {formatWeatherLabel(weatherAdvice) ? (
                      <View style={styles.planWeatherStrip}>
                        <Text style={styles.planWeatherStripText} numberOfLines={2}>
                          Hava · {formatWeatherLabel(weatherAdvice)}
                        </Text>
                      </View>
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
                            formatWeatherLabel(weatherAdvice) ?? undefined
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
                        <View style={styles.dayHeaderMain}>
                          <Text style={styles.dayTitle} numberOfLines={2}>
                            {day.title}
                          </Text>
                          {formatDayWeatherLabel(weatherAdvice, dayIdx) ? (
                            <Text style={styles.dayWeather} numberOfLines={1}>
                              {formatDayWeatherLabel(weatherAdvice, dayIdx)}
                            </Text>
                          ) : null}
                        </View>
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
                                  {stop.tip?.trim() ? (
                                    <Text style={styles.travelTip} numberOfLines={2}>
                                      {stop.tip.trim()}
                                    </Text>
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
                                  {stop.tip?.trim() &&
                                  !/səhər yemə|nahar üçün|istirahət və gecələ/i.test(
                                    stop.tip
                                  ) ? (
                                    <Text style={styles.stopTip} numberOfLines={2}>
                                      {stop.tip.trim()}
                                    </Text>
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

                      {day.notes?.trim() &&
                      !day.notes.includes('Səhər →') &&
                      !day.notes.startsWith('Gecələmə:') ? (
                        <Text style={styles.dayNotes}>{day.notes.trim()}</Text>
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
    marginBottom: 0,
    marginTop: 8,
    minHeight: 40,
  },
  regionDaysRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
    marginBottom: 0,
    zIndex: 1,
  },
  regionDaysField: {
    flex: 1,
    height: 40,
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
  planWeatherStrip: {
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: colors.surfaceMuted,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSoft,
  },
  planWeatherStripText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.chipText,
    lineHeight: 16,
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
  },
  formHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 4,
  },
  formHeaderText: {
    flex: 1,
    minWidth: 0,
    paddingRight: 4,
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
    flexShrink: 1,
  },
  subtitle: {
    marginTop: 4,
    marginBottom: 12,
    fontSize: 12,
    fontWeight: '500',
    color: colors.textMuted,
    lineHeight: 17,
    flexShrink: 1,
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
    alignItems: 'center',
  },
  chip: {
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSoft,
    marginRight: 4,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
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
  /** Equal-width fixed-height option chips — no grow/shrink on select. */
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
    height: 36,
  },
  optionChip: {
    flex: 1,
    height: 36,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSoft,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    overflow: 'hidden',
  },
  optionChipSelected: {
    backgroundColor: colors.chipSelected,
    borderColor: colors.chipSelected,
  },
  optionChipAccent: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  optionChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.chipText,
    textAlign: 'center',
  },
  optionChipTextSelected: {
    color: colors.textOnAccent,
  },
  optionChipTextAccent: {
    color: colors.accentPressed,
  },
  interestGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 6,
  },
  interestChip: {
    flexGrow: 1,
    flexBasis: '47%',
    maxWidth: '100%',
    minWidth: 0,
    height: 36,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSoft,
    backgroundColor: colors.surface,
    paddingHorizontal: 8,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
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
    flexShrink: 1,
  },
  loadingBlock: {
    alignItems: 'center',
    gap: 6,
    maxWidth: '100%',
    paddingHorizontal: 4,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    maxWidth: '100%',
  },
  loadingHint: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 11,
    fontWeight: '500',
    textAlign: 'center',
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
  summaryTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  summaryText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
    lineHeight: 20,
    minWidth: 0,
  },
  weatherNote: {
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 17,
  },
  weatherChip: {
    flexShrink: 0,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: colors.accentSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.accent,
    maxWidth: '46%',
  },
  weatherChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.accentPressed,
    lineHeight: 16,
  },
  mapWeatherBadge: {
    position: 'absolute',
    top: 10,
    right: 52,
    zIndex: 20,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSoft,
  },
  mapWeatherBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.text,
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
    minWidth: 0,
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
  },
  dayHeaderMain: {
    flex: 1,
    minWidth: 0,
  },
  dayWeather: {
    fontSize: 11,
    color: colors.accent,
    marginTop: 3,
    fontWeight: '500',
  },
  dayCost: {
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: '600',
    flexShrink: 1,
    maxWidth: '42%',
    textAlign: 'right',
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
  travelTip: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 4,
    lineHeight: 15,
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
