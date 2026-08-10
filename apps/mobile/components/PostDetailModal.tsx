import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MapView, { Marker } from './AppMap';
import { PoiPhotoGallery } from './PoiPhotoGallery';

import type { ThemeColors } from '../constants/theme';
import { useThemeColors } from '../theme/ThemeProvider';
import type { Poi, Post, PostPhoto, Profile } from '../types/database';

export type FeedPostDetail = Post & {
  author: Pick<Profile, 'id' | 'full_name' | 'avatar_url'> | null;
  photos: PostPhoto[];
  poi: Pick<Poi, 'id' | 'name' | 'lat' | 'lng'> | null;
  averageRating: number | null;
  ratingCount: number;
  userScore: number | null;
};

type Props = {
  post: FeedPostDetail | null;
  visible: boolean;
  onClose: () => void;
  onOpenPoi?: (poiId: string) => void;
  onRate?: (postId: string, score: number) => void;
  ratingBusy?: boolean;
  onDelete?: (postId: string) => void;
  deleting?: boolean;
  isOwner?: boolean;
};

const SCREEN_WIDTH = Dimensions.get('window').width;

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString('az-AZ', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function PostDetailModal({
  post,
  visible,
  onClose,
  onOpenPoi,
  onRate,
  ratingBusy = false,
  onDelete,
  deleting = false,
  isOwner = false,
}: Props) {
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [showMap, setShowMap] = useState(false);

  useEffect(() => {
    setPhotoIndex(0);
    setShowMap(false);
  }, [post?.id, visible]);

  const authorName = post?.author?.full_name?.trim() || 'İstifadəçi';
  const mapLat = post?.lat ?? post?.poi?.lat ?? null;
  const mapLng = post?.lng ?? post?.poi?.lng ?? null;
  const photoUrls = (post?.photos ?? [])
    .map((p) => p.photo_url || p.url || '')
    .filter(Boolean);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <View style={styles.header}>
            <Text style={styles.title}>Paylaşım</Text>
            <Pressable onPress={onClose} hitSlop={12}>
              <Text style={styles.close}>Bağla</Text>
            </Pressable>
          </View>

          {!post ? (
            <View style={styles.centered}>
              <ActivityIndicator color={colors.accent} />
            </View>
          ) : (
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.content}
              keyboardShouldPersistTaps="handled"
            >
              <View style={styles.authorRow}>
                {post.author?.avatar_url ? (
                  <Image source={{ uri: post.author.avatar_url }} style={styles.avatar} />
                ) : (
                  <View style={styles.avatarPlaceholder}>
                    <Text style={styles.avatarInitial}>{authorName.charAt(0).toUpperCase()}</Text>
                  </View>
                )}
                <View style={styles.authorInfo}>
                  <Text style={styles.authorName}>{authorName}</Text>
                  <Text style={styles.dateText}>{formatDate(post.created_at)}</Text>
                </View>
                {isOwner && onDelete ? (
                  <Pressable onPress={() => onDelete(post.id)} disabled={deleting} hitSlop={8}>
                    {deleting ? (
                      <ActivityIndicator color={colors.danger} size="small" />
                    ) : (
                      <Text style={styles.deleteText}>Sil</Text>
                    )}
                  </Pressable>
                ) : null}
              </View>

              {photoUrls.length > 0 ? (
                <View style={styles.galleryWrap}>
                  <PoiPhotoGallery
                    urls={photoUrls}
                    activeIndex={photoIndex}
                    onActiveIndexChange={setPhotoIndex}
                  />
                </View>
              ) : (
                <View style={styles.noPhoto}>
                  <Text style={styles.noPhotoText}>Şəkil yoxdur</Text>
                </View>
              )}

              {post.caption?.trim() ? (
                <Text style={styles.caption}>{post.caption.trim()}</Text>
              ) : (
                <Text style={styles.captionMuted}>Caption yoxdur</Text>
              )}

              {post.poi ? (
                <Pressable
                  style={styles.infoRow}
                  onPress={() => onOpenPoi?.(post.poi!.id)}
                >
                  <Text style={styles.infoLabel}>Məkan</Text>
                  <Text style={styles.infoValue}>📍 {post.poi.name}</Text>
                </Pressable>
              ) : null}

              {mapLat != null && mapLng != null ? (
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Koordinat</Text>
                  <Text style={styles.infoValue}>
                    {mapLat.toFixed(5)}, {mapLng.toFixed(5)}
                  </Text>
                  <Pressable style={styles.mapBtn} onPress={() => setShowMap((v) => !v)}>
                    <Text style={styles.mapBtnText}>
                      {showMap ? 'Xəritəni gizlət' : 'Xəritədə göstər'}
                    </Text>
                  </Pressable>
                </View>
              ) : null}

              {showMap && mapLat != null && mapLng != null ? (
                <MapView
                  style={styles.map}
                  initialRegion={{
                    latitude: mapLat,
                    longitude: mapLng,
                    latitudeDelta: 0.04,
                    longitudeDelta: 0.04,
                  }}
                >
                  <Marker
                    coordinate={{ latitude: mapLat, longitude: mapLng }}
                    title={post.poi?.name ?? 'Post yeri'}
                  />
                </MapView>
              ) : null}

              <View style={styles.ratingBlock}>
                <Text style={styles.ratingLabel}>
                  ⭐{' '}
                  {post.averageRating == null
                    ? 'Reytinq yoxdur'
                    : `${post.averageRating.toFixed(1)} (${post.ratingCount})`}
                </Text>
                {onRate ? (
                  <View style={styles.starsRow}>
                    {Array.from({ length: 5 }, (_, index) => {
                      const score = index + 1;
                      const filled = (post.userScore ?? 0) >= score;
                      return (
                        <Pressable
                          key={score}
                          onPress={() => onRate(post.id, score)}
                          disabled={ratingBusy}
                          hitSlop={6}
                        >
                          <FontAwesome
                            name={filled ? 'star' : 'star-o'}
                            size={22}
                            color={colors.warning}
                          />
                        </Pressable>
                      );
                    })}
                  </View>
                ) : null}
              </View>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.45)',
      justifyContent: 'flex-end',
    },
    sheet: {
      maxHeight: '94%',
      backgroundColor: colors.surface,
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingTop: 14,
      paddingBottom: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    title: {
      fontSize: 18,
      fontWeight: '800',
      color: colors.text,
    },
    close: {
      color: colors.accent,
      fontWeight: '700',
      fontSize: 15,
    },
    centered: {
      padding: 40,
      alignItems: 'center',
    },
    content: {
      padding: 16,
      paddingBottom: 28,
      gap: 12,
    },
    authorRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    avatar: {
      width: 44,
      height: 44,
      borderRadius: 22,
    },
    avatarPlaceholder: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarInitial: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.chipText,
    },
    authorInfo: {
      flex: 1,
      minWidth: 0,
    },
    authorName: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.text,
    },
    dateText: {
      fontSize: 12,
      color: colors.textSecondary,
      marginTop: 2,
    },
    deleteText: {
      color: colors.danger,
      fontWeight: '700',
      fontSize: 13,
    },
    galleryWrap: {
      marginHorizontal: -4,
    },
    noPhoto: {
      height: 120,
      borderRadius: 12,
      backgroundColor: colors.chip,
      alignItems: 'center',
      justifyContent: 'center',
    },
    noPhotoText: {
      color: colors.textMuted,
      fontSize: 13,
    },
    caption: {
      fontSize: 15,
      lineHeight: 22,
      color: colors.text,
    },
    captionMuted: {
      fontSize: 14,
      color: colors.textMuted,
      fontStyle: 'italic',
    },
    infoRow: {
      gap: 4,
      paddingVertical: 4,
    },
    infoLabel: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.textSecondary,
      textTransform: 'uppercase',
    },
    infoValue: {
      fontSize: 14,
      color: colors.text,
      fontWeight: '600',
    },
    mapBtn: {
      alignSelf: 'flex-start',
      marginTop: 4,
    },
    mapBtnText: {
      color: colors.accent,
      fontWeight: '700',
      fontSize: 13,
    },
    map: {
      width: SCREEN_WIDTH - 32,
      height: 180,
      borderRadius: 12,
    },
    ratingBlock: {
      gap: 8,
      marginTop: 4,
    },
    ratingLabel: {
      fontSize: 13,
      color: colors.textSecondary,
      fontWeight: '600',
    },
    starsRow: {
      flexDirection: 'row',
      gap: 8,
    },
  });
}
