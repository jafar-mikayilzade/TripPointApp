import FontAwesome from '@expo/vector-icons/FontAwesome';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { getErrorMessage } from '../lib/errors';
import { supabase } from '../lib/supabase';
import { uploadImage } from '../lib/uploadImage';
import type { Poi, TravelPrivacy } from '../types/database';
import { SimpleDateTimeField } from './SimpleDateTimeField';

interface AddTravelHistoryModalProps {
  visible: boolean;
  onClose: () => void;
  onCreated: () => void;
}

type PickedImage = {
  uri: string;
  lat: number | null;
  lng: number | null;
};

const STORAGE_BUCKET = 'travel-photos';
const MAX_IMAGES = 5;
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

export function AddTravelHistoryModal({ visible, onClose, onCreated }: AddTravelHistoryModalProps) {
  const [title, setTitle] = useState('');
  const [visitedAt, setVisitedAt] = useState(new Date());
  const [notes, setNotes] = useState('');
  const [privacy, setPrivacy] = useState<TravelPrivacy>('public');
  const [poiQuery, setPoiQuery] = useState('');
  const [poiResults, setPoiResults] = useState<Pick<Poi, 'id' | 'name' | 'region'>[]>([]);
  const [selectedPoi, setSelectedPoi] = useState<Pick<Poi, 'id' | 'name' | 'region'> | null>(null);
  const [searchingPois, setSearchingPois] = useState(false);
  const [images, setImages] = useState<PickedImage[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) {
      return;
    }

    setTitle('');
    setVisitedAt(new Date());
    setNotes('');
    setPrivacy('public');
    setPoiQuery('');
    setPoiResults([]);
    setSelectedPoi(null);
    setImages([]);
    setLoading(false);
    setErrorMessage(null);
  }, [visible]);

  useEffect(() => {
    if (!visible) {
      return;
    }

    const query = poiQuery.trim();
    if (query.length < 2) {
      setPoiResults([]);
      return;
    }

    let isActive = true;
    const timer = setTimeout(async () => {
      setSearchingPois(true);
      const { data, error } = await supabase
        .from('pois')
        .select('id, name, region')
        .eq('status', 'approved')
        .ilike('name', `%${query}%`)
        .order('name')
        .limit(12);

      if (!isActive) {
        return;
      }

      if (error) {
        setErrorMessage(getErrorMessage(error));
        setPoiResults([]);
      } else {
        setPoiResults(data ?? []);
      }
      setSearchingPois(false);
    }, 350);

    return () => {
      isActive = false;
      clearTimeout(timer);
    };
  }, [poiQuery, visible]);

  async function handlePickImages() {
    setErrorMessage(null);

    if (images.length >= MAX_IMAGES) {
      setErrorMessage(`Maksimum ${MAX_IMAGES} şəkil əlavə edilə bilər.`);
      return;
    }

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setErrorMessage('Şəkil seçmək üçün qalereya icazəsi lazımdır.');
      return;
    }

    const remaining = MAX_IMAGES - images.length;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
      allowsMultipleSelection: true,
      selectionLimit: remaining,
      exif: true,
    });

    if (result.canceled || result.assets.length === 0) {
      return;
    }

    let fallbackLat: number | null = null;
    let fallbackLng: number | null = null;

    try {
      const locationPermission = await Location.requestForegroundPermissionsAsync();
      if (locationPermission.granted) {
        const current = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        fallbackLat = current.coords.latitude;
        fallbackLng = current.coords.longitude;
      }
    } catch {
      // Koordinat alınmasa şəkillər yenə də əlavə olunur
    }

    const nextImages: PickedImage[] = result.assets.map((asset) => {
      const exif = asset.exif as Record<string, unknown> | null | undefined;
      const exifLat = typeof exif?.GPSLatitude === 'number' ? exif.GPSLatitude : null;
      const exifLng = typeof exif?.GPSLongitude === 'number' ? exif.GPSLongitude : null;

      return {
        uri: asset.uri,
        lat: exifLat ?? fallbackLat,
        lng: exifLng ?? fallbackLng,
      };
    });

    setImages((current) => [...current, ...nextImages].slice(0, MAX_IMAGES));
  }

  function removeImage(uri: string) {
    setImages((current) => current.filter((item) => item.uri !== uri));
  }

  async function handleSubmit() {
    setErrorMessage(null);

    if (!title.trim()) {
      setErrorMessage('Başlıq məcburidir.');
      return;
    }

    setLoading(true);

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        setErrorMessage(userError ? getErrorMessage(userError) : 'Daxil olmaq lazımdır.');
        return;
      }

      const visitedDate = new Date(visitedAt);
      visitedDate.setHours(12, 0, 0, 0);

      const { data: travel, error: insertError } = await supabase
        .from('travel_history')
        .insert({
          user_id: user.id,
          poi_id: selectedPoi?.id ?? null,
          title: title.trim(),
          notes: notes.trim() || null,
          visited_at: visitedDate.toISOString(),
          privacy,
        })
        .select('id')
        .single();

      if (insertError || !travel) {
        setErrorMessage(insertError ? getErrorMessage(insertError) : 'Səyahət əlavə edilmədi.');
        return;
      }

      if (images.length > 0) {
        const photoRows = [];

        for (let i = 0; i < images.length; i += 1) {
          const image = images[i];
          const extension = image.uri.split('.').pop()?.split('?')[0]?.toLowerCase() ?? 'jpg';
          const safeExt =
            extension === 'png' || extension === 'webp' || extension === 'jpeg' || extension === 'jpg'
              ? extension
              : 'jpg';
          const path = `${user.id}/${travel.id}-${i}.${safeExt}`;
          const publicUrl = await uploadImage(image.uri, STORAGE_BUCKET, path);
          photoRows.push({
            history_id: travel.id,
            photo_url: publicUrl,
            lat: image.lat,
            lng: image.lng,
            order_index: i + 1,
          });
        }

        const { error: photosError } = await supabase
          .from('travel_history_photos')
          .insert(photoRows);

        if (photosError) {
          setErrorMessage(`Səyahət yaradıldı, amma şəkillər yazılmadı: ${getErrorMessage(photosError)}`);
          onCreated();
          onClose();
          return;
        }
      }

      onCreated();
      onClose();
    } catch (err) {
      setErrorMessage(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  const minDate = new Date(Date.now() - YEAR_MS);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Səyahət əlavə et</Text>
            <Pressable onPress={onClose} hitSlop={12}>
              <Text style={styles.closeText}>Bağla</Text>
            </Pressable>
          </View>

          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.content}
          >
            {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}

            <Text style={styles.label}>
              Başlıq <Text style={styles.required}>*</Text>
            </Text>
            <TextInput
              style={styles.input}
              value={title}
              onChangeText={setTitle}
              placeholder="Quba-Qusar səfəri"
              placeholderTextColor="#9CA3AF"
            />

            <Text style={styles.label}>
              Tarix <Text style={styles.required}>*</Text>
            </Text>
            <SimpleDateTimeField
              value={visitedAt}
              onChange={setVisitedAt}
              mode="date"
              minimumDate={minDate}
              maximumDate={new Date()}
            />

            <Text style={styles.label}>Yer seç (istəyə bağlı)</Text>
            {selectedPoi ? (
              <View style={styles.selectedPoi}>
                <Text style={styles.selectedPoiText}>{selectedPoi.name}</Text>
                <Pressable onPress={() => setSelectedPoi(null)} hitSlop={8}>
                  <Text style={styles.clearPoi}>Sil</Text>
                </Pressable>
              </View>
            ) : (
              <>
                <TextInput
                  style={styles.input}
                  value={poiQuery}
                  onChangeText={setPoiQuery}
                  placeholder="POI axtar..."
                  placeholderTextColor="#9CA3AF"
                />
                {searchingPois ? <ActivityIndicator color="#2563EB" style={{ marginTop: 8 }} /> : null}
                {poiResults.map((poi) => (
                  <Pressable
                    key={poi.id}
                    style={styles.poiRow}
                    onPress={() => {
                      setSelectedPoi(poi);
                      setPoiQuery('');
                      setPoiResults([]);
                    }}
                  >
                    <Text style={styles.poiName}>{poi.name}</Text>
                    <Text style={styles.poiRegion}>{poi.region}</Text>
                  </Pressable>
                ))}
              </>
            )}

            <Text style={styles.label}>Qeydlər</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              value={notes}
              onChangeText={setNotes}
              placeholder="Səyahət haqqında qeydlər..."
              placeholderTextColor="#9CA3AF"
              multiline
              textAlignVertical="top"
            />

            <Text style={styles.label}>Şəkillər (max {MAX_IMAGES})</Text>
            <Pressable style={styles.imageButton} onPress={handlePickImages}>
              <FontAwesome name="camera" size={14} color="#2563EB" />
              <Text style={styles.imageButtonText}>Şəkil əlavə et</Text>
            </Pressable>
            {images.length > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.imageRow}>
                {images.map((image) => (
                  <View key={image.uri} style={styles.imageWrap}>
                    <Image source={{ uri: image.uri }} style={styles.preview} />
                    <Pressable style={styles.removeImage} onPress={() => removeImage(image.uri)}>
                      <FontAwesome name="times" size={12} color="#fff" />
                    </Pressable>
                  </View>
                ))}
              </ScrollView>
            ) : null}

            <Text style={styles.label}>Gizlilik</Text>
            <View style={styles.privacyRow}>
              <Pressable
                style={[styles.privacyChip, privacy === 'public' && styles.privacySelected]}
                onPress={() => setPrivacy('public')}
              >
                <Text
                  style={[styles.privacyText, privacy === 'public' && styles.privacyTextSelected]}
                >
                  🌍 Hamıya açıq
                </Text>
              </Pressable>
              <Pressable
                style={[styles.privacyChip, privacy === 'private' && styles.privacySelected]}
                onPress={() => setPrivacy('private')}
              >
                <Text
                  style={[styles.privacyText, privacy === 'private' && styles.privacyTextSelected]}
                >
                  🔒 Yalnız mən
                </Text>
              </Pressable>
            </View>

            <Pressable
              style={[styles.submitButton, loading && styles.submitDisabled]}
              onPress={handleSubmit}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.submitText}>Göndər</Text>
              )}
            </Pressable>
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
    maxHeight: '92%',
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
  },
  closeText: {
    color: '#2563EB',
    fontWeight: '600',
  },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 80,
    flexGrow: 1,
  },
  label: {
    marginTop: 14,
    marginBottom: 6,
    fontSize: 13,
    fontWeight: '700',
    color: '#374151',
  },
  required: {
    color: '#DC2626',
  },
  input: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 15,
    color: '#111827',
  },
  textArea: {
    minHeight: 90,
  },
  selectedPoi: {
    borderWidth: 1,
    borderColor: '#2563EB',
    backgroundColor: '#EFF6FF',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  selectedPoiText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111827',
    flex: 1,
  },
  clearPoi: {
    color: '#DC2626',
    fontWeight: '700',
  },
  poiRow: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 8,
  },
  poiName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
  },
  poiRegion: {
    marginTop: 2,
    fontSize: 12,
    color: '#6B7280',
  },
  imageButton: {
    borderWidth: 1,
    borderColor: '#BFDBFE',
    backgroundColor: '#EFF6FF',
    borderRadius: 10,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  imageButtonText: {
    color: '#2563EB',
    fontWeight: '700',
  },
  imageRow: {
    marginTop: 10,
  },
  imageWrap: {
    marginRight: 10,
    position: 'relative',
  },
  preview: {
    width: 84,
    height: 84,
    borderRadius: 10,
  },
  removeImage: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  privacyRow: {
    flexDirection: 'row',
    gap: 8,
  },
  privacyChip: {
    flex: 1,
    borderRadius: 10,
    backgroundColor: '#F3F4F6',
    paddingVertical: 12,
    alignItems: 'center',
  },
  privacySelected: {
    backgroundColor: '#111827',
  },
  privacyText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#374151',
  },
  privacyTextSelected: {
    color: '#fff',
  },
  submitButton: {
    marginTop: 20,
    marginBottom: 20,
    backgroundColor: '#2563EB',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  submitDisabled: {
    opacity: 0.6,
  },
  submitText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
  },
  errorText: {
    backgroundColor: '#FEE2E2',
    color: '#B91C1C',
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
    fontSize: 13,
  },
});
