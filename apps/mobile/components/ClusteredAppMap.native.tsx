/**
 * Clustered map for dense POI sets (native).
 * Uses react-native-map-clustering when available.
 */
import type { ComponentType } from 'react';
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

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  ClusteredMapView = require('react-native-map-clustering').default;
} catch {
  ClusteredMapView = MapView as ComponentType<ClusteredProps>;
}

export default ClusteredMapView;
