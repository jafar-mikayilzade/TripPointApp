import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors } from '../constants/theme';
import { nextSelectableHour } from '../lib/listingSchedule';
import {
  addDays,
  combineDateAndHour,
  startOfDay,
  syncReturnForTrip,
} from '../lib/tripSchedule';
import { type WeatherAdvice } from '../lib/weather';
import { SimpleDateTimeField } from './SimpleDateTimeField';

/** Match DropdownButton compact trigger — stable row height. */
const SCHEDULE_FIELD_HEIGHT = 40;
const WEATHER_CHIP_WIDTH = 56;

type Props = {
  fromOrigin: boolean;
  startAt: Date;
  returnAt: Date;
  onStartAtChange: (value: Date) => void;
  onReturnAtChange: (value: Date) => void;
  tripDays?: number;
  allowOvernight?: boolean;
  weather?: WeatherAdvice | null;
  showWeather?: boolean;
  showStartDay?: boolean;
  showTimes?: boolean;
};

function weatherIconName(weather: WeatherAdvice | null | undefined) {
  if (weather?.prefer_indoor) {
    return 'rainy-outline' as const;
  }
  const text = `${weather?.condition_az ?? ''} ${weather?.display_az ?? ''}`.toLowerCase();
  if (text.includes('bulud') || text.includes('örtülü')) {
    return 'cloudy-outline' as const;
  }
  if (text.includes('günəş') || text.includes('açıq')) {
    return 'sunny-outline' as const;
  }
  return 'partly-sunny-outline' as const;
}

export function TripScheduleFields({
  fromOrigin,
  startAt,
  returnAt,
  onStartAtChange,
  onReturnAtChange,
  tripDays = 1,
  allowOvernight = false,
  weather,
  showWeather = true,
  showStartDay = true,
  showTimes = true,
}: Props) {
  const minDate = useMemo(() => nextSelectableHour(), []);
  const days = Math.max(1, tripDays);
  const sameDayReturn = days <= 1 && !allowOvernight;

  const temp =
    weather?.daily_forecast?.[0]?.temp_c ?? weather?.temp_c ?? null;
  const hasTemp = typeof temp === 'number';

  function applyStart(nextStart: Date) {
    onStartAtChange(nextStart);
    onReturnAtChange(syncReturnForTrip(nextStart, returnAt, days, allowOvernight));
  }

  function handleDayChange(next: Date) {
    applyStart(
      combineDateAndHour(next, startAt.getHours() || 8, startAt.getMinutes())
    );
  }

  function handleDepartTimeChange(next: Date) {
    applyStart(combineDateAndHour(startAt, next.getHours(), next.getMinutes()));
  }

  function handleReturnTimeChange(next: Date) {
    onReturnAtChange(
      syncReturnForTrip(
        startAt,
        combineDateAndHour(startAt, next.getHours(), next.getMinutes()),
        days,
        allowOvernight
      )
    );
  }

  const returnMinimumDate = sameDayReturn
    ? new Date(startAt.getTime() + 60 * 60 * 1000)
    : days > 1
      ? startOfDay(addDays(startAt, days - 1))
      : undefined;

  const timesVisible = showTimes && fromOrigin;
  const dayVisible = showStartDay;
  if (!timesVisible && !dayVisible) {
    return null;
  }

  return (
    <View style={styles.root}>
      {dayVisible ? (
        <View style={styles.dayRow}>
          <SimpleDateTimeField
            label="Başlanğıc"
            value={startAt}
            mode="date"
            compact
            minimumDate={minDate}
            onChange={handleDayChange}
            style={styles.dayField}
          />
          <View
            style={[
              styles.weatherChip,
              (!showWeather || !hasTemp) && styles.weatherChipEmpty,
            ]}
            accessibilityLabel={
              showWeather && hasTemp ? `Hava ${Math.round(temp)}°` : undefined
            }
          >
            {showWeather && hasTemp ? (
              <>
                <Ionicons
                  name={weatherIconName(weather)}
                  size={14}
                  color={colors.accent}
                />
                <Text style={styles.weatherTemp}>{Math.round(temp)}°</Text>
              </>
            ) : (
              <Text style={styles.weatherPlaceholder}>—</Text>
            )}
          </View>
        </View>
      ) : null}

      {timesVisible ? (
        <View style={styles.timeRow}>
          <SimpleDateTimeField
            label="Çıxış"
            value={startAt}
            mode="time"
            compact
            onChange={handleDepartTimeChange}
            style={styles.timeField}
          />
          <SimpleDateTimeField
            label="Qayıdış"
            value={returnAt}
            mode="time"
            compact
            anyHour={days > 1 || (allowOvernight && days <= 1)}
            minimumDate={returnMinimumDate}
            onChange={handleReturnTimeChange}
            style={styles.timeField}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: 6,
    marginTop: 6,
    marginBottom: 2,
  },
  dayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dayField: {
    flex: 1,
    minWidth: 0,
    height: SCHEDULE_FIELD_HEIGHT,
    justifyContent: 'center',
  },
  weatherChip: {
    width: WEATHER_CHIP_WIDTH,
    height: SCHEDULE_FIELD_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSoft,
  },
  weatherChipEmpty: {
    backgroundColor: colors.surfaceMuted,
  },
  weatherTemp: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.2,
  },
  weatherPlaceholder: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
  },
  timeRow: {
    flexDirection: 'row',
    gap: 6,
    height: SCHEDULE_FIELD_HEIGHT,
  },
  timeField: {
    flex: 1,
    height: SCHEDULE_FIELD_HEIGHT,
    justifyContent: 'center',
  },
});
