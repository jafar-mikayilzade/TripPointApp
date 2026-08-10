import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo, useState, type ComponentProps, type ReactNode } from 'react';
import type { TextInputProps, StyleProp, ViewStyle } from 'react-native';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { ThemeColors } from '../constants/theme';
import { radii } from '../constants/theme';
import { useThemeColors } from '../theme/ThemeProvider';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

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
  /** Sol tərəfdə nazik xəttli ikon */
  leftIcon?: IoniconName;
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
  leftIcon,
  ...inputProps
}: FormFieldProps) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [visible, setVisible] = useState(false);
  const wantsSecure = Boolean(secureTextEntry);
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
      <View
        style={[
          styles.inputWrap,
          error ? styles.inputWrapError : null,
        ]}
      >
        {leftIcon ? (
          <Ionicons
            name={leftIcon}
            size={18}
            color={colors.brand}
            style={styles.leftIcon}
          />
        ) : null}
        <TextInput
          style={[
            styles.input,
            leftIcon ? styles.inputWithLeftIcon : null,
            showPasswordToggle && styles.inputWithToggle,
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
            <Ionicons
              name={visible ? 'eye-off-outline' : 'eye-outline'}
              size={20}
              color={colors.brand}
            />
          </Pressable>
        ) : null}
      </View>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    field: {
      marginBottom: 16,
      minWidth: 0,
      width: '100%',
    },
    label: {
      fontSize: 13,
      color: colors.textSecondary,
      marginBottom: 6,
      fontWeight: '600',
      flexShrink: 1,
    },
    inputWrap: {
      position: 'relative',
      flexDirection: 'row',
      alignItems: 'center',
      width: '100%',
      minWidth: 0,
      borderWidth: 1.5,
      borderColor: colors.brand,
      borderRadius: radii.md,
      backgroundColor: colors.surfaceMuted,
    },
    inputWrapError: {
      borderColor: colors.danger,
    },
    leftIcon: {
      marginLeft: 14,
    },
    input: {
      flex: 1,
      borderWidth: 0,
      paddingHorizontal: 14,
      paddingVertical: 13,
      fontSize: 15,
      color: colors.text,
      backgroundColor: 'transparent',
    },
    inputWithLeftIcon: {
      paddingLeft: 10,
    },
    inputWithToggle: {
      paddingRight: 48,
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
    errorText: {
      marginTop: 6,
      fontSize: 12,
      color: colors.danger,
      lineHeight: 16,
      flexShrink: 1,
    },
  });
}
