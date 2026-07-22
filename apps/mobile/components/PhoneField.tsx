import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

import {
  AZ_PHONE_MAX_WITH_LEADING_ZERO,
  AZ_PHONE_PREFIX,
  normalizeAzPhoneLocal,
  parseAzPhoneLocal,
  sanitizeAzPhoneLocalInput,
  validateAzPhone,
} from '../lib/formValidation';

import { colors } from '../constants/theme';

type PhoneFieldProps = Omit<TextInputProps, 'value' | 'onChangeText' | 'keyboardType'> & {
  label?: string;
  /** Yerli rəqəmlər və ya tam +994... dəyəri */
  value: string;
  /** Yerli rəqəmlər (yazarkən 0 saxlanıla bilər; blur-da normallaşır) */
  onChangeLocal: (localDigits: string) => void;
  error?: string | null;
  /** Blur zamanı validasiya nəticəsi (null = OK) */
  onValidationError?: (error: string | null) => void;
  required?: boolean;
  editable?: boolean;
};

/**
 * Sabit +994 prefiksi + yalnız rəqəm.
 * Başdakı 0 xanadan çıxanda (blur) silinir; operator kodu yoxlanır.
 */
export function PhoneField({
  label,
  value,
  onChangeLocal,
  error,
  onValidationError,
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
    onValidationError?.(null);
  }

  function handleBlur(event: Parameters<NonNullable<TextInputProps['onBlur']>>[0]) {
    const normalized = normalizeAzPhoneLocal(value);
    const validationError = validateAzPhone(normalized, required);

    if (validationError && normalized) {
      // Səhv format: növbəti addımda xana boş olsun
      onChangeLocal('');
      onValidationError?.(validationError);
    } else {
      onChangeLocal(normalized);
      onValidationError?.(validationError);
    }
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
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    marginBottom: 8,
    marginTop: 4,
    minWidth: 0,
    width: '100%',
  },
  label: {
    fontSize: 12,
    color: colors.chipText,
    marginBottom: 4,
    fontWeight: '600',
  },
  requiredMark: {
    color: colors.danger,
    fontWeight: '700',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSoft,
    borderRadius: 10,
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
    paddingHorizontal: 10,
    paddingVertical: 10,
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
    backgroundColor: colors.chip,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: colors.borderSoft,
  },
  input: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.text,
  },
  errorText: {
    marginTop: 4,
    fontSize: 12,
    color: colors.danger,
    lineHeight: 16,
    flexShrink: 1,
  },
});
