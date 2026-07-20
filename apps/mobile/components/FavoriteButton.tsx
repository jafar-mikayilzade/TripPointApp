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

export function FavoriteButton({ targetType, targetId, size = 20 }: Props) {
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
      hitSlop={10}
      style={styles.btn}
      accessibilityLabel={favorited ? 'Sevimlidən çıxar' : 'Sevimlilərə əlavə et'}
    >
      {busy || !ready ? (
        <ActivityIndicator size="small" color={colors.accent} />
      ) : (
        <FontAwesome
          name={favorited ? 'bookmark' : 'bookmark-o'}
          size={size}
          color={favorited ? colors.accent : colors.textSecondary}
        />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    minWidth: 28,
    minHeight: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
