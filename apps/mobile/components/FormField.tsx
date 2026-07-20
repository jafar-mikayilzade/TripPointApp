import { useState, type ReactNode } from 'react';
import type { TextInputProps, StyleProp, ViewStyle } from 'react-native';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { colors } from '../constants/theme';

interface FormFieldProps extends TextInputProps {
  label: string;
  /** Parol sahəsi üçün Göstər/Gizlət düyməsi */
  showPasswordToggle?: boolean;
  /** Label ilə input arasında (məs: şifrə tələbləri) */
  belowLabel?: ReactNode;
  /** Input altında xəta mətni */
  error?: string | null;
  containerStyle?: StyleProp<ViewStyle>;
  /** Qeydiyyat şifrəsi — sistem / Google autofill təklifini mümkün qədər söndür */
  disablePasswordSuggestions?: boolean;
}

export function FormField({
  label,
  style,
  showPasswordToggle = false,
  belowLabel,
  error,
  containerStyle,
  secureTextEntry,
  disablePasswordSuggestions = false,
  ...inputProps
}: FormFieldProps) {
  const [visible, setVisible] = useState(false);
  const wantsSecure = Boolean(secureTextEntry);
  // Gizli: secureTextEntry true və hələ "Göstər" basılmayıb
  const isSecure = wantsSecure && !(showPasswordToggle && visible);

  return (
    <View
      style={[styles.field, containerStyle]}
      {...(disablePasswordSuggestions && Platform.OS === 'android'
        ? { importantForAutofill: 'noExcludeDescendants' as const }
        : {})}
    >
      <Text style={styles.label}>{label}</Text>
      {belowLabel}
      <View style={styles.inputWrap}>
        <TextInput
          style={[
            styles.input,
            showPasswordToggle && styles.inputWithToggle,
            error ? styles.inputError : null,
            style,
          ]}
          placeholderTextColor={colors.textMuted}
          {...inputProps}
          {...(disablePasswordSuggestions
            ? {
                textContentType: 'oneTimeCode' as const,
                autoComplete: 'off' as const,
                importantForAutofill: 'no' as const,
                autoCorrect: false,
                spellCheck: false,
              }
            : {})}
          // Həmişə ən sonda — heç nə override etməsin (visible-password İSTİFADƏ ETMƏ)
          secureTextEntry={isSecure}
        />
        {showPasswordToggle ? (
          <Pressable
            style={styles.toggle}
            onPress={() => setVisible((v) => !v)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={visible ? 'Şifrəni gizlət' : 'Şifrəni göstər'}
          >
            <Text style={styles.toggleText}>{visible ? 'Gizlət' : 'Göstər'}</Text>
          </Pressable>
        ) : null}
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
    color: colors.chipText,
    marginBottom: 6,
    fontWeight: '500',
    flexShrink: 1,
  },
  inputWrap: {
    position: 'relative',
    justifyContent: 'center',
    width: '100%',
    minWidth: 0,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.borderSoft,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 15,
    color: colors.text,
    width: '100%',
    backgroundColor: colors.surface,
  },
  inputError: {
    borderColor: colors.danger,
  },
  inputWithToggle: {
    paddingRight: 72,
  },
  toggle: {
    position: 'absolute',
    right: 12,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    zIndex: 2,
    elevation: 2,
  },
  toggleText: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: '700',
  },
  errorText: {
    marginTop: 6,
    fontSize: 12,
    color: colors.danger,
    lineHeight: 16,
    flexShrink: 1,
  },
});
