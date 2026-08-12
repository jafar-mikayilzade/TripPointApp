import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { ThemeColors } from '../constants/theme';
import {
  AZ_PHONE_PREFIX,
  formatAzPhoneE164,
  parseAzPhoneLocal,
  sanitizeAzPhoneLocalInput,
  validateAzPhone,
} from '../lib/formValidation';
import { supabase } from '../lib/supabase';
import { useThemeColors } from '../theme/ThemeProvider';
import { PhoneField } from './PhoneField';

export type ListingPhoneMode = 'ask' | 'profile' | 'manual';

type Props = {
  error?: string | null;
  onClearError?: () => void;
  onError?: (message: string | null) => void;
};

/**
 * İcma elanları üçün əlaqə nömrəsi:
 * profil nömrəsi varsa — «istifadə olunsun?» Bəli/Xeyr;
 * Xeyr → əl ilə PhoneField.
 */
export function useListingContactPhone(active: boolean) {
  const [phoneMode, setPhoneMode] = useState<ListingPhoneMode>('manual');
  const [profilePhoneLocal, setProfilePhoneLocal] = useState('');
  const [contactPhone, setContactPhone] = useState('');

  useEffect(() => {
    if (!active) {
      return;
    }
    setPhoneMode('manual');
    setProfilePhoneLocal('');
    setContactPhone('');

    let cancelled = false;
    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || cancelled) {
        return;
      }
      const { data } = await supabase
        .from('profiles')
        .select('phone')
        .eq('id', user.id)
        .maybeSingle();
      if (cancelled) {
        return;
      }
      const local = parseAzPhoneLocal(data?.phone);
      if (local && !validateAzPhone(local, true)) {
        setProfilePhoneLocal(local);
        setPhoneMode('ask');
      } else {
        setProfilePhoneLocal('');
        setPhoneMode('manual');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [active]);

  function validate(): string | null {
    if (phoneMode === 'ask') {
      return 'Profil nömrəsi istifadə olunsun? Bəli və ya Xeyr seçin.';
    }
    const source = phoneMode === 'profile' ? profilePhoneLocal : contactPhone;
    return validateAzPhone(source, true);
  }

  function toE164(): string {
    const source = phoneMode === 'profile' ? profilePhoneLocal : contactPhone;
    return formatAzPhoneE164(source);
  }

  function applyProfilePhone() {
    setContactPhone(profilePhoneLocal);
    setPhoneMode('profile');
  }

  function applyManualPhone() {
    setContactPhone('');
    setPhoneMode('manual');
  }

  function useProfileAgain() {
    if (!profilePhoneLocal) {
      return;
    }
    setContactPhone(profilePhoneLocal);
    setPhoneMode('profile');
  }

  return {
    phoneMode,
    profilePhoneLocal,
    contactPhone,
    setContactPhone,
    applyProfilePhone,
    applyManualPhone,
    useProfileAgain,
    validate,
    toE164,
  };
}

type FieldProps = Props & {
  phoneMode: ListingPhoneMode;
  profilePhoneLocal: string;
  contactPhone: string;
  onChangeContactPhone: (local: string) => void;
  onUseProfile: () => void;
  onUseManual: () => void;
  onUseProfileAgain?: () => void;
};

export function ListingContactPhoneField({
  phoneMode,
  profilePhoneLocal,
  contactPhone,
  onChangeContactPhone,
  onUseProfile,
  onUseManual,
  onUseProfileAgain,
  error,
  onClearError,
  onError,
}: FieldProps) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const profileDisplay = profilePhoneLocal
    ? `${AZ_PHONE_PREFIX}${profilePhoneLocal}`
    : '';

  if (phoneMode === 'ask' && profilePhoneLocal) {
    return (
      <View style={styles.phoneChoiceBox}>
        <Text style={styles.phoneChoiceTitle}>
          Əlaqə nömrəsi <Text style={styles.req}>*</Text>
        </Text>
        <Text style={styles.phoneChoiceHint}>
          Profilimdəki nömrə istifadə olunsun?
        </Text>
        <Text style={styles.phoneChoiceValue}>{profileDisplay}</Text>
        <View style={styles.phoneChoiceRow}>
          <Pressable
            style={[styles.phoneChoiceBtn, styles.phoneChoiceBtnYes]}
            onPress={() => {
              onClearError?.();
              onUseProfile();
            }}
          >
            <Text style={styles.phoneChoiceBtnYesText}>Bəli</Text>
          </Pressable>
          <Pressable
            style={[styles.phoneChoiceBtn, styles.phoneChoiceBtnNo]}
            onPress={() => {
              onClearError?.();
              onUseManual();
            }}
          >
            <Text style={styles.phoneChoiceBtnNoText}>Xeyr</Text>
          </Pressable>
        </View>
        {error ? <Text style={styles.phoneChoiceError}>{error}</Text> : null}
      </View>
    );
  }

  if (phoneMode === 'profile' && profilePhoneLocal) {
    return (
      <View style={styles.phoneChoiceBox}>
        <Text style={styles.phoneChoiceTitle}>
          Əlaqə nömrəsi <Text style={styles.req}>*</Text>
        </Text>
        <Text style={styles.phoneChoiceValue}>{profileDisplay}</Text>
        <Text style={styles.phoneChoiceHint}>Profil nömrəsi istifadə olunur</Text>
        <Pressable
          onPress={() => {
            onClearError?.();
            onUseManual();
          }}
          hitSlop={8}
        >
          <Text style={styles.phoneChangeLink}>Başqa nömrə yazım</Text>
        </Pressable>
        {error ? <Text style={styles.phoneChoiceError}>{error}</Text> : null}
      </View>
    );
  }

  return (
    <View>
      <PhoneField
        label="Əlaqə nömrəsi"
        required
        value={contactPhone}
        onChangeLocal={(local) => {
          onClearError?.();
          onChangeContactPhone(sanitizeAzPhoneLocalInput(local));
        }}
        onValidationError={(err) => onError?.(err)}
        error={error ?? null}
      />
      {profilePhoneLocal ? (
        <Pressable
          onPress={() => {
            onClearError?.();
            if (onUseProfileAgain) {
              onUseProfileAgain();
            } else {
              onUseProfile();
            }
          }}
          hitSlop={8}
          style={styles.backToProfile}
        >
          <Text style={styles.phoneChangeLink}>Profilimdəki nömrədən istifadə et</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    phoneChoiceBox: {
      marginTop: 4,
      marginBottom: 4,
      paddingVertical: 8,
      paddingHorizontal: 10,
      borderRadius: 10,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.borderSoft,
      gap: 6,
    },
    phoneChoiceTitle: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.chipText,
    },
    req: {
      color: colors.danger,
      fontWeight: '700',
    },
    phoneChoiceHint: {
      fontSize: 12,
      lineHeight: 16,
      color: colors.textSecondary,
      fontWeight: '500',
    },
    phoneChoiceValue: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.text,
    },
    phoneChoiceRow: {
      flexDirection: 'row',
      gap: 8,
      marginTop: 2,
    },
    phoneChoiceBtn: {
      flex: 1,
      borderRadius: 8,
      paddingVertical: 8,
      alignItems: 'center',
    },
    phoneChoiceBtnYes: {
      backgroundColor: colors.accent,
    },
    phoneChoiceBtnNo: {
      backgroundColor: colors.chip,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.borderSoft,
    },
    phoneChoiceBtnYesText: {
      color: colors.textOnAccent,
      fontWeight: '700',
      fontSize: 12,
    },
    phoneChoiceBtnNoText: {
      color: colors.text,
      fontWeight: '600',
      fontSize: 12,
    },
    phoneChangeLink: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.accent,
    },
    phoneChoiceError: {
      fontSize: 11,
      color: colors.danger,
      fontWeight: '500',
    },
    backToProfile: {
      marginTop: 4,
      marginBottom: 2,
    },
  });
}
