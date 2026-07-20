import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

import {
  AZ_PHONE_MAX_WITH_LEADING_ZERO,
  AZ_PHONE_PREFIX,
  normalizeAzPhoneLocal,
  parseAzPhoneLocal,
  sanitizeAzPhoneLocalInput,
} from '../lib/formValidation';

import { colors } from '../constants/theme';

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
          placeholder={error && !displayValue ? 'Boş ola bilməz' : 'XX XXX XX XX'}
          placeholderTextColor={error && !displayValue ? colors.danger : colors.textMuted}
          keyboardType="number-pad"
          maxLength={AZ_PHONE_MAX_WITH_LEADING_ZERO}
          editable={editable}
          autoCorrect={false}
          autoCapitalize="none"
          {...inputProps}
        />
      </View>
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
    color: colors.chipText,
    marginBottom: 6,
    fontWeight: '500',
  },
  requiredMark: {
    color: colors.danger,
    fontWeight: '700',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.borderSoft,
    borderRadius: 16,
    backgroundColor: colors.surface,
    overflow: 'hidden',
    minWidth: 0,
  },
  rowError: {
    borderColor: colors.danger,
  },
  rowDisabled: {
    opacity: 0.6,
  },
  prefix: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
    backgroundColor: colors.chip,
    borderRightWidth: 1,
    borderRightColor: colors.border,
  },
  input: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.text,
  },
  errorText: {
    marginTop: 6,
    fontSize: 12,
    color: colors.danger,
    lineHeight: 16,
    flexShrink: 1,
  },
});

