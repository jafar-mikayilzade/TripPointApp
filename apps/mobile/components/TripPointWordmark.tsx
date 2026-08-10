import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { useThemeColors } from '../theme/ThemeProvider';

type Props = {
  /** Font size for Trip / Point letters */
  size?: number;
  /** Subtle mountain + wave line art beside the mark (login-style) */
  showDecor?: boolean;
  /** Force white Trip + gold Point (splash on dark green) */
  onDarkSplash?: boolean;
  style?: StyleProp<ViewStyle>;
};

/**
 * Brand wordmark: "Trip" (navy) + "P" + pin-as-o + "int" (teal).
 * Matches the official TripPoint lockup.
 */
export function TripPointWordmark({
  size = 28,
  showDecor = false,
  onDarkSplash = false,
  style,
}: Props) {
  const colors = useThemeColors();
  const tripColor = onDarkSplash ? '#FFFFFF' : colors.wordmarkTrip;
  const pointColor = onDarkSplash ? colors.favorite : colors.brand;
  const decorColor = onDarkSplash ? 'rgba(212,175,55,0.35)' : colors.border;
  const pinSize = Math.round(size * 0.85);
  const pinGap = Math.max(1, Math.round(size * 0.02));

  return (
    <View style={[styles.row, style]}>
      {showDecor ? (
        <View style={styles.decorLeft} accessibilityElementsHidden>
          <View style={[styles.peak, { borderBottomColor: decorColor, borderBottomWidth: size * 0.35 }]} />
          <View
            style={[
              styles.peak,
              styles.peakSmall,
              { borderBottomColor: decorColor, borderBottomWidth: size * 0.28 },
            ]}
          />
        </View>
      ) : null}

      <Text style={[styles.trip, { fontSize: size, color: tripColor, lineHeight: size * 1.2 }]}>
        Trip
      </Text>
      <Text style={[styles.point, { fontSize: size, color: pointColor, lineHeight: size * 1.2 }]}>
        P
      </Text>
      <Ionicons
        name="location"
        size={pinSize}
        color={pointColor}
        style={{ marginHorizontal: pinGap, marginTop: -Math.round(size * 0.06) }}
      />
      <Text style={[styles.point, { fontSize: size, color: pointColor, lineHeight: size * 1.2 }]}>
        int
      </Text>

      {showDecor ? (
        <View style={styles.decorRight} accessibilityElementsHidden>
          <View style={[styles.wave, { borderColor: decorColor }]} />
          <View style={[styles.wave, { borderColor: decorColor, width: 18 }]} />
          <View style={[styles.wave, { borderColor: decorColor, width: 12 }]} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  trip: {
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  point: {
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  decorLeft: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginRight: 10,
    gap: 2,
    opacity: 0.7,
  },
  peak: {
    width: 0,
    height: 0,
    borderLeftWidth: 8,
    borderRightWidth: 8,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  peakSmall: {
    borderLeftWidth: 6,
    borderRightWidth: 6,
    marginBottom: 2,
  },
  decorRight: {
    marginLeft: 10,
    gap: 3,
    opacity: 0.7,
    justifyContent: 'center',
  },
  wave: {
    width: 22,
    height: 5,
    borderTopWidth: 1.5,
    borderRadius: 8,
  },
});
