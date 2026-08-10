/**
 * Web map — Google Maps JS via @react-google-maps/api.
 * (react-native-maps / teovilla returns null without provider=google and
 * mapContainerStyle flex:1 collapses height.)
 */
import {
  GoogleMap,
  Marker as GMMarker,
  OverlayViewF,
  Polyline as GMPolyline,
  useJsApiLoader,
} from '@react-google-maps/api';
import {
  Children,
  forwardRef,
  isValidElement,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ForwardedRef,
  type ReactNode,
} from 'react';
import { ActivityIndicator, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import type {
  MapPressEvent,
  MapViewProps,
  MarkerDragStartEndEvent,
  PoiClickEvent,
  Region,
} from 'react-native-maps';

import type { ThemeColors } from '../constants/theme';
import { useThemeColors } from '../theme/ThemeProvider';

const GOOGLE_MAPS_KEY =
  process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY ||
  // app.json extra fallback (Constants may be unavailable in some web loads)
  '';

/** places — Place class (New); marker kept for GMMarker until Map ID + AdvancedMarker */
const MAP_LIBRARIES: ('places')[] = ['places'];

type WebMapProps = Omit<MapViewProps, 'region' | 'initialRegion'> & {
  // Web has no AnimatedRegion — keep the plain shape the helpers expect.
  region?: Region | null;
  initialRegion?: Region | null;
  googleMapsApiKey?: string;
  radius?: number;
  extent?: number;
  minPoints?: number;
  animationEnabled?: boolean;
  spiralEnabled?: boolean;
  clusteringEnabled?: boolean;
  clusterColor?: string;
  clusterTextColor?: string;
  tracksViewChanges?: boolean;
  renderCluster?: unknown;
  maxZoom?: number;
  children?: ReactNode;
  style?: ViewStyle | ViewStyle[];
};

type MapHandle = {
  animateToRegion: (region: Region, _duration?: number) => void;
  fitToCoordinates: (
    coordinates?: { latitude: number; longitude: number }[],
    _options?: unknown
  ) => void;
};

function regionToCenter(region?: Region | null) {
  if (!region) {
    return { lat: 40.5, lng: 48.0 };
  }
  return { lat: region.latitude, lng: region.longitude };
}

function regionToZoom(region?: Region | null): number {
  if (!region?.latitudeDelta) {
    return 10;
  }
  // Rough RN maps delta → Google zoom
  const zoom = Math.round(Math.log2(360 / region.latitudeDelta));
  return Math.min(18, Math.max(3, zoom));
}

function readMapRegion(map: google.maps.Map): Region | null {
  const bounds = map.getBounds();
  const center = map.getCenter();
  if (!bounds || !center) {
    return null;
  }
  const ne = bounds.getNorthEast();
  const sw = bounds.getSouthWest();
  return {
    latitude: center.lat(),
    longitude: center.lng(),
    latitudeDelta: Math.abs(ne.lat() - sw.lat()) || 0.05,
    longitudeDelta: Math.abs(ne.lng() - sw.lng()) || 0.05,
  };
}

const MapView = forwardRef(function AppMapWeb(
  props: WebMapProps,
  ref: ForwardedRef<MapHandle>
) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const {
    googleMapsApiKey,
    initialRegion,
    region,
    onRegionChangeComplete,
    onPress,
    onPoiClick,
    onMapReady,
    children,
    style,
    // strip native / clustering props
    radius: _r,
    extent: _e,
    minPoints: _m,
    animationEnabled: _a,
    spiralEnabled: _s,
    clusteringEnabled: _c,
    clusterColor: _cc,
    clusterTextColor: _ct,
    tracksViewChanges: _t,
    renderCluster: _rc,
    maxZoom: _mz,
    provider: _provider,
    showsUserLocation: _sul,
    showsMyLocationButton: _smb,
    ..._rest
  } = props;

  const apiKey = (googleMapsApiKey || GOOGLE_MAPS_KEY || '').trim();
  const { isLoaded, loadError } = useJsApiLoader({
    id: 'trippoint-google-maps',
    googleMapsApiKey: apiKey,
    libraries: MAP_LIBRARIES,
  });

  const mapRef = useRef<google.maps.Map | null>(null);
  const [mapInstance, setMapInstance] = useState<google.maps.Map | null>(null);

  const center = useMemo(
    () => regionToCenter(region ?? initialRegion ?? null),
    // only seed once from initial; controlled region updates via effect
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  const zoom = useMemo(
    () => regionToZoom(region ?? initialRegion ?? null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  useEffect(() => {
    if (!mapInstance || !region) {
      return;
    }
    mapInstance.panTo({ lat: region.latitude, lng: region.longitude });
    mapInstance.setZoom(regionToZoom(region));
  }, [mapInstance, region?.latitude, region?.longitude, region?.latitudeDelta]);

  useImperativeHandle(
    ref,
    () => ({
      animateToRegion(next: Region) {
        const map = mapRef.current;
        if (!map) {
          return;
        }
        const bounds = new google.maps.LatLngBounds(
          {
            lat: next.latitude - next.latitudeDelta / 2,
            lng: next.longitude - next.longitudeDelta / 2,
          },
          {
            lat: next.latitude + next.latitudeDelta / 2,
            lng: next.longitude + next.longitudeDelta / 2,
          }
        );
        map.fitBounds(bounds);
      },
      fitToCoordinates(coordinates) {
        const map = mapRef.current;
        if (!map || !coordinates?.length) {
          return;
        }
        const bounds = new google.maps.LatLngBounds();
        for (const c of coordinates) {
          bounds.extend({ lat: c.latitude, lng: c.longitude });
        }
        map.fitBounds(bounds, 48);
      },
    }),
    []
  );

  const handleLoad = useCallback(
    (map: google.maps.Map) => {
      mapRef.current = map;
      setMapInstance(map);
      onMapReady?.();
    },
    [onMapReady]
  );

  const handleIdle = useCallback(() => {
    const map = mapRef.current;
    if (!map || !onRegionChangeComplete) {
      return;
    }
    const next = readMapRegion(map);
    if (next) {
      onRegionChangeComplete(next, { isGesture: true });
    }
  }, [onRegionChangeComplete]);

  const handleClick = useCallback(
    (e: google.maps.MapMouseEvent) => {
      const placeId = (e as google.maps.IconMouseEvent).placeId;
      const lat = e.latLng?.lat();
      const lng = e.latLng?.lng();
      if (lat == null || lng == null) {
        return;
      }

      if (placeId && onPoiClick) {
        // Prevent default Google POI info window
        e.stop?.();
        // Details (name/rating) loaded once in handleGooglePoiClick via Place API (New)
        onPoiClick({
          nativeEvent: {
            placeId,
            name: '',
            coordinate: { latitude: lat, longitude: lng },
          },
        } as PoiClickEvent);
        return;
      }

      if (onPress) {
        onPress({
          nativeEvent: {
            coordinate: { latitude: lat, longitude: lng },
            position: { x: 0, y: 0 },
            action: 'press',
          },
        } as MapPressEvent);
      }
    },
    [onPoiClick, onPress]
  );

  if (!apiKey) {
    return (
      <View style={[styles.fill, style, styles.fallback]}>
        <Text style={styles.fallbackText}>
          Web xəritə üçün EXPO_PUBLIC_GOOGLE_MAPS_KEY lazımdır
        </Text>
      </View>
    );
  }

  if (loadError) {
    return (
      <View style={[styles.fill, style, styles.fallback]}>
        <Text style={styles.fallbackText}>
          Google Maps yüklənmədi. Maps JavaScript API + billing yoxlayın.
        </Text>
      </View>
    );
  }

  if (!isLoaded) {
    return (
      <View style={[styles.fill, style, styles.fallback]}>
        <ActivityIndicator color={colors.accent} />
        <Text style={styles.fallbackMuted}>Xəritə yüklənir…</Text>
      </View>
    );
  }

  return (
    <View style={[styles.fill, style]}>
      <GoogleMap
        mapContainerStyle={{
          width: '100%',
          height: '100%',
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
        }}
        center={center}
        zoom={zoom}
        onLoad={handleLoad}
        onIdle={handleIdle}
        onClick={handleClick}
        options={{
          mapTypeControl: true,
          streetViewControl: false,
          fullscreenControl: true,
          clickableIcons: true,
          gestureHandling: 'greedy',
        }}
      >
        {children}
      </GoogleMap>
    </View>
  );
});

type WebMarkerProps = {
  coordinate: { latitude: number; longitude: number };
  title?: string;
  description?: string;
  draggable?: boolean;
  anchor?: { x: number; y: number };
  zIndex?: number;
  tracksViewChanges?: boolean;
  cluster?: boolean;
  onPress?: (e: unknown) => void;
  onDragStart?: (e: MarkerDragStartEndEvent) => void;
  onDragEnd?: (e: MarkerDragStartEndEvent) => void;
  children?: ReactNode;
};

/** Web Marker — custom children via OverlayView; draggable uses native GM pin. */
function Marker({
  coordinate,
  title,
  draggable,
  anchor = { x: 0.5, y: 0.5 },
  onPress,
  onDragStart,
  onDragEnd,
  children,
}: WebMarkerProps) {
  const hasCustom = Children.toArray(children).some((c) => isValidElement(c));
  // Drag requires default Google marker (OverlayView is not draggable)
  if (draggable || !hasCustom) {
    return (
      <GMMarker
        position={{ lat: coordinate.latitude, lng: coordinate.longitude }}
        title={title}
        draggable={Boolean(draggable)}
        onClick={() => onPress?.({ nativeEvent: { coordinate } })}
        onDragStart={(e) => {
          const lat = e.latLng?.lat() ?? coordinate.latitude;
          const lng = e.latLng?.lng() ?? coordinate.longitude;
          onDragStart?.({
            nativeEvent: { coordinate: { latitude: lat, longitude: lng } },
          } as MarkerDragStartEndEvent);
        }}
        onDragEnd={(e) => {
          const lat = e.latLng?.lat() ?? coordinate.latitude;
          const lng = e.latLng?.lng() ?? coordinate.longitude;
          onDragEnd?.({
            nativeEvent: { coordinate: { latitude: lat, longitude: lng } },
          } as MarkerDragStartEndEvent);
        }}
      />
    );
  }

  return (
    <OverlayViewF
      position={{ lat: coordinate.latitude, lng: coordinate.longitude }}
      mapPaneName="overlayMouseTarget"
      getPixelPositionOffset={(w, h) => ({
        x: -(w * anchor.x),
        y: -(h * anchor.y),
      })}
    >
      <div
        onClick={(ev) => {
          ev.stopPropagation();
          onPress?.({ nativeEvent: { coordinate } });
        }}
        style={{ cursor: 'pointer' }}
      >
        {children}
      </div>
    </OverlayViewF>
  );
}

type WebPolylineProps = {
  coordinates: { latitude: number; longitude: number }[];
  strokeColor?: string;
  strokeWidth?: number;
};

function Polyline({ coordinates, strokeColor, strokeWidth = 3 }: WebPolylineProps) {
  const colors = useThemeColors();
  const resolvedStroke = strokeColor ?? colors.accent;
  const path = coordinates.map((c) => ({ lat: c.latitude, lng: c.longitude }));
  return (
    <GMPolyline
      path={path}
      options={{
        strokeColor: resolvedStroke,
        strokeWeight: strokeWidth,
        strokeOpacity: 0.9,
      }}
    />
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
  fill: {
    flex: 1,
    width: '100%',
    height: '100%',
    minHeight: 200,
    position: 'relative',
  },
  mapContainer: {
    width: '100%',
    height: '100%',
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  fallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.chip,
    gap: 8,
    padding: 16,
  },
  fallbackText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  fallbackMuted: {
    color: colors.textMuted,
    fontSize: 12,
  },
});
}

export default MapView;
export { Marker, Polyline };
export const PROVIDER_GOOGLE = 'google' as const;

export type {
  Region,
  MapPressEvent,
  PoiClickEvent,
  MarkerDragStartEndEvent,
};
