import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet } from 'react-native';

import { colors } from '../constants/theme';
import {
  isFavorited,
  toggleFavorite,
  type FavoriteTargetType,
} from '../lib/favorites';
import { isDatabasePoiId } from '../lib/livePlaces';
import { useInfoToast } from './InfoToastProvider';

type Props = {
  targetType: FavoriteTargetType;
  targetId: string;
  size?: number;
};

/**
 * Bookmark for DB POIs / listings only.
 * Live Google place_ids are not UUID — favorites.target_id is uuid.
 */
export function FavoriteButton({ targetType, targetId, size = 22 }: Props) {
  const { showInfo } = useInfoToast();
  const [favorited, setFavorited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);

  const unsupportedLivePoi =
    targetType === 'poi' && !!targetId && !isDatabasePoiId(targetId);

  useEffect(() => {
    if (unsupportedLivePoi || !targetId) {
      setFavorited(false);
      setReady(true);
      return;
    }

    let active = true;
    setReady(false);
    void isFavorited(targetType, targetId).then((value) => {
      if (active) {
        setFavorited(value);
        setReady(true);
      }
    });
    return () => {
      active = false;
    };
  }, [targetType, targetId, unsupportedLivePoi]);

  const onPress = useCallback(async () => {
    if (busy) {
      return;
    }
    if (unsupportedLivePoi) {
      Alert.alert(
        'Sevimlilər',
        'Canlı Google məkanlarını hələ sevimliyə əlavə etmək olmur. DB-dəki yerləri bookmark edin.'
      );
      return;
    }
    setBusy(true);
    const result = await toggleFavorite(targetType, targetId);
    setBusy(false);
    if (result.error) {
      Alert.alert('Sevimlilər', result.error);
      return;
    }
    setFavorited(result.favorited);
    showInfo(
      result.favorited ? 'Sevimlilərə əlavə olundu' : 'Sevimlilərdən çıxarıldı'
    );
  }, [busy, unsupportedLivePoi, targetType, targetId, showInfo]);

  if (unsupportedLivePoi) {
    return null;
  }

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

const styles = StyleSheet.create({
  btn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 2,
    borderColor: colors.favorite,
    backgroundColor: '#FFF9EB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnActive: {
    backgroundColor: '#FFF3D0',
    borderColor: '#D4A017',
  },
});
