import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { colors } from '../constants/theme';
import { isSubscribed, toggleSubscription } from '../lib/subscriptions';
import { useInfoToast } from './InfoToastProvider';

type Props = {
  listingId: string;
  organizerId?: string | null;
  /** List cards: icon-only. Detail: full Abunə pill + expandable panel. */
  compact?: boolean;
  /** When true, show tour+organizer toggles inline (detail sheet). */
  expandable?: boolean;
  disabled?: boolean;
};

/**
 * One Abunə entry point for tour + organizer subscriptions.
 * Compact → Alert menu. Expandable → inline panel under the pill.
 */
export function SubscribeMenuButton({
  listingId,
  organizerId,
  compact = false,
  expandable = false,
  disabled = false,
}: Props) {
  const { showInfo } = useInfoToast();
  const [tourOn, setTourOn] = useState(false);
  const [orgOn, setOrgOn] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const refresh = useCallback(async () => {
    const [t, o] = await Promise.all([
      isSubscribed('listing', listingId),
      organizerId ? isSubscribed('organizer', organizerId) : Promise.resolve(false),
    ]);
    setTourOn(t);
    setOrgOn(o);
    setReady(true);
  }, [listingId, organizerId]);

  useEffect(() => {
    let active = true;
    setReady(false);
    void refresh().then(() => {
      if (!active) return;
    });
    return () => {
      active = false;
    };
  }, [refresh]);

  const anyOn = tourOn || orgOn;

  const runToggle = useCallback(
    async (kind: 'listing' | 'organizer') => {
      if (busy || disabled) return;
      const targetId = kind === 'listing' ? listingId : organizerId;
      if (!targetId) return;
      setBusy(true);
      const result = await toggleSubscription(kind, targetId);
      setBusy(false);
      if (result.error) {
        Alert.alert('Abunəlik', result.error);
        return;
      }
      if (kind === 'listing') {
        setTourOn(result.subscribed);
        showInfo(
          result.subscribed ? 'Tura abunə oldunuz' : 'Tur abunəliyindən çıxdınız'
        );
      } else {
        setOrgOn(result.subscribed);
        showInfo(
          result.subscribed
            ? 'Təşkilatçıya abunə oldunuz'
            : 'Təşkilatçı abunəliyindən çıxdınız'
        );
      }
    },
    [busy, disabled, listingId, organizerId, showInfo]
  );

  const openMenu = useCallback(() => {
    if (disabled || busy) return;
    if (expandable) {
      setOpen((v) => !v);
      return;
    }
    const buttons: {
      text: string;
      style?: 'cancel' | 'destructive' | 'default';
      onPress?: () => void;
    }[] = [
      {
        text: tourOn ? '✓ Bu tur — abunəlikdən çıx' : 'Bu tura abunə ol',
        onPress: () => void runToggle('listing'),
      },
    ];
    if (organizerId) {
      buttons.push({
        text: orgOn ? '✓ Təşkilatçı — çıx' : 'Təşkilatçıya abunə ol',
        onPress: () => void runToggle('organizer'),
      });
    }
    buttons.push({ text: 'Bağla', style: 'cancel' });
    Alert.alert('Abunəlik', 'Nəyi izləmək istəyirsiniz?', buttons);
  }, [disabled, busy, expandable, tourOn, orgOn, organizerId, runToggle]);

  if (compact) {
    return (
      <Pressable
        onPress={(e) => {
          e.stopPropagation?.();
          void openMenu();
        }}
        hitSlop={8}
        style={[styles.iconBtn, anyOn && styles.iconBtnActive]}
        accessibilityLabel="Abunəlik"
        disabled={disabled || !ready}
      >
        {!ready || busy ? (
          <ActivityIndicator size="small" color={colors.accent} />
        ) : (
          <FontAwesome
            name={anyOn ? 'bell' : 'bell-o'}
            size={16}
            color={anyOn ? colors.accent : colors.textSecondary}
          />
        )}
      </Pressable>
    );
  }

  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={openMenu}
        style={[
          styles.pill,
          anyOn && styles.pillActive,
          (disabled || busy) && styles.pillDisabled,
        ]}
        disabled={disabled || busy}
        accessibilityLabel="Abunə"
      >
        {busy || !ready ? (
          <ActivityIndicator size="small" color={colors.accent} />
        ) : (
          <>
            <FontAwesome
              name={anyOn ? 'bell' : 'bell-o'}
              size={14}
              color={anyOn ? colors.accentPressed : colors.textSecondary}
            />
            <Text style={[styles.pillText, anyOn && styles.pillTextActive]}>
              {anyOn ? 'Abunəlik' : 'Abunə ol'}
            </Text>
            {expandable ? (
              <FontAwesome
                name={open ? 'chevron-up' : 'chevron-down'}
                size={11}
                color={anyOn ? colors.accentPressed : colors.textMuted}
              />
            ) : null}
          </>
        )}
      </Pressable>

      {expandable && open ? (
        <View style={styles.panel}>
          <Pressable
            style={styles.panelRow}
            onPress={() => void runToggle('listing')}
            disabled={busy}
          >
            <View style={styles.panelLeft}>
              <FontAwesome name="map" size={13} color={colors.accent} />
              <Text style={styles.panelLabel}>Bu tur</Text>
            </View>
            <Text style={[styles.panelState, tourOn && styles.panelStateOn]}>
              {tourOn ? 'Aktiv' : 'Qoşul'}
            </Text>
          </Pressable>
          {organizerId ? (
            <Pressable
              style={[styles.panelRow, styles.panelRowBorder]}
              onPress={() => void runToggle('organizer')}
              disabled={busy}
            >
              <View style={styles.panelLeft}>
                <FontAwesome name="user" size={13} color={colors.success} />
                <Text style={styles.panelLabel}>Təşkilatçı</Text>
              </View>
              <Text style={[styles.panelState, orgOn && styles.panelStateOn]}>
                {orgOn ? 'Aktiv' : 'Qoşul'}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: 12,
    marginBottom: 4,
    gap: 8,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtnActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  pill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: colors.surfaceMuted,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSoft,
  },
  pillActive: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent,
  },
  pillDisabled: {
    opacity: 0.6,
  },
  pillText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  pillTextActive: {
    color: colors.accentPressed,
  },
  panel: {
    borderRadius: 14,
    backgroundColor: colors.surfaceMuted,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSoft,
    overflow: 'hidden',
  },
  panelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  panelRowBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderSoft,
  },
  panelLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  panelLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  panelState: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textMuted,
  },
  panelStateOn: {
    color: colors.success,
  },
});
