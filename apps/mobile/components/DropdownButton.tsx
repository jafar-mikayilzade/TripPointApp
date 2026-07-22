import { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { colors } from '../constants/theme';

type Option = { label: string; value: string };

type Props = {
  label: string;
  value: string | null;
  options: Option[];
  onSelect: (value: string) => void;
};

export function DropdownButton({ label, value, options, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);

  return (
    <View>
      <TouchableOpacity
        onPress={() => setOpen(!open)}
        style={[styles.trigger, value ? styles.triggerActive : null]}
      >
        <Text
          style={[styles.triggerText, value ? styles.triggerTextActive : null]}
          numberOfLines={2}
        >
          {selected ? selected.label : label}
        </Text>
        <Text style={styles.caret}>{open ? '▲' : '▼'}</Text>
      </TouchableOpacity>

      {open ? (
        <View style={styles.menu}>
          {options.map((option) => {
            const isSelected = value === option.value;
            return (
              <TouchableOpacity
                key={option.value}
                onPress={() => {
                  onSelect(option.value);
                  setOpen(false);
                }}
                style={[styles.option, isSelected && styles.optionSelected]}
              >
                <Text
                  style={[styles.optionText, isSelected && styles.optionTextSelected]}
                >
                  {option.label}
                </Text>
                {isSelected ? <Text style={styles.check}>✓</Text> : null}
              </TouchableOpacity>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSoft,
  },
  triggerActive: {
    borderColor: colors.accent,
  },
  triggerText: {
    flex: 1,
    minWidth: 0,
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: '500',
    marginRight: 8,
  },
  triggerTextActive: {
    color: colors.text,
    fontWeight: '600',
  },
  caret: {
    fontSize: 9,
    color: colors.textMuted,
  },
  menu: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSoft,
    marginTop: 4,
    overflow: 'hidden',
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSoft,
  },
  optionSelected: {
    backgroundColor: colors.accentSoft,
  },
  optionText: {
    fontSize: 12,
    color: colors.chipText,
    fontWeight: '500',
  },
  optionTextSelected: {
    color: colors.accent,
    fontWeight: '600',
  },
  check: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: '700',
  },
});
