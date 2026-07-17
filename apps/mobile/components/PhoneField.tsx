import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

import {
  AZ_PHONE_MAX_WITH_LEADING_ZERO,
  AZ_PHONE_PREFIX,
  normalizeAzPhoneLocal,
  parseAzPhoneLocal,
  sanitizeAzPhoneLocalInput,
} from '../lib/formValidation';

type PhoneFieldProps = Omit<TextInputProps, 'value' | 'onChangeText' | 'keyboardType'> & {
  label?: string;
  /** Yerli rəqəmlər və ya tam +994... dəyəri */
  value: string;
  /** Yerli rəqəmlər (yazarkən 0 saxlanıla bilər; blur-da normallaşır) */
  onChangeLocal: (localDigits: string) => void;
  error?: string | null;
  required?: boolean;
  editable?: boolean;
};

/**
 * Sabit +994 prefiksi + yalnız rəqəm.
 * Başdakı 0 xanadan çıxanda (blur) silinir.
 */
export function PhoneField({
  label,
  value,
  onChangeLocal,
  error,
  required = false,
  editable = true,
  style,
  onBlur,
  ...inputProps
}: PhoneFieldProps) {
  const raw = (value ?? '').trim();
  const displayValue =
    !raw
      ? ''
      : raw.startsWith('+') || raw.startsWith('994')
        ? parseAzPhoneLocal(raw)
        : sanitizeAzPhoneLocalInput(raw);

  function handleChange(text: string) {
    onChangeLocal(sanitizeAzPhoneLocalInput(text));
  }

  function handleBlur(event: Parameters<NonNullable<TextInputProps['onBlur']>>[0]) {
    onChangeLocal(normalizeAzPhoneLocal(value));
    onBlur?.(event);
  }

  return (
    <View style={styles.field}>
      {label ? (
        <Text style={styles.label}>
          {label}
          {required ? <Text style={styles.requiredMark}> *</Text> : null}
        </Text>
      ) : null}
      <View
        style={[
          styles.row,
          error ? styles.rowError : null,
          !editable && styles.rowDisabled,
        ]}
      >
        <Text style={styles.prefix}>{AZ_PHONE_PREFIX}</Text>
        <TextInput
          style={[styles.input, style]}
          value={displayValue}
          onChangeText={handleChange}
          onBlur={handleBlur}
          placeholder="XX XXX XX XX"
          placeholderTextColor="#9CA3AF"
          keyboardType="number-pad"
          maxLength={AZ_PHONE_MAX_WITH_LEADING_ZERO}
          editable={editable}
          autoCorrect={false}
          autoCapitalize="none"
          {...inputProps}
        />
      </View>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    marginBottom: 16,
    minWidth: 0,
    width: '100%',
  },
  label: {
    fontSize: 13,
    color: '#374151',
    marginBottom: 6,
    fontWeight: '500',
  },
  requiredMark: {
    color: '#DC2626',
    fontWeight: '700',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    backgroundColor: '#fff',
    overflow: 'hidden',
    minWidth: 0,
  },
  rowError: {
    borderColor: '#DC2626',
  },
  rowDisabled: {
    opacity: 0.6,
  },
  prefix: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 15,
    fontWeight: '700',
    color: '#111827',
    backgroundColor: '#F3F4F6',
    borderRightWidth: 1,
    borderRightColor: '#E5E7EB',
  },
  input: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 15,
    color: '#111827',
  },
  errorText: {
    marginTop: 6,
    fontSize: 12,
    color: '#DC2626',
    lineHeight: 16,
    flexShrink: 1,
  },
});
