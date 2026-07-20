import Constants from 'expo-constants';
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
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
import { ResizableSplit } from '../../components/ResizableSplit';
import { getCategoryEmoji } from '../../lib/categoryUtils';
import { getErrorMessage } from '../../lib/errors';
import { shareRoutePdf, shareRouteText } from '../../lib/shareRoute';
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
  const [routeCoordinates, setRouteCoordinates] = useState<LatLng[]>([]);
  const [stopDurations, setStopDurations] = useState<StopDuration[]>([]);
  const mapRef = useRef<MapRef | null>(null);
  const GOOGLE_MAPS_KEY =
    Constants.expoConfig?.extra?.googleMapsKey ||
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY ||
    '';

  const fetchRouteFromGoogle = async (planData: any) => {
    try {
      if (!GOOGLE_MAPS_KEY) {
        console.log('Google Maps key yoxdur — route atlanır');
        // Xəta verməsin, sadəcə polyline olmadan davam et
        // Yalnız marker-lər göstərilsin

        const allCoords: Array<{ latitude: number; longitude: number }> = [];

        planData.days?.forEach((day: any) => {
          day.stops?.forEach((stop: any) => {
            if (stop.lat && stop.lng) {
              allCoords.push({
                latitude: Number(stop.lat),
                longitude: Number(stop.lng),
              });
            }
          });
        });

        setRouteCoordinates(allCoords);

        if (allCoords.length > 0 && mapRef.current) {
          mapRef.current.fitToCoordinates(allCoords, {
            edgePadding: {
              top: 60,
              right: 40,
              bottom: 40,
              left: 40,
            },
            animated: true,
          });
        }
        return;
      }

      const allStops: Array<{ lat: number; lng: number; name: string }> = [];

      planData.days?.forEach((day: any) => {
        day.stops?.forEach((stop: any) => {
          if (stop.lat && stop.lng) {
            allStops.push({
              lat: Number(stop.lat),
              lng: Number(stop.lng),
              name: stop.name,
            });
          }
        });
      });

      if (allStops.length < 2) {
        const singleCoords = allStops.map((s) => ({
          latitude: s.lat,
          longitude: s.lng,
        }));
        setRouteCoordinates(singleCoords);
        if (singleCoords.length > 0 && mapRef.current) {
          mapRef.current.fitToCoordinates(singleCoords, {
            edgePadding: { top: 60, right: 40, bottom: 40, left: 40 },
            animated: true,
          });
        }
        return;
      }

      const allCoords: LatLng[] = [];
      const durations: StopDuration[] = [];

      for (let i = 0; i < allStops.length - 1; i++) {
        const origin = allStops[i];
        const dest = allStops[i + 1];

        const url =
          'https://maps.googleapis.com/maps/api/directions/json?' +
          'origin=' +
          origin.lat +
          ',' +
          origin.lng +
          '&destination=' +
          dest.lat +
          ',' +
          dest.lng +
          '&mode=driving' +
          '&language=az' +
          '&key=' +
          GOOGLE_MAPS_KEY;

        const response = await fetch(url);
        const data = await response.json();

        if (data.status === 'OK' && data.routes?.[0]) {
          const route = data.routes[0];
          const leg = route.legs?.[0];
          const points = decodePolyline(route.overview_polyline.points);

          if (i === 0) {
            allCoords.push({
              latitude: origin.lat,
              longitude: origin.lng,
            });
          }
          allCoords.push(...points);
          allCoords.push({
            latitude: dest.lat,
            longitude: dest.lng,
          });

          durations.push({
            from: origin.name,
            to: dest.name,
            duration: leg?.duration?.text || '',
            distance: leg?.distance?.text || '',
          });
        }
      }

      setRouteCoordinates(allCoords);
      setStopDurations(durations);

      if (allCoords.length > 0 && mapRef.current) {
        mapRef.current.fitToCoordinates(allCoords, {
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

      const { data: poisRaw, error: poisError } = await supabase
        .from('pois')
        .select('id, name, category, description, lat, lng, region')
        .eq('status', 'approved')
        .eq('region', selectedRegion.toLowerCase())
        .limit(40);

      if (poisError) {
        throw poisError;
      }

      if (!poisRaw || poisRaw.length === 0) {
        setError('Bu bölgədə hələ yer əlavə edilməyib. Başqa rayon seçin.');
        return;
      }

      const weather = await fetchRegionWeather(selectedRegion, selectedDays);
      setWeatherAdvice(weather);
      const pois = applyWeatherPoiFilter(poisRaw, weather);

      const restaurants = pois.filter((p) =>
        ['restaurant', 'home_restaurant', 'cafe'].includes(p.category)
      );
      const accommodations = pois.filter((p) =>
        ['hotel', 'hostel', 'guesthouse'].includes(p.category)
      );
      const attractions = pois.filter((p) =>
        [
          'nature',
          'waterfall',
          'mountain',
          'lake',
          'historical',
          'monument',
          'other',
        ].includes(p.category)
      );

      const response = await supabase.functions.invoke('plan-route', {
        body: {
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
        },
      });

      if (response.error) {
        throw response.error;
      }

      const rawData = response.data;

      let planData: any = null;

      if (typeof rawData === 'string') {
        let cleaned = rawData.trim();
        if (cleaned.startsWith('```json')) {
          cleaned = cleaned
            .replace(/^```json\n?/, '')
            .replace(/\n?```$/, '')
            .trim();
        } else if (cleaned.startsWith('```')) {
          cleaned = cleaned
            .replace(/^```\n?/, '')
            .replace(/\n?```$/, '')
            .trim();
        }
        planData = JSON.parse(cleaned);
      } else {
        planData = rawData;
      }

      if (planData?.error) {
        throw new Error(String(planData.error));
      }

      if (!planData?.days || !Array.isArray(planData.days)) {
        setError('Marşrut düzgün formada gəlmədi. Yenidən cəhd edin.');
        setLoading(false);
        return;
      }

      planData.days = planData.days.map((day: any) => ({
        ...day,
        stops: Array.isArray(day.stops)
          ? day.stops
          : Array.isArray(day.pois)
            ? day.pois
            : [],
      }));

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
                        { backgroundColor: DAY_COLORS[dayIdx % DAY_COLORS.length] },
                      ]}
                    >
                      <Text style={styles.markerText}>
                        {dayIdx + 1}.{stop.sequence_order ?? stopIdx + 1}
                      </Text>
                    </View>
                  </Marker>
                );
              })
            )}

            {routeCoordinates.length > 1 ? (
              <Polyline
                coordinates={routeCoordinates}
                strokeColor={colors.accent}
                strokeWidth={3}
                lineDashPattern={[1]}
              />
            ) : null}
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
                  setRouteCoordinates([]);
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

          {stopDurations.length > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.durationScroll}
              contentContainerStyle={styles.durationScrollContent}
            >
              {stopDurations.map((leg, idx) => (
                <View key={`${leg.from}-${leg.to}-${idx}`} style={styles.durationChip}>
                  <Text style={styles.durationPrimary} numberOfLines={1}>
                    🚗 {leg.duration}
                  </Text>
                  <Text style={styles.durationSecondary} numberOfLines={1}>
                    {leg.distance}
                  </Text>
                </View>
              ))}
            </ScrollView>
          ) : null}
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
                    style={[styles.shareButton, styles.shareButtonSecondary]}
                    onPress={() =>
                      void shareRoutePdf(
                        plan,
                        selectedRegion ?? 'region',
                        weatherAdvice?.summary_az
                      ).catch((err) => Alert.alert('PDF', getErrorMessage(err)))
                    }
                  >
                    <Text style={[styles.shareButtonText, styles.shareButtonTextSecondary]}>
                      PDF
                    </Text>
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

                        <TouchableOpacity
                          onPress={() =>
                            Linking.openURL(
                              `https://maps.google.com/?q=${stop.lat},${stop.lng}`
                            )
                          }
                          style={styles.mapsLink}
                        >
                          <Text style={styles.mapsLinkText}>
                            🗺️ Google Maps-də aç
                          </Text>
                        </TouchableOpacity>
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
    alignItems: 'center',
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
    right: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
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
  durationScroll: {
    position: 'absolute',
    bottom: 8,
    left: 0,
    right: 0,
  },
  durationScrollContent: {
    paddingHorizontal: 8,
    gap: 8,
  },
  durationChip: {
    backgroundColor: colors.accent,
    borderRadius: 10,
    padding: 6,
    maxWidth: 120,
    marginRight: 8,
    overflow: 'hidden',
  },
  durationPrimary: {
    color: 'white',
    fontSize: 10,
    fontWeight: '600',
  },
  durationSecondary: {
    color: 'white',
    fontSize: 9,
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
  },
  shareButton: {
    flex: 1,
    backgroundColor: colors.accent,
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: 'center',
  },
  shareButtonSecondary: {
    backgroundColor: colors.accentSoft,
  },
  shareButtonText: {
    color: colors.textOnAccent,
    fontWeight: '700',
    fontSize: 13,
  },
  shareButtonTextSecondary: {
    color: colors.accentPressed,
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
  mapsLink: {
    marginTop: 6,
  },
  mapsLinkText: {
    fontSize: 11,
    color: colors.accent,
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
