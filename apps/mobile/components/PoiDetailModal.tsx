import FontAwesome from '@expo/vector-icons/FontAwesome';
import * as ImagePicker from 'expo-image-picker';
import { useMemo, useEffect, useState } from 'react';
import {
  ActivityIndicator,
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
import { CategoryIcon } from './CategoryIcon';
import { FavoriteButton } from './FavoriteButton';
import { PoiPhotoGallery } from './PoiPhotoGallery';
import { TransientHint } from './TransientHint';
import { notifyAdmins } from '../lib/adminNotify';
import { getApiBaseUrl } from '../lib/apiBase';
import { getAuthHeaders } from '../lib/authHeaders';
import { getErrorMessage } from '../lib/errors';
import { isDatabasePoiId } from '../lib/livePlaces';
import { isPoiSponsored, summarizeOpeningHours } from '../lib/openingHours';
import { getCategoryLabel } from '../lib/categoryUtils';
import {
  displayPoiDescription,
  formatPoiPrice,
  translateAmenities,
} from '../lib/poiDisplay';
import { getCategoryColor } from '../lib/poi';
import { collectPoiPhotoUrls } from '../lib/photoUrls';
import { supabase } from '../lib/supabase';
import { uploadImageVariants } from '../lib/uploadImage';
import type { Poi } from '../types/database';

import type { ThemeColors } from '../constants/theme';
import { useThemeColors } from '../theme/ThemeProvider';

interface PoiDetailModalProps {
  poi: Poi | null;
  visible: boolean;
  onClose: () => void;
  /** Live POI favoritdən sonra parent siyahıda UUID yeniləmək üçün */
  onPoiIdResolved?: (previousId: string, dbId: string) => void;
}

const GALLERY_WIDTH = Dimensions.get('window').width - 40;
const STORAGE_BUCKET = 'poi-photos';
const MAX_IMAGES = 3;

export function PoiDetailModal({
  poi,
  visible,
  onClose,
  onPoiIdResolved,
}: PoiDetailModalProps) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [photos, setPhotos] = useState<string[]>([]);
  const [activePhotoIndex, setActivePhotoIndex] = useState(0);
  const [loadingPhotos, setLoadingPhotos] = useState(false);
  const [averageRating, setAverageRating] = useState<number | null>(null);
  const [ratingCount, setRatingCount] = useState(0);
  const [loadingRating, setLoadingRating] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [infoToast, setInfoToast] = useState<string | null>(null);
  const [infoToastKey, setInfoToastKey] = useState(0);
  const [amenitiesOpen, setAmenitiesOpen] = useState(false);

  function showInfoToast(message: string) {
    setInfoToast(message);
    setInfoToastKey((key) => key + 1);
  }

  useEffect(() => {
    if (!visible) {
      setAmenitiesOpen(false);
    }
  }, [visible, poi?.id]);

  useEffect(() => {
    if (!visible || !poi) {
      return;
    }

    let isActive = true;

    async function loadDetails() {
      setLoadingPhotos(true);
      setLoadingRating(true);
      setErrorMessage(null);
      setInfoToast(null);
      setPhotos([]);
      setActivePhotoIndex(0);
      setAverageRating(null);
      setRatingCount(0);

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (isActive) {
        setCurrentUserId(user?.id ?? null);
      }

      const [photosResult, ratingsResult] = await Promise.all([
        supabase
          .from('poi_photos')
          .select('photo_url, thumb_url, medium_url, order_index, created_at, status')
          .eq('poi_id', poi!.id)
          .eq('status', 'approved')
          .order('order_index', { ascending: true }),
        supabase.from('ratings').select('score').eq('target_type', 'poi').eq('target_id', poi!.id),
      ]);

      if (!isActive) {
        return;
      }

      if (photosResult.error) {
        setErrorMessage(getErrorMessage(photosResult.error));
        const fallback = collectPoiPhotoUrls(poi!, null, 'medium');
        setPhotos(fallback);
        setActivePhotoIndex(0);
      } else {
        const next = collectPoiPhotoUrls(poi!, photosResult.data ?? [], 'medium');
        setPhotos(next);
        setActivePhotoIndex(0);
      }

      if (ratingsResult.error) {
        setErrorMessage(getErrorMessage(ratingsResult.error));
      } else {
        const rows = ratingsResult.data ?? [];
        if (rows.length === 0) {
          const external =
            typeof poi!.rating === 'number' && Number.isFinite(poi!.rating)
              ? poi!.rating
              : null;
          setAverageRating(external);
          setRatingCount(
            typeof poi!.rating_count === 'number' && Number.isFinite(poi!.rating_count)
              ? poi!.rating_count
              : 0
          );
        } else {
          const sum = rows.reduce((acc, row) => acc + row.score, 0);
          setAverageRating(sum / rows.length);
          setRatingCount(rows.length);
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
        const basePath = `${currentUserId}/${poi.id}-u${Date.now()}-${i}`;
        const variants = await uploadImageVariants(uri, STORAGE_BUCKET, basePath);
        rows.push({
          photo_url: variants.original,
          medium_url: variants.medium,
          thumb_url: variants.thumb,
          order_index: photos.length + i,
        });
      }

      const base = getApiBaseUrl();
      const headers = await getAuthHeaders();
      let insertedIds: string[] = [];
      let notifySent = 0;

      if (base && headers) {
        const res = await fetch(`${base}/api/pois/photos/pending`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            poi_id: poi.id,
            poi_name: poi.name,
            photos: rows,
          }),
        });
        const json = (await res.json().catch(() => null)) as {
          success?: boolean;
          ids?: string[];
          notify_sent?: number;
          detail?: { message?: string };
        } | null;
        if (!res.ok) {
          const { data: insertedPhotos, error } = await supabase
            .from('poi_photos')
            .insert(
              rows.map((row) => ({
                ...row,
                poi_id: poi.id,
                status: 'pending' as const,
                uploaded_by: currentUserId,
              }))
            )
            .select('id');
          if (error) {
            setErrorMessage(
              json?.detail?.message ||
                getErrorMessage(error) ||
                `Şəkillər yazılmadı (HTTP ${res.status})`
            );
            return;
          }
          insertedIds = (insertedPhotos ?? []).map((r) => r.id);
          const notify = await notifyAdmins(
            'photo_pending',
            `"${poi.name}" üçün ${rows.length} şəkil`,
            insertedIds[0]
          );
          notifySent = notify.sent ? 1 : 0;
        } else {
          insertedIds = json?.ids ?? [];
          notifySent = json?.notify_sent ?? 0;
        }
      } else {
        // Fallback: direct Supabase insert (needs INSERT RLS policy)
        const { data: insertedPhotos, error } = await supabase
          .from('poi_photos')
          .insert(
            rows.map((row) => ({
              ...row,
              poi_id: poi.id,
              status: 'pending' as const,
              uploaded_by: currentUserId,
            }))
          )
          .select('id');
        if (error) {
          setErrorMessage(getErrorMessage(error));
          return;
        }
        insertedIds = (insertedPhotos ?? []).map((r) => r.id);
        const notify = await notifyAdmins(
          'photo_pending',
          `"${poi.name}" üçün ${rows.length} şəkil`,
          insertedIds[0]
        );
        notifySent = notify.sent ? 1 : 0;
      }

      showInfoToast(
        notifySent > 0
          ? 'Şəkillər təsdiqə göndərildi'
          : 'Şəkillər gözləmədədir — admin paneldə təsdiqləyin'
      );
    } catch (err) {
      setErrorMessage(getErrorMessage(err));
    } finally {
      setUploadingPhoto(false);
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
          <View style={styles.sheetHeader}>
            <FavoriteButton
              targetType="poi"
              targetId={poi.id}
              liveSeed={
                isDatabasePoiId(poi.id)
                  ? null
                  : {
                      place_id: poi.place_id || poi.id,
                      name: poi.name,
                      lat: poi.lat,
                      lng: poi.lng,
                      category: poi.category,
                      region: poi.region,
                      rating: poi.rating,
                      rating_count: poi.rating_count,
                    }
              }
              onResolvedId={(dbId) => {
                if (dbId !== poi.id) {
                  onPoiIdResolved?.(poi.id, dbId);
                }
              }}
            />
            <Pressable onPress={onClose} style={styles.closeButton} hitSlop={12}>
              <FontAwesome name="times" size={18} color={colors.text} />
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
            {loadingPhotos ? (
              <View style={styles.galleryPlaceholder}>
                <ActivityIndicator color={colors.accent} />
              </View>
            ) : photos.length > 0 ? (
              <PoiPhotoGallery
                urls={photos}
                activeIndex={activePhotoIndex}
                onActiveIndexChange={setActivePhotoIndex}
              />
            ) : (
              <View style={[styles.galleryPlaceholder, { backgroundColor: `${color}22` }]}>
                <CategoryIcon category={poi.category} size={36} color={color} />
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

            <View style={styles.titleRow}>
              <Text style={styles.title} numberOfLines={2} ellipsizeMode="tail">
                {poi.name}
              </Text>
              {isPoiSponsored(poi) ? (
                <View style={styles.sponsorChip}>
                  <Text style={styles.sponsorChipText}>Sponsor</Text>
                </View>
              ) : null}
            </View>

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
                <FontAwesome name="star" size={16} color={colors.warning} />
                <Text style={styles.ratingValue}>
                  {averageRating === null ? '—' : averageRating.toFixed(1)}
                </Text>
                <Text style={styles.ratingCount}>({ratingCount} rəy)</Text>
              </View>
            )}

            {(() => {
              const priceLabel = formatPoiPrice(poi.price_from, poi.price_currency);
              if (!priceLabel) return null;
              return (
                <View style={styles.priceRow}>
                  <Text style={styles.priceLabel}>Qiymət</Text>
                  <Text style={styles.priceValue}>{priceLabel}</Text>
                </View>
              );
            })()}

            {poi.hotel_class ? (
              <Text style={styles.hotelClassText}>
                {'★'.repeat(Math.min(5, poi.hotel_class))} · {poi.hotel_class} ulduzlu
              </Text>
            ) : null}

            <Text style={styles.description}>
              {displayPoiDescription(poi.description) ?? 'Təsvir əlavə olunmayıb.'}
            </Text>

            {(() => {
              const amenities = translateAmenities(poi.amenities);
              if (amenities.length === 0) return null;
              return (
                <View style={styles.amenitiesBlock}>
                  <Pressable
                    style={styles.amenitiesToggle}
                    onPress={() => setAmenitiesOpen((v) => !v)}
                  >
                    <Text style={styles.amenitiesToggleText}>
                      İmkanlar ({amenities.length})
                    </Text>
                    <Text style={styles.amenitiesCaret}>{amenitiesOpen ? '▴' : '▾'}</Text>
                  </Pressable>
                  {amenitiesOpen ? (
                    <View style={styles.amenitiesList}>
                      {amenities.map((item) => (
                        <Text key={item} style={styles.amenityItem}>
                          · {item}
                        </Text>
                      ))}
                    </View>
                  ) : null}
                </View>
              );
            })()}

            {(() => {
              const hours = summarizeOpeningHours(poi.opening_hours);
              if (!hours) {
                return null;
              }
              return (
                <View style={styles.hoursBlock}>
                  <Text
                    style={[
                      styles.hoursStatus,
                      hours.status === 'open'
                        ? styles.hoursOpen
                        : hours.status === 'closed'
                          ? styles.hoursClosed
                          : null,
                    ]}
                  >
                    {hours.label}
                  </Text>
                  <Text style={styles.hoursText}>{hours.detail}</Text>
                </View>
              );
            })()}

            {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}

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
                <FontAwesome name="map" size={14} color={colors.textOnAccent} />
                <Text style={styles.primaryButtonText}>Google Maps-də aç</Text>
              </Pressable>
            </View>
          </ScrollView>

          <View style={styles.toastHost} pointerEvents="none">
            <TransientHint
              key={infoToastKey}
              message={infoToast ?? ''}
              active={!!infoToast}
              onHidden={() => setInfoToast(null)}
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
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
    position: 'relative',
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.chip,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetHeader: {
    position: 'absolute',
    top: 16,
    right: 16,
    zIndex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 80,
    flexGrow: 1,
  },
  gallery: {
    marginBottom: 8,
  },
  galleryBlock: {
    marginBottom: 16,
    gap: 8,
  },
  galleryHero: {
    width: GALLERY_WIDTH,
    height: 200,
    borderRadius: 12,
    backgroundColor: colors.chip,
  },
  galleryImage: {
    width: GALLERY_WIDTH,
    height: 200,
    borderRadius: 12,
    marginRight: 8,
  },
  galleryThumbRow: {
    gap: 6,
    paddingTop: 2,
  },
  galleryThumbWrap: {
    borderRadius: 8,
    borderWidth: 2,
    borderColor: 'transparent',
    overflow: 'hidden',
  },
  galleryThumbWrapActive: {
    borderColor: colors.accent,
  },
  galleryThumb: {
    width: 56,
    height: 42,
    borderRadius: 6,
    backgroundColor: colors.chip,
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
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 10,
    paddingRight: 40,
  },
  title: {
    flex: 1,
    fontSize: 24,
    fontWeight: '800',
    color: colors.text,
  },
  sponsorChip: {
    marginTop: 4,
    backgroundColor: colors.warningSoft,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  sponsorChipText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.warning,
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
  priceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: colors.accentSoft,
  },
  priceLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  priceValue: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.accent,
  },
  hotelClassText: {
    marginBottom: 10,
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  amenitiesBlock: {
    marginBottom: 16,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSoft,
    overflow: 'hidden',
  },
  amenitiesToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: colors.surface,
  },
  amenitiesToggleText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  amenitiesCaret: {
    fontSize: 14,
    color: colors.textSecondary,
    fontWeight: '700',
  },
  amenitiesList: {
    paddingHorizontal: 12,
    paddingBottom: 12,
    gap: 4,
    backgroundColor: colors.bg,
  },
  amenityItem: {
    fontSize: 13,
    color: colors.chipText,
    lineHeight: 20,
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
  hoursBlock: {
    marginBottom: 16,
    marginTop: -8,
    gap: 4,
  },
  hoursStatus: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  hoursOpen: {
    color: colors.success,
  },
  hoursClosed: {
    color: colors.danger,
  },
  hoursText: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.textMuted,
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
  errorText: {
    color: colors.dangerText,
    fontSize: 13,
    marginBottom: 10,
  },
  toastHost: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 24,
    alignItems: 'center',
  },
});
}
