import { useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';

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
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          backgroundColor: colors.surface,
          borderRadius: 16,
          padding: 14,
          borderWidth: 1,
          borderColor: value ? colors.accent : colors.border,
        }}
      >
        <Text
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 13,
            color: value ? colors.accent : colors.textSecondary,
            fontWeight: value ? '600' : '400',
            marginRight: 8,
          }}
          numberOfLines={2}
        >
          {selected ? selected.label : label}
        </Text>
        <Text style={{ fontSize: 12, color: colors.textMuted }}>{open ? '▲' : '▼'}</Text>
      </TouchableOpacity>

      {open ? (
        <View
          style={{
            backgroundColor: colors.surface,
            borderRadius: 16,
            borderWidth: 0,
            marginTop: 4,
            overflow: 'hidden',
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.06,
            shadowRadius: 12,
            elevation: 3,
          }}
        >
          {options.map((option) => (
            <TouchableOpacity
              key={option.value}
              onPress={() => {
                onSelect(option.value);
                setOpen(false);
              }}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: 12,
                borderBottomWidth: 1,
                borderBottomColor: colors.surfaceMuted,
                backgroundColor: value === option.value ? colors.accentSoft : colors.surface,
              }}
            >
              <Text
                style={{
                  fontSize: 13,
                  color: value === option.value ? colors.accent : colors.chipText,
                  fontWeight: value === option.value ? '600' : '400',
                }}
              >
                {option.label}
              </Text>
              {value === option.value ? (
                <Text style={{ color: colors.accent, fontSize: 14, fontWeight: '700' }}>✓</Text>
              ) : null}
            </TouchableOpacity>
          ))}
        </View>
      ) : null}
    </View>
  );
}
