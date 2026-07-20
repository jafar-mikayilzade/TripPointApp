import { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { colors } from '../constants/theme';

interface SimpleDateTimeFieldProps {
  value: Date;
  onChange: (next: Date) => void;
  mode?: 'datetime' | 'date';
  minimumDate?: Date;
  maximumDate?: Date;
}

const MONTH_LABELS = [
  'Yan',
  'Fev',
  'Mar',
  'Apr',
  'May',
  'İyn',
  'İyl',
  'Avq',
  'Sen',
  'Okt',
  'Noy',
  'Dek',
];

function startOfDay(date: Date): Date {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function formatValue(date: Date, mode: 'datetime' | 'date'): string {
  if (mode === 'date') {
    return date.toLocaleDateString('az-AZ', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  }
  return date.toLocaleString('az-AZ', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function buildDayOptions(minimumDate: Date, maximumDate: Date): Date[] {
  const start = startOfDay(minimumDate);
  const end = startOfDay(maximumDate);
  const days: Date[] = [];
  const cursor = new Date(start);

  while (cursor.getTime() <= end.getTime() && days.length < 400) {
    days.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  return days;
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = [0, 15, 30, 45];

export function SimpleDateTimeField({
  value,
  onChange,
  mode = 'datetime',
  minimumDate = new Date(),
  maximumDate,
}: SimpleDateTimeFieldProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);

  const resolvedMax = useMemo(() => {
    if (maximumDate) {
      return maximumDate;
    }
    if (mode === 'date') {
      return new Date();
    }
    const next = new Date(minimumDate);
    next.setDate(next.getDate() + 59);
    return next;
  }, [maximumDate, minimumDate, mode]);

  const dayOptions = useMemo(
    () => buildDayOptions(minimumDate, resolvedMax),
    [minimumDate, resolvedMax]
  );

  function openPicker() {
    setDraft(value);
    setOpen(true);
  }

  function apply() {
    if (mode === 'date') {
      const next = startOfDay(draft);
      onChange(next);
    } else {
      onChange(draft);
    }
    setOpen(false);
  }

  function selectDay(day: Date) {
    setDraft((current) => {
      const next = new Date(current);
      next.setFullYear(day.getFullYear(), day.getMonth(), day.getDate());
      if (mode === 'date') {
        next.setHours(0, 0, 0, 0);
      }
      return next;
    });
  }

  function selectHour(hour: number) {
    setDraft((current) => {
      const next = new Date(current);
      next.setHours(hour);
      return next;
    });
  }

  function selectMinute(minute: number) {
    setDraft((current) => {
      const next = new Date(current);
      next.setMinutes(minute, 0, 0);
      return next;
    });
  }

  const selectedDayKey = startOfDay(draft).getTime();

  return (
    <>
      <Pressable style={styles.trigger} onPress={openPicker}>
        <Text style={styles.triggerText}>{formatValue(value, mode)}</Text>
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <KeyboardAvoidingView
          style={styles.overlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={styles.sheet}>
            <Text style={styles.title}>{mode === 'date' ? 'Tarix seç' : 'Tarix və saat seç'}</Text>

            <Text style={styles.sectionLabel}>Gün</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.row}
            >
              {dayOptions.map((day) => {
                const selected = startOfDay(day).getTime() === selectedDayKey;
                return (
                  <Pressable
                    key={day.toISOString()}
                    style={[styles.chip, selected && styles.chipSelected]}
                    onPress={() => selectDay(day)}
                  >
                    <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                      {day.getDate()} {MONTH_LABELS[day.getMonth()]}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            {mode === 'datetime' ? (
              <>
                <Text style={styles.sectionLabel}>Saat</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.row}
                >
                  {HOURS.map((hour) => {
                    const selected = draft.getHours() === hour;
                    return (
                      <Pressable
                        key={hour}
                        style={[styles.chip, selected && styles.chipSelected]}
                        onPress={() => selectHour(hour)}
                      >
                        <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                          {String(hour).padStart(2, '0')}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>

                <Text style={styles.sectionLabel}>Dəqiqə</Text>
                <View style={styles.row}>
                  {MINUTES.map((minute) => {
                    const selected = draft.getMinutes() === minute;
                    return (
                      <Pressable
                        key={minute}
                        style={[styles.chip, selected && styles.chipSelected]}
                        onPress={() => selectMinute(minute)}
                      >
                        <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                          {String(minute).padStart(2, '0')}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </>
            ) : null}

            <View style={styles.actions}>
              <Pressable style={styles.cancelButton} onPress={() => setOpen(false)}>
                <Text style={styles.cancelText}>Ləğv et</Text>
              </Pressable>
              <Pressable style={styles.applyButton} onPress={apply}>
                <Text style={styles.applyText}>Seç</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  triggerText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 16,
    paddingBottom: 80,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 8,
  },
  sectionLabel: {
    marginTop: 12,
    marginBottom: 8,
    fontSize: 13,
    fontWeight: '700',
    color: colors.chipText,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
    paddingHorizontal: 16,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: colors.chip,
  },
  chipSelected: {
    backgroundColor: colors.accent,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.chipText,
  },
  chipTextSelected: {
    color: colors.textOnAccent,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 18,
    marginBottom: 20,
  },
  cancelButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    paddingVertical: 12,
    alignItems: 'center',
  },
  cancelText: {
    color: colors.chipText,
    fontWeight: '700',
  },
  applyButton: {
    flex: 1,
    backgroundColor: colors.accent,
    borderRadius: 16,
    paddingVertical: 12,
    alignItems: 'center',
  },
  applyText: {
    color: colors.textOnAccent,
    fontWeight: '700',
  },
});
