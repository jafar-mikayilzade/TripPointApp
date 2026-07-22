import { useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, space } from '../constants/theme';
import { nextSelectableHour } from '../lib/listingSchedule';

interface SimpleDateTimeFieldProps {
  value: Date;
  onChange: (next: Date) => void;
  mode?: 'datetime' | 'date';
  minimumDate?: Date;
  maximumDate?: Date;
  hasError?: boolean;
}

const MONTH_NAMES = [
  'Yanvar',
  'Fevral',
  'Mart',
  'Aprel',
  'May',
  'İyun',
  'İyul',
  'Avqust',
  'Sentyabr',
  'Oktyabr',
  'Noyabr',
  'Dekabr',
];

const WEEKDAYS = ['B.e', 'Ç.a', 'Ç', 'C.a', 'C', 'Ş', 'B'];

function startOfDay(date: Date): Date {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function sameDay(a: Date, b: Date): boolean {
  return startOfDay(a).getTime() === startOfDay(b).getTime();
}

function resolveFloor(minimumDate?: Date): Date {
  const soonest = nextSelectableHour();
  if (!minimumDate) {
    return soonest;
  }
  return minimumDate.getTime() > soonest.getTime() ? new Date(minimumDate) : soonest;
}

function formatTrigger(date: Date, mode: 'datetime' | 'date'): string {
  const d = date.toLocaleDateString('az-AZ', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  if (mode === 'date') {
    return d;
  }
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  return `${d} · ${h}:${m}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

/** Bazar ertəsi = 0 … Bazar = 6 */
function mondayFirstIndex(jsDay: number): number {
  return (jsDay + 6) % 7;
}

type Step = 'date' | 'time';

export function SimpleDateTimeField({
  value,
  onChange,
  mode = 'datetime',
  minimumDate,
  maximumDate,
  hasError = false,
}: SimpleDateTimeFieldProps) {
  const insets = useSafeAreaInsets();
  const bottomSafe = Math.max(insets.bottom, 12);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>('date');
  const [floor, setFloor] = useState(() => resolveFloor(minimumDate));
  const [cursorMonth, setCursorMonth] = useState(() => startOfDay(value));
  const [selectedDay, setSelectedDay] = useState(() => startOfDay(value));

  const maxDate = useMemo(() => {
    if (maximumDate) {
      return startOfDay(maximumDate);
    }
    const next = startOfDay(floor);
    next.setDate(next.getDate() + 59);
    return next;
  }, [maximumDate, floor]);

  const calendarCells = useMemo(() => {
    const year = cursorMonth.getFullYear();
    const month = cursorMonth.getMonth();
    const first = new Date(year, month, 1);
    const total = daysInMonth(year, month);
    const offset = mondayFirstIndex(first.getDay());
    const cells: Array<{ key: string; day: number | null; date: Date | null }> = [];

    for (let i = 0; i < offset; i += 1) {
      cells.push({ key: `e-${i}`, day: null, date: null });
    }
    for (let day = 1; day <= total; day += 1) {
      const date = new Date(year, month, day);
      cells.push({ key: `d-${day}`, day, date });
    }
    while (cells.length % 7 !== 0) {
      cells.push({ key: `t-${cells.length}`, day: null, date: null });
    }
    return cells;
  }, [cursorMonth]);

  const availableHours = useMemo(() => {
    const hours: number[] = [];
    for (let hour = 0; hour < 24; hour += 1) {
      const probe = new Date(selectedDay);
      probe.setHours(hour, 0, 0, 0);
      if (probe.getTime() >= floor.getTime() && startOfDay(probe).getTime() <= maxDate.getTime()) {
        hours.push(hour);
      }
    }
    return hours;
  }, [selectedDay, floor, maxDate]);

  function openPicker() {
    const nextFloor = resolveFloor(minimumDate);
    setFloor(nextFloor);
    const safeDay = startOfDay(
      value.getTime() >= nextFloor.getTime() ? value : nextFloor
    );
    setSelectedDay(safeDay);
    setCursorMonth(new Date(safeDay.getFullYear(), safeDay.getMonth(), 1));
    setStep('date');
    setOpen(true);
  }

  function canGoPrevMonth(): boolean {
    const prev = new Date(cursorMonth.getFullYear(), cursorMonth.getMonth() - 1, 1);
    return prev.getTime() >= new Date(floor.getFullYear(), floor.getMonth(), 1).getTime();
  }

  function canGoNextMonth(): boolean {
    const next = new Date(cursorMonth.getFullYear(), cursorMonth.getMonth() + 1, 1);
    return next.getTime() <= new Date(maxDate.getFullYear(), maxDate.getMonth(), 1).getTime();
  }

  function isDayDisabled(date: Date): boolean {
    const day = startOfDay(date).getTime();
    return day < startOfDay(floor).getTime() || day > maxDate.getTime();
  }

  function onSelectDay(date: Date) {
    if (isDayDisabled(date)) {
      return;
    }
    setSelectedDay(startOfDay(date));
    if (mode === 'date') {
      onChange(startOfDay(date));
      setOpen(false);
      return;
    }
    setStep('time');
  }

  function onSelectHour(hour: number) {
    const next = new Date(selectedDay);
    next.setHours(hour, 0, 0, 0);
    if (next.getTime() < floor.getTime()) {
      return;
    }
    onChange(next);
    setOpen(false);
  }

  return (
    <>
      <Pressable
        style={[styles.trigger, hasError && styles.triggerError]}
        onPress={openPicker}
      >
        <Text style={[styles.triggerText, hasError && styles.triggerTextError]}>
          {hasError ? 'Boş ola bilməz' : formatTrigger(value, mode)}
        </Text>
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.overlay} onPress={() => setOpen(false)}>
          <Pressable
            style={[styles.sheet, { paddingBottom: bottomSafe + 12 }]}
            onPress={(e) => e.stopPropagation()}
          >
            {step === 'date' ? (
              <>
                <Text style={styles.title}>Tarix</Text>

                <View style={styles.monthBar}>
                  <Pressable
                    style={[styles.monthNav, !canGoPrevMonth() && styles.monthNavDisabled]}
                    disabled={!canGoPrevMonth()}
                    onPress={() =>
                      setCursorMonth(
                        new Date(cursorMonth.getFullYear(), cursorMonth.getMonth() - 1, 1)
                      )
                    }
                    hitSlop={8}
                  >
                    <Text style={styles.monthNavText}>‹</Text>
                  </Pressable>
                  <Text style={styles.monthLabel}>
                    {MONTH_NAMES[cursorMonth.getMonth()]} {cursorMonth.getFullYear()}
                  </Text>
                  <Pressable
                    style={[styles.monthNav, !canGoNextMonth() && styles.monthNavDisabled]}
                    disabled={!canGoNextMonth()}
                    onPress={() =>
                      setCursorMonth(
                        new Date(cursorMonth.getFullYear(), cursorMonth.getMonth() + 1, 1)
                      )
                    }
                    hitSlop={8}
                  >
                    <Text style={styles.monthNavText}>›</Text>
                  </Pressable>
                </View>

                <View style={styles.weekRow}>
                  {WEEKDAYS.map((label) => (
                    <Text key={label} style={styles.weekday}>
                      {label}
                    </Text>
                  ))}
                </View>

                <View style={styles.grid}>
                  {calendarCells.map((cell) => {
                    if (!cell.date || cell.day == null) {
                      return <View key={cell.key} style={styles.dayCell} />;
                    }
                    const disabled = isDayDisabled(cell.date);
                    const selected = sameDay(cell.date, selectedDay);
                    return (
                      <Pressable
                        key={cell.key}
                        style={styles.dayCell}
                        disabled={disabled}
                        onPress={() => onSelectDay(cell.date!)}
                      >
                        <View
                          style={[
                            styles.dayInner,
                            selected && styles.dayInnerSelected,
                            disabled && styles.dayInnerDisabled,
                          ]}
                        >
                          <Text
                            style={[
                              styles.dayText,
                              selected && styles.dayTextSelected,
                              disabled && styles.dayTextDisabled,
                            ]}
                          >
                            {cell.day}
                          </Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>

                <Text style={styles.hint}>Günü seçin, sonra saat</Text>
              </>
            ) : (
              <>
                <View style={styles.timeHeader}>
                  <Pressable onPress={() => setStep('date')} hitSlop={10}>
                    <Text style={styles.backLink}>‹ Tarix</Text>
                  </Pressable>
                  <Text style={styles.title}>Saat</Text>
                  <View style={styles.backSpacer} />
                </View>

                <Text style={styles.selectedDateLabel}>
                  {selectedDay.toLocaleDateString('az-AZ', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}
                </Text>

                {availableHours.length === 0 ? (
                  <Text style={styles.emptyHours}>Bu gün üçün uyğun saat yoxdur</Text>
                ) : (
                  <View style={styles.hourGrid}>
                    {availableHours.map((hour) => (
                      <Pressable
                        key={hour}
                        style={styles.hourChip}
                        onPress={() => onSelectHour(hour)}
                      >
                        <Text style={styles.hourText}>
                          {String(hour).padStart(2, '0')}:00
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                )}
              </>
            )}

            <Pressable style={styles.cancelBtn} onPress={() => setOpen(false)}>
              <Text style={styles.cancelText}>Bağla</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSoft,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: colors.surface,
  },
  triggerError: {
    borderColor: colors.danger,
  },
  triggerText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  triggerTextError: {
    color: colors.danger,
  },
  overlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 12,
    paddingTop: 12,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
    letterSpacing: -0.2,
  },
  monthBar: {
    marginTop: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  monthNav: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSoft,
  },
  monthNavDisabled: {
    opacity: 0.35,
  },
  monthNavText: {
    fontSize: 20,
    color: colors.text,
    fontWeight: '500',
    lineHeight: 24,
  },
  monthLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  weekRow: {
    marginTop: space.sm,
    flexDirection: 'row',
  },
  weekday: {
    flex: 1,
    textAlign: 'center',
    fontSize: 11,
    fontWeight: '600',
    color: colors.textMuted,
  },
  grid: {
    marginTop: 6,
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  dayCell: {
    width: '14.28%',
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 2,
  },
  dayInner: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayInnerSelected: {
    backgroundColor: colors.accent,
  },
  dayInnerDisabled: {
    opacity: 0.35,
  },
  dayText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  dayTextSelected: {
    color: colors.textOnAccent,
  },
  dayTextDisabled: {
    color: colors.textMuted,
  },
  hint: {
    marginTop: space.md,
    textAlign: 'center',
    fontSize: 12,
    color: colors.textMuted,
  },
  timeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backLink: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.accent,
    width: 64,
  },
  backSpacer: {
    width: 64,
  },
  selectedDateLabel: {
    marginTop: space.md,
    marginBottom: space.sm,
    textAlign: 'center',
    fontSize: 12,
    color: colors.textMuted,
  },
  hourGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    justifyContent: 'center',
    marginTop: 8,
  },
  hourChip: {
    minWidth: 68,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSoft,
    alignItems: 'center',
  },
  hourText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
  },
  emptyHours: {
    marginTop: space.lg,
    textAlign: 'center',
    color: colors.textMuted,
    fontSize: 12,
  },
  cancelBtn: {
    marginTop: space.lg,
    alignItems: 'center',
    paddingVertical: 10,
  },
  cancelText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
  },
});
