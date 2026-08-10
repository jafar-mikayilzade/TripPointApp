import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet } from 'react-native';

import type { ThemeColors } from '../constants/theme';
import {
  isFavorited,
  toggleFavorite,
  type FavoriteTargetType,
  type LivePoiFavoriteSeed,
} from '../lib/favorites';
import { isDatabasePoiId } from '../lib/livePlaces';
import { useThemeColors } from '../theme/ThemeProvider';
import { useInfoToast } from './InfoToastProvider';

type Props = {
  targetType: FavoriteTargetType;
  targetId: string;
  size?: number;
  /** Live Google POI — upsert-then-favorite */
  liveSeed?: LivePoiFavoriteSeed | null;
  /** Called when live POI was persisted and UUID resolved */
  onResolvedId?: (dbId: string) => void;
};

/**
 * Bookmark for listings and POIs (DB UUID or live Google with liveSeed).
 */
export function FavoriteButton({
  targetType,
  targetId,
  size = 22,
  liveSeed = null,
  onResolvedId,
}: Props) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { showInfo } = useInfoToast();
  const [favorited, setFavorited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [activeId, setActiveId] = useState(targetId);

  useEffect(() => {
    setActiveId(targetId);
  }, [targetId]);

  useEffect(() => {
    if (!activeId || (targetType === 'poi' && !isDatabasePoiId(activeId))) {
      setFavorited(false);
      setReady(true);
      return;
    }

    let active = true;
    setReady(false);
    void isFavorited(targetType, activeId).then((value) => {
      if (active) {
        setFavorited(value);
        setReady(true);
      }
    });
    return () => {
      active = false;
    };
  }, [targetType, activeId]);

  const onPress = useCallback(async () => {
    if (busy) {
      return;
    }
    setBusy(true);
    const result = await toggleFavorite(targetType, activeId, liveSeed);
    setBusy(false);
    if (result.error) {
      Alert.alert('Sevimlilər', result.error);
      return;
    }
    if (result.resolvedId && result.resolvedId !== activeId) {
      setActiveId(result.resolvedId);
      onResolvedId?.(result.resolvedId);
    }
    setFavorited(result.favorited);
    showInfo(
      result.favorited ? 'Sevimlilərə əlavə olundu' : 'Sevimlilərdən çıxarıldı'
    );
  }, [busy, targetType, activeId, liveSeed, onResolvedId, showInfo]);

  return (
    <Pressable
      onPress={(e) => {
        e.stopPropagation?.();
        void onPress();
      }}
      hitSlop={8}
      style={[styles.btn, favorited && styles.btnActive]}
      accessibilityLabel={favorited ? 'Sevimlidən çıxar' : 'Sevimlilərə əlavə et'}
    >
      {busy || !ready ? (
        <ActivityIndicator size="small" color={colors.favorite} />
      ) : (
        <FontAwesome
          name={favorited ? 'bookmark' : 'bookmark-o'}
          size={size}
          color={favorited ? colors.favorite : colors.textSecondary}
        />
      )}
    </Pressable>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    btn: {
      width: 42,
      height: 42,
      borderRadius: 21,
      borderWidth: 2,
      borderColor: colors.favorite,
      backgroundColor: colors.warningSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    btnActive: {
      backgroundColor: colors.warningSoft,
      borderColor: colors.favorite,
    },
  });
}
