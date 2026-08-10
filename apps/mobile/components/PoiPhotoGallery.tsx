import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Dimensions,
  FlatList,
  Image,
  Modal,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';

import type { ThemeColors } from '../constants/theme';
import { useThemeColors } from '../theme/ThemeProvider';

type PoiPhotoGalleryProps = {
  urls: string[];
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  /** Compact layout for home selected panel */
  compact?: boolean;
};

export function PoiPhotoGallery({
  urls,
  activeIndex,
  onActiveIndexChange,
  compact = false,
}: PoiPhotoGalleryProps) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors, compact), [colors, compact]);
  const [fullscreen, setFullscreen] = useState(false);
  const [heroWidth, setHeroWidth] = useState(
    () => Math.max(Dimensions.get('window').width - (compact ? 48 : 40), 240)
  );
  const heroScrollRef = useRef<ScrollView>(null);
  const fullscreenRef = useRef<FlatList<string>>(null);
  const safeIndex = Math.min(Math.max(activeIndex, 0), Math.max(urls.length - 1, 0));

  useEffect(() => {
    if (urls.length === 0 || heroWidth <= 0) {
      return;
    }
    heroScrollRef.current?.scrollTo({ x: safeIndex * heroWidth, animated: false });
  }, [urls.length, safeIndex, heroWidth]);

  useEffect(() => {
    if (!fullscreen || urls.length === 0) {
      return;
    }
    requestAnimationFrame(() => {
      fullscreenRef.current?.scrollToIndex({ index: safeIndex, animated: false });
    });
  }, [fullscreen, safeIndex, urls.length]);

  function goTo(index: number, animated = true) {
    if (urls.length === 0) {
      return;
    }
    const next = ((index % urls.length) + urls.length) % urls.length;
    onActiveIndexChange(next);
    heroScrollRef.current?.scrollTo({ x: next * heroWidth, animated });
    if (fullscreen) {
      fullscreenRef.current?.scrollToIndex({ index: next, animated });
    }
  }

  function onHeroScrollEnd(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const x = event.nativeEvent.contentOffset.x;
    const index = Math.round(x / Math.max(heroWidth, 1));
    if (index >= 0 && index < urls.length && index !== safeIndex) {
      onActiveIndexChange(index);
    }
  }

  if (urls.length === 0) {
    return null;
  }

  return (
    <>
      <View style={styles.block}>
        <View
          style={styles.heroWrap}
          onLayout={(e) => {
            const w = Math.round(e.nativeEvent.layout.width);
            if (w > 0 && w !== heroWidth) {
              setHeroWidth(w);
            }
          }}
        >
          <ScrollView
            ref={heroScrollRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={onHeroScrollEnd}
            style={{ width: heroWidth }}
          >
            {urls.map((url, index) => (
              <Image
                key={`${url}-${index}`}
                source={{ uri: url }}
                style={[styles.heroImage, { width: heroWidth }]}
                resizeMode="cover"
              />
            ))}
          </ScrollView>

          {urls.length > 1 ? (
            <>
              <Pressable
                style={[styles.navBtn, styles.navBtnLeft]}
                onPress={() => goTo(safeIndex - 1)}
                hitSlop={8}
              >
                <Ionicons name="chevron-back" size={20} color="#fff" />
              </Pressable>
              <Pressable
                style={[styles.navBtn, styles.navBtnRight]}
                onPress={() => goTo(safeIndex + 1)}
                hitSlop={8}
              >
                <Ionicons name="chevron-forward" size={20} color="#fff" />
              </Pressable>
            </>
          ) : null}

          <Pressable
            style={styles.fullscreenChip}
            onPress={() => setFullscreen(true)}
            hitSlop={6}
          >
            <Ionicons name="expand-outline" size={14} color="#fff" />
            <Text style={styles.fullscreenChipText}>Tam ekran</Text>
          </Pressable>

          {urls.length > 1 ? (
            <View style={styles.counter}>
              <Text style={styles.counterText}>
                {safeIndex + 1}/{urls.length}
              </Text>
            </View>
          ) : null}
        </View>

        {urls.length > 1 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.thumbRow}
          >
            {urls.map((url, index) => (
              <Pressable
                key={`${url}-${index}`}
                onPress={() => goTo(index)}
                style={[
                  styles.thumbWrap,
                  index === safeIndex && styles.thumbWrapActive,
                ]}
              >
                <Image source={{ uri: url }} style={styles.thumb} resizeMode="cover" />
              </Pressable>
            ))}
          </ScrollView>
        ) : null}
      </View>

      <FullscreenGallery
        visible={fullscreen}
        urls={urls}
        index={safeIndex}
        listRef={fullscreenRef}
        onClose={() => setFullscreen(false)}
        onIndexChange={(index) => {
          onActiveIndexChange(index);
          heroScrollRef.current?.scrollTo({ x: index * heroWidth, animated: false });
        }}
      />
    </>
  );
}

function FullscreenGallery({
  visible,
  urls,
  index,
  listRef,
  onClose,
  onIndexChange,
}: {
  visible: boolean;
  urls: string[];
  index: number;
  listRef: React.RefObject<FlatList<string> | null>;
  onClose: () => void;
  onIndexChange: (index: number) => void;
}) {
  const insets = useSafeAreaInsets();
  const { width, height } = Dimensions.get('window');
  const safeIndex = Math.min(Math.max(index, 0), Math.max(urls.length - 1, 0));

  function goTo(nextRaw: number) {
    if (urls.length === 0) {
      return;
    }
    const next = ((nextRaw % urls.length) + urls.length) % urls.length;
    onIndexChange(next);
    listRef.current?.scrollToIndex({ index: next, animated: true });
  }

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={fullscreenStyles.root}>
        <Pressable
          style={[fullscreenStyles.closeBtn, { top: insets.top + 10 }]}
          onPress={onClose}
          hitSlop={10}
        >
          <Ionicons name="close" size={22} color="#fff" />
        </Pressable>

        {urls.length > 1 ? (
          <Text style={[fullscreenStyles.counter, { top: insets.top + 16 }]}>
            {safeIndex + 1} / {urls.length}
          </Text>
        ) : null}

        <FlatList
          ref={listRef}
          data={urls}
          keyExtractor={(item, i) => `fs-${item}-${i}`}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          style={{ width, height }}
          getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
          onMomentumScrollEnd={(e) => {
            const next = Math.round(e.nativeEvent.contentOffset.x / Math.max(width, 1));
            if (next >= 0 && next < urls.length) {
              onIndexChange(next);
            }
          }}
          onScrollToIndexFailed={({ index: failedIndex }) => {
            requestAnimationFrame(() => {
              listRef.current?.scrollToIndex({ index: failedIndex, animated: false });
            });
          }}
          renderItem={({ item }) => (
            <View style={{ width, height, justifyContent: 'center' }}>
              <Image
                source={{ uri: item }}
                style={{ width, height: height * 0.72 }}
                resizeMode="contain"
              />
            </View>
          )}
        />

        {urls.length > 1 ? (
          <>
            <Pressable
              style={[fullscreenStyles.navBtn, fullscreenStyles.navLeft]}
              onPress={() => goTo(safeIndex - 1)}
            >
              <Ionicons name="chevron-back" size={28} color="#fff" />
            </Pressable>
            <Pressable
              style={[fullscreenStyles.navBtn, fullscreenStyles.navRight]}
              onPress={() => goTo(safeIndex + 1)}
            >
              <Ionicons name="chevron-forward" size={28} color="#fff" />
            </Pressable>
          </>
        ) : null}
      </View>
    </Modal>
  );
}

function createStyles(colors: ThemeColors, compact: boolean) {
  const heroHeight = compact ? 150 : 200;
  return StyleSheet.create({
    block: {
      marginBottom: compact ? 10 : 16,
      gap: 8,
    },
    heroWrap: {
      width: '100%',
      height: heroHeight,
      borderRadius: 12,
      overflow: 'hidden',
      backgroundColor: colors.chip,
    },
    heroImage: {
      height: heroHeight,
      backgroundColor: colors.chip,
    },
    navBtn: {
      position: 'absolute',
      top: '50%',
      marginTop: -18,
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: 'rgba(0,0,0,0.45)',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 2,
    },
    navBtnLeft: {
      left: 8,
    },
    navBtnRight: {
      right: 8,
    },
    fullscreenChip: {
      position: 'absolute',
      top: 8,
      right: 8,
      zIndex: 2,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 8,
      paddingVertical: 5,
      borderRadius: 999,
      backgroundColor: 'rgba(0,0,0,0.55)',
    },
    fullscreenChipText: {
      color: '#fff',
      fontSize: 11,
      fontWeight: '700',
    },
    counter: {
      position: 'absolute',
      bottom: 8,
      left: 8,
      zIndex: 2,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 999,
      backgroundColor: 'rgba(0,0,0,0.45)',
    },
    counterText: {
      color: '#fff',
      fontSize: 11,
      fontWeight: '600',
    },
    thumbRow: {
      gap: 6,
      paddingRight: 4,
    },
    thumbWrap: {
      borderRadius: 8,
      borderWidth: 2,
      borderColor: 'transparent',
      overflow: 'hidden',
    },
    thumbWrapActive: {
      borderColor: colors.accent,
    },
    thumb: {
      width: compact ? 64 : 56,
      height: compact ? 48 : 42,
      borderRadius: 6,
      backgroundColor: colors.chip,
    },
  });
}

const fullscreenStyles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.96)',
    justifyContent: 'center',
  },
  closeBtn: {
    position: 'absolute',
    right: 16,
    zIndex: 5,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  counter: {
    position: 'absolute',
    alignSelf: 'center',
    zIndex: 5,
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  navBtn: {
    position: 'absolute',
    top: '50%',
    marginTop: -28,
    width: 48,
    height: 56,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 5,
  },
  navLeft: {
    left: 10,
  },
  navRight: {
    right: 10,
  },
});
