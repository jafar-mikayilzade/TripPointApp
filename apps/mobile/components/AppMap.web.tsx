import Constants from 'expo-constants';
import {
  Children,
  createContext,
  createElement,
  forwardRef,
  isValidElement,
  useContext,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { StyleSheet, Text, View, type ViewProps, type ViewStyle } from 'react-native';

/* Google Maps JS API — runtime types (no @types/google.maps dependency) */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GMaps = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GMap = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GMarker = any;

type LatLng = { latitude: number; longitude: number };

type Region = LatLng & {
  latitudeDelta: number;
  longitudeDelta: number;
};

type MapPressEvent = {
  nativeEvent: {
    coordinate: LatLng;
  };
};

type PoiClickEvent = {
  nativeEvent: {
    placeId: string;
    name: string;
    coordinate: LatLng;
  };
};

type MarkerDragStartEndEvent = {
  nativeEvent: {
    coordinate: LatLng;
  };
};

type MapViewProps = ViewProps & {
  initialRegion?: Region;
  region?: Region;
  provider?: string | null;
  showsUserLocation?: boolean;
  showsMyLocationButton?: boolean;
  onPress?: (event: MapPressEvent) => void;
  onPoiClick?: (event: PoiClickEvent) => void;
  children?: ReactNode;
};

type MarkerProps = {
  coordinate: LatLng;
  title?: string;
  description?: string;
  pinColor?: string;
  draggable?: boolean;
  tracksViewChanges?: boolean;
  onPress?: () => void;
  onDragStart?: (event: MarkerDragStartEndEvent) => void;
  onDragEnd?: (event: MarkerDragStartEndEvent) => void;
  children?: ReactNode;
};

type PolylineProps = {
  coordinates: LatLng[];
  strokeColor?: string;
  strokeWidth?: number;
  lineDashPattern?: number[];
};

export type { Region, MapPressEvent, PoiClickEvent, MarkerDragStartEndEvent };

export type AppMapRef = {
  animateToRegion: (region: Region, duration?: number) => void;
  fitToCoordinates: (
    coordinates: LatLng[],
    options?: {
      edgePadding?: { top: number; right: number; bottom: number; left: number };
      animated?: boolean;
    }
  ) => void;
};

export const PROVIDER_GOOGLE = 'google';

type GoogleMapsWindow = Window & {
  google?: GMaps;
  __trippointMapsPromise?: Promise<GMaps>;
};

function getApiKey(): string {
  return (
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY ||
    (Constants.expoConfig?.extra?.googleMapsKey as string | undefined) ||
    ''
  );
}

function loadGoogleMaps(apiKey: string): Promise<GMaps> {
  const w = window as GoogleMapsWindow;
  if (w.google?.maps) {
    return Promise.resolve(w.google);
  }
  if (w.__trippointMapsPromise) {
    return w.__trippointMapsPromise;
  }

  w.__trippointMapsPromise = new Promise((resolve, reject) => {
    const existing = document.getElementById('trippoint-google-maps');
    if (existing) {
      existing.addEventListener('load', () => {
        if (w.google) {
          resolve(w.google);
        } else {
          reject(new Error('Google Maps yüklənmədi'));
        }
      });
      return;
    }

    const script = document.createElement('script');
    script.id = 'trippoint-google-maps';
    script.async = true;
    script.defer = true;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly&loading=async`;
    script.onload = () => {
      if (w.google) {
        resolve(w.google);
      } else {
        reject(new Error('Google Maps yüklənmədi'));
      }
    };
    script.onerror = () => reject(new Error('Google Maps script xətası'));
    document.head.appendChild(script);
  });

  return w.__trippointMapsPromise;
}

function regionToZoom(region: Region): number {
  const delta = Math.max(region.latitudeDelta, region.longitudeDelta);
  if (delta <= 0) {
    return 12;
  }
  return Math.min(18, Math.max(5, Math.round(Math.log2(360 / delta))));
}

type MapContextValue = {
  map: GMap | null;
  googleApi: GMaps | null;
};

const MapContext = createContext<MapContextValue>({ map: null, googleApi: null });

export function Marker({
  coordinate,
  title,
  pinColor,
  draggable,
  onPress,
  onDragStart,
  onDragEnd,
}: MarkerProps) {
  const { map, googleApi } = useContext(MapContext);
  const markerRef = useRef<GMarker | null>(null);

  useEffect(() => {
    if (!map || !googleApi) {
      return;
    }

    const marker = new googleApi.maps.Marker({
      map,
      position: { lat: coordinate.latitude, lng: coordinate.longitude },
      title,
      draggable: Boolean(draggable),
      icon: pinColor
        ? {
            path: googleApi.maps.SymbolPath.CIRCLE,
            scale: 10,
            fillColor: pinColor,
            fillOpacity: 1,
            strokeColor: '#fff',
            strokeWeight: 2,
          }
        : undefined,
    });
    markerRef.current = marker;

    const clickListener = marker.addListener('click', () => onPress?.());
    const dragStartListener = marker.addListener('dragstart', () => {
      const pos = marker.getPosition();
      if (!pos) {
        return;
      }
      onDragStart?.({
        nativeEvent: {
          coordinate: { latitude: pos.lat(), longitude: pos.lng() },
        },
      });
    });
    const dragEndListener = marker.addListener('dragend', () => {
      const pos = marker.getPosition();
      if (!pos) {
        return;
      }
      onDragEnd?.({
        nativeEvent: {
          coordinate: { latitude: pos.lat(), longitude: pos.lng() },
        },
      });
    });

    return () => {
      googleApi.maps.event.removeListener(clickListener);
      googleApi.maps.event.removeListener(dragStartListener);
      googleApi.maps.event.removeListener(dragEndListener);
      marker.setMap(null);
      markerRef.current = null;
    };
    // coordinate changes remount via parent key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, googleApi]);

  useEffect(() => {
    markerRef.current?.setPosition({
      lat: coordinate.latitude,
      lng: coordinate.longitude,
    });
  }, [coordinate.latitude, coordinate.longitude]);

  useEffect(() => {
    markerRef.current?.setDraggable(Boolean(draggable));
  }, [draggable]);

  return null;
}

export function Polyline({ coordinates, strokeColor, strokeWidth }: PolylineProps) {
  const { map, googleApi } = useContext(MapContext);

  useEffect(() => {
    if (!map || !googleApi || coordinates.length < 2) {
      return;
    }

    const line = new googleApi.maps.Polyline({
      map,
      path: coordinates.map((c) => ({ lat: c.latitude, lng: c.longitude })),
      strokeColor: strokeColor ?? '#2563EB',
      strokeWeight: strokeWidth ?? 3,
    });

    return () => {
      line.setMap(null);
    };
  }, [map, googleApi, coordinates, strokeColor, strokeWidth]);

  return null;
}

const MapView = forwardRef<AppMapRef, MapViewProps>(function MapView(
  { style, children, initialRegion, region, onPress, onPoiClick },
  ref
) {
  const apiKey = useMemo(() => getApiKey(), []);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<GMap | null>(null);
  const [googleApi, setGoogleApi] = useState<GMaps | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const startRegion = region ?? initialRegion;

  useEffect(() => {
    if (!apiKey) {
      setErrorMessage('EXPO_PUBLIC_GOOGLE_MAPS_KEY təyin olunmayıb');
      return;
    }

    const w = window as GoogleMapsWindow & {
      gm_authFailure?: () => void;
    };
    w.gm_authFailure = () => {
      setErrorMessage(
        'Google Maps açarı etibarsızdır və ya Cloud layihəsində Billing aktiv deyil. Google Cloud Console → Billing + Maps JavaScript API.'
      );
    };

    let cancelled = false;
    loadGoogleMaps(apiKey)
      .then((g) => {
        if (!cancelled) {
          setGoogleApi(g);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setErrorMessage(err instanceof Error ? err.message : 'Xəritə yüklənmədi');
        }
      });

    return () => {
      cancelled = true;
      if (w.gm_authFailure) {
        delete w.gm_authFailure;
      }
    };
  }, [apiKey]);

  useEffect(() => {
    if (!googleApi || !containerRef.current || mapInstanceRef.current) {
      return;
    }

    const center = startRegion
      ? { lat: startRegion.latitude, lng: startRegion.longitude }
      : { lat: 40.4093, lng: 49.8671 };

    const map = new googleApi.maps.Map(containerRef.current, {
      center,
      zoom: startRegion ? regionToZoom(startRegion) : 8,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: true,
      clickableIcons: true,
    });
    mapInstanceRef.current = map;
    setMapReady(true);

    // flex layout-da konteyner ölçüsü gec gələ bilər — resize trigger
    requestAnimationFrame(() => {
      googleApi.maps.event.trigger(map, 'resize');
      if (startRegion) {
        map.setCenter({ lat: startRegion.latitude, lng: startRegion.longitude });
      }
    });

    return () => {
      mapInstanceRef.current = null;
      setMapReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [googleApi]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !googleApi) {
      return;
    }

    const clickListener = map.addListener(
      'click',
      (event: {
        placeId?: string;
        latLng?: { lat: () => number; lng: () => number };
        stop?: () => void;
      }) => {
        // Google-un default "Something went wrong" kartını bağla — Places API/billing lazım deyil
        if (event.placeId) {
          try {
            event.stop?.();
          } catch {
            // ignore
          }
          const latLng = event.latLng;
          if (!latLng || !onPoiClick) {
            return;
          }
          onPoiClick({
            nativeEvent: {
              placeId: event.placeId,
              name: '',
              coordinate: {
                latitude: latLng.lat(),
                longitude: latLng.lng(),
              },
            },
          });
          return;
        }

        if (!onPress || !event.latLng) {
          return;
        }
        onPress({
          nativeEvent: {
            coordinate: {
              latitude: event.latLng.lat(),
              longitude: event.latLng.lng(),
            },
          },
        });
      }
    );

    return () => {
      googleApi.maps.event.removeListener(clickListener);
    };
  }, [googleApi, mapReady, onPress, onPoiClick]);

  useEffect(() => {
    if (!mapInstanceRef.current || !region) {
      return;
    }
    mapInstanceRef.current.panTo({ lat: region.latitude, lng: region.longitude });
    mapInstanceRef.current.setZoom(regionToZoom(region));
  }, [region]);

  useImperativeHandle(ref, () => ({
    animateToRegion: (next, _duration) => {
      const map = mapInstanceRef.current;
      if (!map) {
        return;
      }
      map.panTo({ lat: next.latitude, lng: next.longitude });
      map.setZoom(regionToZoom(next));
    },
    fitToCoordinates: (coordinates, options) => {
      const map = mapInstanceRef.current;
      const g = googleApi;
      if (!map || !g || coordinates.length === 0) {
        return;
      }
      const bounds = new g.maps.LatLngBounds();
      coordinates.forEach((c) => bounds.extend({ lat: c.latitude, lng: c.longitude }));
      map.fitBounds(bounds, options?.edgePadding);
    },
  }));

  const flattenedStyle = StyleSheet.flatten(style) as ViewStyle | undefined;
  const height = typeof flattenedStyle?.height === 'number' ? flattenedStyle.height : undefined;

  const markerChildren = Children.toArray(children).filter((child) => isValidElement(child));

  if (errorMessage) {
    return (
      <View style={[styles.map, style, styles.centered]}>
        <Text style={styles.errorText}>{errorMessage}</Text>
      </View>
    );
  }

  return (
    <View style={[styles.map, style]}>
      {createElement('div', {
        ref: containerRef,
        style: {
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          width: '100%',
          height: height ? `${height}px` : '100%',
          minHeight: 320,
        },
      })}
      <MapContext.Provider
        value={{ map: mapReady ? mapInstanceRef.current : null, googleApi }}
      >
        {markerChildren}
      </MapContext.Provider>
    </View>
  );
});

export default MapView;

const styles = StyleSheet.create({
  map: {
    flex: 1,
    backgroundColor: '#E5E7EB',
    overflow: 'hidden',
    position: 'relative',
    minHeight: 320,
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  errorText: {
    color: '#B91C1C',
    fontWeight: '600',
    textAlign: 'center',
  },
});
