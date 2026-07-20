/**
 * Clustered map for dense POI sets.
 * Uses react-native-map-clustering on native; plain MapView on web.
 */
import type { ComponentType } from 'react';
import { Platform } from 'react-native';
import MapView, {
  Marker,
  Polyline,
  PROVIDER_GOOGLE,
  type MapViewProps,
} from 'react-native-maps';

export { Marker, Polyline, PROVIDER_GOOGLE };
export type {
  Region,
  MapPressEvent,
  PoiClickEvent,
  MarkerDragStartEndEvent,
} from 'react-native-maps';

type ClusteredProps = MapViewProps & {
  radius?: number;
  extent?: number;
  minPoints?: number;
  animationEnabled?: boolean;
  spiralEnabled?: boolean;
};

let ClusteredMapView: ComponentType<ClusteredProps> = MapView as ComponentType<ClusteredProps>;

if (Platform.OS !== 'web') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ClusteredMapView = require('react-native-map-clustering').default;
  } catch {
    ClusteredMapView = MapView as ComponentType<ClusteredProps>;
  }
}

export default ClusteredMapView;
