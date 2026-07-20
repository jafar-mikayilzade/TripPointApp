import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet } from 'react-native';

import { colors } from '../constants/theme';
import {
  isFavorited,
  toggleFavorite,
  type FavoriteTargetType,
} from '../lib/favorites';

type Props = {
  targetType: FavoriteTargetType;
  targetId: string;
  size?: number;
};

const FAVORITE_YELLOW = '#E8B84A';

export function FavoriteButton({ targetType, targetId, size = 22 }: Props) {
  const [favorited, setFavorited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
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
  }, [targetType, targetId]);

  const onPress = useCallback(async () => {
    if (busy) {
      return;
    }
    setBusy(true);
    const result = await toggleFavorite(targetType, targetId);
    if (!result.error) {
      setFavorited(result.favorited);
    }
    setBusy(false);
  }, [busy, targetType, targetId]);

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
        <ActivityIndicator size="small" color={FAVORITE_YELLOW} />
      ) : (
        <FontAwesome
          name={favorited ? 'bookmark' : 'bookmark-o'}
          size={size}
          color={favorited ? FAVORITE_YELLOW : colors.textSecondary}
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
    borderColor: FAVORITE_YELLOW,
    backgroundColor: '#FFF9EB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnActive: {
    backgroundColor: '#FFF3D0',
    borderColor: '#D4A017',
  },
});
