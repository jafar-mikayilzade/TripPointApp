import FontAwesome from '@expo/vector-icons/FontAwesome';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { REGIONS } from '../constants/regions';
import { notifyAdminsViaWhatsApp } from '../lib/adminNotify';
import { getErrorMessage } from '../lib/errors';
import {
  getCategoryColor,
  getCategoryEmoji,
  getCategoryLabel,
} from '../lib/poi';
import { supabase } from '../lib/supabase';
import { uploadImage } from '../lib/uploadImage';
import type { Poi } from '../types/database';

import { colors } from '../constants/theme';

interface PoiDetailModalProps {
  poi: Poi | null;
  visible: boolean;
  onClose: () => void;
}

const GALLERY_WIDTH = Dimensions.get('window').width - 40;
const STORAGE_BUCKET = 'poi-photos';
const MAX_IMAGES = 3;

export function PoiDetailModal({ poi, visible, onClose }: PoiDetailModalProps) {
  const [photos, setPhotos] = useState<string[]>([]);
  const [loadingPhotos, setLoadingPhotos] = useState(false);
  const [averageRating, setAverageRating] = useState<number | null>(null);
  const [ratingCount, setRatingCount] = useState(0);
  const [userScore, setUserScore] = useState<number | null>(null);
  const [loadingRating, setLoadingRating] = useState(false);
  const [submittingScore, setSubmittingScore] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!visible || !poi) {
      return;
    }

    let isActive = true;

    async function loadDetails() {
      setLoadingPhotos(true);
      setLoadingRating(true);
      setErrorMessage(null);
      setSuccessMessage(null);
      setPhotos([]);
      setAverageRating(null);
      setRatingCount(0);
      setUserScore(null);

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (isActive) {
        setCurrentUserId(user?.id ?? null);
      }

      const [photosResult, ratingsResult] = await Promise.all([
        supabase
          .from('poi_photos')
          .select('photo_url, order_index, created_at, status')
          .eq('poi_id', poi!.id)
          .eq('status', 'approved')
          .order('order_index', { ascending: true }),
        supabase.from('ratings').select('score, rater_id').eq('target_type', 'poi').eq('target_id', poi!.id),
      ]);

      if (!isActive) {
        return;
      }

      if (photosResult.error) {
        setErrorMessage(getErrorMessage(photosResult.error));
      } else {
        setPhotos((photosResult.data ?? []).map((photo) => photo.photo_url));
      }

      if (ratingsResult.error) {
        setErrorMessage(getErrorMessage(ratingsResult.error));
      } else {
        const rows = ratingsResult.data ?? [];
        setRatingCount(rows.length);
        if (rows.length === 0) {
          setAverageRating(null);
        } else {
          const sum = rows.reduce((acc, row) => acc + row.score, 0);
          setAverageRating(sum / rows.length);
        }

        if (user) {
          const mine = rows.find((row) => row.rater_id === user.id);
          setUserScore(mine?.score ?? null);
        }
      }

      setLoadingPhotos(false);
      setLoadingRating(false);
    }

    loadDetails();

    return () => {
      isActive = false;
    };
  }, [visible, poi]);

  async function openUrl(url: string) {
    setErrorMessage(null);
    try {
      const canOpen = await Linking.canOpenURL(url);
      if (!canOpen) {
        setErrorMessage('Link açıla bilmədi.');
        return;
      }
      await Linking.openURL(url);
    } catch (err) {
      setErrorMessage(getErrorMessage(err));
    }
  }

  async function handleAddPhotos() {
    if (!poi || !currentUserId || uploadingPhoto) {
      if (!currentUserId) {
        setErrorMessage('Şəkil əlavə etmək üçün daxil olun.');
      }
      return;
    }

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setErrorMessage('Şəkil seçmək üçün qalereya icazəsi lazımdır.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
      allowsMultipleSelection: true,
      selectionLimit: MAX_IMAGES,
    });

    if (result.canceled || result.assets.length === 0) {
      return;
    }

    setUploadingPhoto(true);
    setErrorMessage(null);

    try {
      const rows = [];
      for (let i = 0; i < result.assets.length; i += 1) {
        const uri = result.assets[i].uri;
        const extension = uri.split('.').pop()?.split('?')[0]?.toLowerCase() ?? 'jpg';
        const safeExt =
          extension === 'png' || extension === 'webp' || extension === 'jpeg' || extension === 'jpg'
            ? extension
            : 'jpg';
        const path = `${currentUserId}/${poi.id}-u${Date.now()}-${i}.${safeExt}`;
        const publicUrl = await uploadImage(uri, STORAGE_BUCKET, path);
        rows.push({
          poi_id: poi.id,
          photo_url: publicUrl,
          order_index: photos.length + i,
          status: 'pending' as const,
          uploaded_by: currentUserId,
        });
      }

      const { error } = await supabase.from('poi_photos').insert(rows);
      if (error) {
        setErrorMessage(getErrorMessage(error));
        return;
      }

      Alert.alert(
        'Təsdiq gözlənilir',
        'Şəkilləriniz admin təsdiqinə göndərildi. Təsdiqdən sonra burada görünəcək.',
        [
          {
            text: 'OK',
            onPress: () => {
              void notifyAdminsViaWhatsApp(
                'photo_pending',
                `"${poi.name}" üçün ${rows.length} şəkil`
              );
            },
          },
        ]
      );
      setSuccessMessage('Şəkillər təsdiq gözləyir.');
    } catch (err) {
      setErrorMessage(getErrorMessage(err));
    } finally {
      setUploadingPhoto(false);
    }
  }

  async function handleSubmitScore(score: number) {
    if (!poi || submittingScore) {
      return;
    }

    setSubmittingScore(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        setErrorMessage(userError ? getErrorMessage(userError) : 'Reytinq vermək üçün daxil olun.');
        return;
      }

      const { error } = await supabase.from('ratings').upsert(
        {
          rater_id: user.id,
          target_type: 'poi',
          target_id: poi.id,
          score,
        },
        { onConflict: 'rater_id,target_type,target_id' }
      );

      if (error) {
        setErrorMessage(getErrorMessage(error));
        return;
      }

      setUserScore(score);
      setSuccessMessage('Reytinqiniz saxlanıldı.');

      const { data: refreshed, error: refreshError } = await supabase
        .from('ratings')
        .select('score')
        .eq('target_type', 'poi')
        .eq('target_id', poi.id);

      if (!refreshError && refreshed) {
        setRatingCount(refreshed.length);
        if (refreshed.length === 0) {
          setAverageRating(null);
        } else {
          const sum = refreshed.reduce((acc, row) => acc + row.score, 0);
          setAverageRating(sum / refreshed.length);
        }
      }
    } catch (err) {
      setErrorMessage(getErrorMessage(err));
    } finally {
      setSubmittingScore(false);
    }
  }

  if (!poi) {
    return null;
  }

  const color = getCategoryColor(poi.category);
  const regionLabel =
    REGIONS.find((region) => region.id === poi.region)?.label ?? poi.region;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.sheet}>
          <Pressable onPress={onClose} style={styles.closeButton} hitSlop={12}>
            <FontAwesome name="times" size={18} color={colors.text} />
          </Pressable>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
            {loadingPhotos ? (
              <View style={styles.galleryPlaceholder}>
                <ActivityIndicator color={colors.accent} />
              </View>
            ) : photos.length > 0 ? (
              <ScrollView
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                style={styles.gallery}
              >
                {photos.map((url) => (
                  <Image key={url} source={{ uri: url }} style={styles.galleryImage} />
                ))}
              </ScrollView>
            ) : (
              <View style={[styles.galleryPlaceholder, { backgroundColor: `${color}22` }]}>
                <Text style={styles.placeholderEmoji}>{getCategoryEmoji(poi.category)}</Text>
              </View>
            )}

            <Pressable
              style={[styles.addPhotoButton, uploadingPhoto && styles.buttonDisabled]}
              onPress={() => void handleAddPhotos()}
              disabled={uploadingPhoto}
            >
              {uploadingPhoto ? (
                <ActivityIndicator color={colors.accent} />
              ) : (
                <>
                  <FontAwesome name="camera" size={14} color={colors.accent} />
                  <Text style={styles.addPhotoText}>Şəkil əlavə et (təsdiq gözləyir)</Text>
                </>
              )}
            </Pressable>

            <Text style={styles.title} numberOfLines={2} ellipsizeMode="tail">
              {poi.name}
            </Text>

            <View style={styles.metaRow}>
              <View style={[styles.categoryChip, { backgroundColor: `${color}22` }]}>
                <Text style={[styles.categoryChipText, { color }]}>
                  {getCategoryLabel(poi.category)}
                </Text>
              </View>
              <Text style={styles.regionText}>{regionLabel}</Text>
            </View>

            {loadingRating ? (
              <ActivityIndicator color={colors.accent} style={styles.inlineLoader} />
            ) : (
              <View style={styles.ratingRow}>
                <FontAwesome name="star" size={16} color="#F59E0B" />
                <Text style={styles.ratingValue}>
                  {averageRating === null ? '—' : averageRating.toFixed(1)}
                </Text>
                <Text style={styles.ratingCount}>({ratingCount} rəy)</Text>
              </View>
            )}

            <Text style={styles.description}>
              {poi.description?.trim() ? poi.description : 'Təsvir əlavə olunmayıb.'}
            </Text>

            {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}
            {successMessage ? <Text style={styles.successText}>{successMessage}</Text> : null}

            <View style={styles.actions}>
              {poi.phone ? (
                <Pressable
                  style={styles.secondaryButton}
                  onPress={() => openUrl(`tel:${poi.phone}`)}
                >
                  <FontAwesome name="phone" size={14} color={colors.accent} />
                  <Text style={styles.secondaryButtonText}>Zəng et</Text>
                </Pressable>
              ) : null}

              {poi.website ? (
                <Pressable style={styles.secondaryButton} onPress={() => openUrl(poi.website!)}>
                  <FontAwesome name="globe" size={14} color={colors.accent} />
                  <Text style={styles.secondaryButtonText}>Vebsayta get</Text>
                </Pressable>
              ) : null}

              <Pressable
                style={styles.primaryButton}
                onPress={() =>
                  openUrl(`https://maps.google.com/?q=${poi.lat},${poi.lng}`)
                }
              >
                <FontAwesome name="map" size={14} color="#fff" />
                <Text style={styles.primaryButtonText}>Google Maps-də aç</Text>
              </Pressable>
            </View>

            <Text style={styles.rateLabel}>Reytinq ver</Text>
            <View style={styles.starsRow}>
              {[1, 2, 3, 4, 5].map((score) => {
                const filled = (userScore ?? 0) >= score;
                return (
                  <Pressable
                    key={score}
                    onPress={() => handleSubmitScore(score)}
                    disabled={submittingScore}
                    hitSlop={8}
                  >
                    <FontAwesome
                      name={filled ? 'star' : 'star-o'}
                      size={28}
                      color={filled ? '#F59E0B' : colors.border}
                    />
                  </Pressable>
                );
              })}
              {submittingScore ? <ActivityIndicator color={colors.accent} /> : null}
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  sheet: {
    maxHeight: '90%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 12,
    paddingBottom: 28,
  },
  closeButton: {
    position: 'absolute',
    top: 16,
    right: 16,
    zIndex: 2,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.chip,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 80,
    flexGrow: 1,
  },
  gallery: {
    marginBottom: 16,
  },
  galleryImage: {
    width: GALLERY_WIDTH,
    height: 200,
    borderRadius: 12,
    marginRight: 8,
  },
  galleryPlaceholder: {
    height: 200,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.chip,
    marginBottom: 16,
  },
  placeholderEmoji: {
    fontSize: 48,
  },
  addPhotoButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: '#BFDBFE',
    backgroundColor: colors.accentSoft,
    borderRadius: 16,
    paddingVertical: 10,
    marginBottom: 14,
  },
  addPhotoText: {
    color: colors.accent,
    fontWeight: '700',
    fontSize: 13,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: colors.text,
    marginBottom: 10,
    paddingRight: 40,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  categoryChip: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  categoryChipText: {
    fontSize: 12,
    fontWeight: '700',
  },
  regionText: {
    fontSize: 13,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 14,
  },
  ratingValue: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  ratingCount: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  inlineLoader: {
    alignSelf: 'flex-start',
    marginBottom: 14,
  },
  description: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.chipText,
    marginBottom: 16,
  },
  actions: {
    gap: 10,
    marginBottom: 20,
  },
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: 16,
    paddingVertical: 12,
  },
  secondaryButtonText: {
    color: colors.accent,
    fontSize: 14,
    fontWeight: '600',
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.accent,
    borderRadius: 16,
    paddingVertical: 13,
  },
  primaryButtonText: {
    color: colors.textOnAccent,
    fontSize: 14,
    fontWeight: '600',
  },
  rateLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 10,
  },
  starsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  errorText: {
    color: colors.dangerText,
    fontSize: 13,
    marginBottom: 10,
  },
  successText: {
    color: colors.success,
    fontSize: 13,
    marginBottom: 10,
    fontWeight: '600',
  },
});
