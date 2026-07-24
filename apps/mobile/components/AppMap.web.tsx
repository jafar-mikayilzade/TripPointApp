/**
 * Web map — react-native-maps is native-only (codegenNativeComponent crash on web).
 * Uses Google Maps JS via @teovilla/react-native-web-maps.
 */
import { forwardRef, type ForwardedRef } from 'react';
import MapViewWeb, {
  Marker,
  Polyline,
} from '@teovilla/react-native-web-maps';
import type { MapViewProps } from 'react-native-maps';

const GOOGLE_MAPS_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY ?? '';

type WebMapProps = MapViewProps & {
  googleMapsApiKey?: string;
  radius?: number;
  extent?: number;
  minPoints?: number;
  animationEnabled?: boolean;
  spiralEnabled?: boolean;
};

const MapView = forwardRef(function AppMapWeb(
  props: WebMapProps,
  ref: ForwardedRef<unknown>
) {
  const {
    googleMapsApiKey,
    // clustering props from ClusteredAppMap — ignore on web
    radius: _radius,
    extent: _extent,
    minPoints: _minPoints,
    animationEnabled: _animationEnabled,
    spiralEnabled: _spiralEnabled,
    provider: _provider,
    ...rest
  } = props;

  return (
    <MapViewWeb
      {...(rest as MapViewProps)}
      ref={ref as never}
      googleMapsApiKey={googleMapsApiKey ?? GOOGLE_MAPS_KEY}
    />
  );
});

export default MapView;
export { Marker, Polyline };
/** Provider constant kept for shared call sites; web ignores provider prop. */
export const PROVIDER_GOOGLE = 'google' as const;

export type {
  Region,
  MapPressEvent,
  PoiClickEvent,
  MarkerDragStartEndEvent,
} from 'react-native-maps';
