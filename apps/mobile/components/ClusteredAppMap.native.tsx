/**
 * Clustered map for dense POI sets (native).
 * Uzaq: rəqəmli cluster · yaxın: tək-tək custom marker (ikon).
 */
import type { ComponentType, ReactElement, Ref } from 'react';
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
  /** react-native-map-clustering forwards the ref to the inner MapView. */
  ref?: Ref<MapView>;
  radius?: number;
  extent?: number;
  minPoints?: number;
  minZoom?: number;
  maxZoom?: number;
  animationEnabled?: boolean;
  spiralEnabled?: boolean;
  clusteringEnabled?: boolean;
  clusterColor?: string;
  clusterTextColor?: string;
  tracksViewChanges?: boolean;
  renderCluster?: (cluster: {
    geometry: { coordinates: [number, number] };
    properties: { point_count: number; cluster_id?: number };
    onPress: () => void;
    tracksViewChanges?: boolean;
  }) => ReactElement | null;
};

let ClusteredMapView: ComponentType<ClusteredProps> = MapView as ComponentType<ClusteredProps>;

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  ClusteredMapView = require('react-native-map-clustering').default;
} catch {
  ClusteredMapView = MapView as ComponentType<ClusteredProps>;
}

export default ClusteredMapView;
