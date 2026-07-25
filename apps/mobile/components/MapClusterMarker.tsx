import { StyleSheet, Text, View } from 'react-native';

import { Marker } from './AppMap';
import { colors } from '../constants/theme';

type MapClusterMarkerProps = {
  geometry: { coordinates: [number, number] };
  properties: { point_count: number; cluster_id?: number };
  onPress: () => void;
  tracksViewChanges?: boolean;
};

/** Uzaq zoom: "50" kimi rəqəmli cluster balonu */
export function MapClusterMarker({
  geometry,
  properties,
  onPress,
  tracksViewChanges = false,
}: MapClusterMarkerProps) {
  const count = properties.point_count;
  const size = count >= 50 ? 52 : count >= 20 ? 46 : count >= 10 ? 42 : 38;

  return (
    <Marker
      coordinate={{
        longitude: geometry.coordinates[0],
        latitude: geometry.coordinates[1],
      }}
      onPress={onPress}
      tracksViewChanges={tracksViewChanges}
      zIndex={count + 100}
      anchor={{ x: 0.5, y: 0.5 }}
    >
      <View collapsable={false} style={[styles.wrap, { width: size + 10, height: size + 10 }]}>
        <View
          collapsable={false}
          style={[
            styles.halo,
            {
              width: size + 10,
              height: size + 10,
              borderRadius: (size + 10) / 2,
            },
          ]}
        />
        <View
          collapsable={false}
          style={[
            styles.core,
            {
              width: size,
              height: size,
              borderRadius: size / 2,
            },
          ]}
        >
          <Text style={styles.count} allowFontScaling={false}>
            {count}
          </Text>
        </View>
      </View>
    </Marker>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  halo: {
    position: 'absolute',
    backgroundColor: colors.accentSoft,
    opacity: 0.85,
  },
  core: {
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  count: {
    color: colors.textOnAccent,
    fontWeight: '800',
    fontSize: 13,
  },
});
