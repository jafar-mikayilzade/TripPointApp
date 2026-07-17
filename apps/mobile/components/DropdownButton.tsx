import { useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';

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
          backgroundColor: 'white',
          borderRadius: 12,
          padding: 12,
          borderWidth: 1.5,
          borderColor: value ? '#7C3AED' : '#E5E7EB',
        }}
      >
        <Text
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 13,
            color: value ? '#7C3AED' : '#6B7280',
            fontWeight: value ? '600' : '400',
            marginRight: 8,
          }}
          numberOfLines={2}
        >
          {selected ? selected.label : label}
        </Text>
        <Text style={{ fontSize: 12, color: '#9CA3AF' }}>{open ? '▲' : '▼'}</Text>
      </TouchableOpacity>

      {open ? (
        <View
          style={{
            backgroundColor: 'white',
            borderRadius: 12,
            borderWidth: 1,
            borderColor: '#E5E7EB',
            marginTop: 4,
            overflow: 'hidden',
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.1,
            elevation: 4,
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
                borderBottomColor: '#F9FAFB',
                backgroundColor: value === option.value ? '#F5F3FF' : 'white',
              }}
            >
              <Text
                style={{
                  fontSize: 13,
                  color: value === option.value ? '#7C3AED' : '#374151',
                  fontWeight: value === option.value ? '600' : '400',
                }}
              >
                {option.label}
              </Text>
              {value === option.value ? (
                <Text style={{ color: '#7C3AED', fontSize: 14, fontWeight: '700' }}>✓</Text>
              ) : null}
            </TouchableOpacity>
          ))}
        </View>
      ) : null}
    </View>
  );
}
