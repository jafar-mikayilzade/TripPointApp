import FontAwesome from '@expo/vector-icons/FontAwesome';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
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
import MapView, { Marker } from '../components/AppMap';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PoiDetailModal } from '../components/PoiDetailModal';
import { getErrorMessage } from '../lib/errors';
import { supabase } from '../lib/supabase';
import { confirmDelete, deletePost } from '../lib/userContentDelete';
import { uploadImage } from '../lib/uploadImage';
import type { Poi, Post, PostPhoto, Profile } from '../types/database';

import { colors } from '../constants/theme';

type FeedPost = Post & {
  author: Pick<Profile, 'id' | 'full_name' | 'avatar_url'> | null;
  photos: PostPhoto[];
  poi: Pick<Poi, 'id' | 'name' | 'lat' | 'lng'> | null;
  averageRating: number | null;
  ratingCount: number;
  userScore: number | null;
};

const SCREEN_WIDTH = Dimensions.get('window').width;
const PHOTO_WIDTH = SCREEN_WIDTH - 32;
const STORAGE_BUCKET = 'post-photos';
const MAX_IMAGES = 5;

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString('az-AZ', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function FeedScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [shareVisible, setShareVisible] = useState(false);
  const [caption, setCaption] = useState('');
  const [imageUris, setImageUris] = useState<string[]>([]);
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [selectedPoi, setSelectedPoi] = useState<Pick<Poi, 'id' | 'name' | 'lat' | 'lng'> | null>(
    null
  );
  const [poiQuery, setPoiQuery] = useState('');
  const [poiResults, setPoiResults] = useState<Pick<Poi, 'id' | 'name' | 'lat' | 'lng'>[]>([]);
  const [searchingPois, setSearchingPois] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);

  const [detailPoi, setDetailPoi] = useState<Poi | null>(null);
  const [detailVisible, setDetailVisible] = useState(false);
  const [mapPost, setMapPost] = useState<FeedPost | null>(null);
  const [ratingBusyId, setRatingBusyId] = useState<string | null>(null);
  const [authUserId, setAuthUserId] = useState<string | null>(null);
  const [deletingPostId, setDeletingPostId] = useState<string | null>(null);

  const fetchPosts = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setErrorMessage(null);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    setAuthUserId(user?.id ?? null);

    const { data: postRows, error: postsError } = await supabase
      .from('posts')
      .select('*')
      .order('created_at', { ascending: false });

    if (postsError) {
      setErrorMessage(getErrorMessage(postsError));
      setPosts([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const rows = postRows ?? [];
    if (rows.length === 0) {
      setPosts([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const postIds = rows.map((row) => row.id);
    const userIds = [...new Set(rows.map((row) => row.user_id))];
    const poiIds = [...new Set(rows.map((row) => row.poi_id).filter(Boolean))] as string[];

    const [profilesResult, photosResult, poisResult, ratingsResult] = await Promise.all([
      supabase.from('profiles').select('id, full_name, avatar_url').in('id', userIds),
      supabase
        .from('post_photos')
        .select('*')
        .in('post_id', postIds)
        .order('sort_order', { ascending: true }),
      poiIds.length > 0
        ? supabase.from('pois').select('id, name, lat, lng').in('id', poiIds)
        : Promise.resolve({ data: [] as Pick<Poi, 'id' | 'name' | 'lat' | 'lng'>[], error: null }),
      supabase
        .from('ratings')
        .select('target_id, score, rater_id')
        .eq('target_type', 'post')
        .in('target_id', postIds),
    ]);

    if (profilesResult.error) {
      setErrorMessage(getErrorMessage(profilesResult.error));
    }
    if (photosResult.error) {
      setErrorMessage(getErrorMessage(photosResult.error));
    }
    if (poisResult.error) {
      setErrorMessage(getErrorMessage(poisResult.error));
    }
    if (ratingsResult.error) {
      setErrorMessage(getErrorMessage(ratingsResult.error));
    }

    const profileMap = new Map((profilesResult.data ?? []).map((item) => [item.id, item]));
    const poiMap = new Map((poisResult.data ?? []).map((item) => [item.id, item]));
    const photosByPost = new Map<string, PostPhoto[]>();
    for (const photo of photosResult.data ?? []) {
      const list = photosByPost.get(photo.post_id) ?? [];
      list.push(photo);
      photosByPost.set(photo.post_id, list);
    }

    const ratingAgg = new Map<string, { sum: number; count: number; userScore: number | null }>();
    for (const rating of ratingsResult.data ?? []) {
      const current = ratingAgg.get(rating.target_id) ?? { sum: 0, count: 0, userScore: null };
      current.sum += rating.score;
      current.count += 1;
      if (user && rating.rater_id === user.id) {
        current.userScore = rating.score;
      }
      ratingAgg.set(rating.target_id, current);
    }

    setPosts(
      rows.map((row) => {
        const agg = ratingAgg.get(row.id);
        return {
          ...row,
          author: profileMap.get(row.user_id) ?? null,
          photos: photosByPost.get(row.id) ?? [],
          poi: row.poi_id ? (poiMap.get(row.poi_id) ?? null) : null,
          averageRating: agg && agg.count > 0 ? agg.sum / agg.count : null,
          ratingCount: agg?.count ?? 0,
          userScore: agg?.userScore ?? null,
        };
      })
    );
    setLoading(false);
    setRefreshing(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchPosts();
    }, [fetchPosts])
  );

  useEffect(() => {
    if (!shareVisible) {
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
        .select('id, name, lat, lng')
        .eq('status', 'approved')
        .ilike('name', `%${query}%`)
        .order('name')
        .limit(12);

      if (!isActive) {
        return;
      }

      if (error) {
        setShareError(getErrorMessage(error));
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
  }, [poiQuery, shareVisible]);

  function openShareModal() {
    setCaption('');
    setImageUris([]);
    setLat(null);
    setLng(null);
    setSelectedPoi(null);
    setPoiQuery('');
    setPoiResults([]);
    setShareError(null);
    setShareVisible(true);
  }

  async function handlePickImages() {
    setShareError(null);
    if (imageUris.length >= MAX_IMAGES) {
      setShareError(`Maksimum ${MAX_IMAGES} şəkil əlavə edilə bilər.`);
      return;
    }

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setShareError('Şəkil seçmək üçün qalereya icazəsi lazımdır.');
      return;
    }

    const remaining = MAX_IMAGES - imageUris.length;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
      allowsMultipleSelection: true,
      selectionLimit: remaining,
    });

    if (!result.canceled && result.assets.length > 0) {
      setImageUris((current) =>
        [...current, ...result.assets.map((asset) => asset.uri)].slice(0, MAX_IMAGES)
      );
    }
  }

  async function useCurrentLocation() {
    setShareError(null);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        setShareError('Lokasiya icazəsi lazımdır.');
        return;
      }
      const current = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setLat(current.coords.latitude);
      setLng(current.coords.longitude);
      setSelectedPoi(null);
    } catch (err) {
      setShareError(getErrorMessage(err));
    }
  }

  async function handleShare() {
    setShareError(null);

    if (!caption.trim() && imageUris.length === 0) {
      setShareError('Caption və ya şəkil əlavə edin.');
      return;
    }

    setSharing(true);

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        setShareError(userError ? getErrorMessage(userError) : 'Daxil olmaq lazımdır.');
        return;
      }

      const { data: post, error: insertError } = await supabase
        .from('posts')
        .insert({
          user_id: user.id,
          caption: caption.trim() || '',
          poi_id: selectedPoi?.id ?? null,
          lat: selectedPoi?.lat ?? lat,
          lng: selectedPoi?.lng ?? lng,
        })
        .select('id')
        .single();

      if (insertError || !post) {
        setShareError(insertError ? getErrorMessage(insertError) : 'Post yaradılmadı.');
        return;
      }

      if (imageUris.length > 0) {
        const photoRows = [];
        for (let i = 0; i < imageUris.length; i += 1) {
          const extension = imageUris[i].split('.').pop()?.split('?')[0]?.toLowerCase() ?? 'jpg';
          const safeExt =
            extension === 'png' || extension === 'webp' || extension === 'jpeg' || extension === 'jpg'
              ? extension
              : 'jpg';
          const path = `${user.id}/${post.id}-${i}.${safeExt}`;
          const url = await uploadImage(imageUris[i], STORAGE_BUCKET, path);
          photoRows.push({
            post_id: post.id,
            url,
            sort_order: i + 1,
          });
        }

        const { error: photosError } = await supabase.from('post_photos').insert(photoRows);
        if (photosError) {
          setShareError(`Post yaradıldı, amma şəkillər yazılmadı: ${getErrorMessage(photosError)}`);
          setShareVisible(false);
          await fetchPosts(true);
          return;
        }
      }

      setShareVisible(false);
      await fetchPosts(true);
    } catch (err) {
      setShareError(getErrorMessage(err));
    } finally {
      setSharing(false);
    }
  }

  async function openPoiDetail(poiId: string) {
    const { data, error } = await supabase.from('pois').select('*').eq('id', poiId).maybeSingle();
    if (error) {
      setErrorMessage(getErrorMessage(error));
      return;
    }
    if (!data) {
      setErrorMessage('Yer tapılmadı.');
      return;
    }
    setDetailPoi(data);
    setDetailVisible(true);
  }

  async function submitPostRating(postId: string, score: number) {
    if (ratingBusyId) {
      return;
    }

    setRatingBusyId(postId);
    setErrorMessage(null);

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      setErrorMessage(userError ? getErrorMessage(userError) : 'Reytinq vermək üçün daxil olun.');
      setRatingBusyId(null);
      return;
    }

    const { error } = await supabase.from('ratings').upsert(
      {
        rater_id: user.id,
        target_type: 'post',
        target_id: postId,
        score,
      },
      { onConflict: 'rater_id,target_type,target_id' }
    );

    if (error) {
      setErrorMessage(getErrorMessage(error));
      setRatingBusyId(null);
      return;
    }

    const { data: refreshed, error: refreshError } = await supabase
      .from('ratings')
      .select('score, rater_id')
      .eq('target_type', 'post')
      .eq('target_id', postId);

    if (!refreshError && refreshed) {
      const sum = refreshed.reduce((acc, row) => acc + row.score, 0);
      const mine = refreshed.find((row) => row.rater_id === user.id)?.score ?? score;
      setPosts((current) =>
        current.map((item) =>
          item.id === postId
            ? {
                ...item,
                averageRating: refreshed.length > 0 ? sum / refreshed.length : null,
                ratingCount: refreshed.length,
                userScore: mine,
              }
            : item
        )
      );
    }

    setRatingBusyId(null);
  }

  async function handleDeletePost(postId: string) {
    if (deletingPostId) {
      return;
    }

    const confirmed = await confirmDelete(
      'Postu sil',
      'Bu postu silmək istədiyinizə əminsiniz?'
    );
    if (!confirmed) {
      return;
    }

    setDeletingPostId(postId);
    setErrorMessage(null);
    const { error } = await deletePost(postId);
    setDeletingPostId(null);

    if (error) {
      setErrorMessage(error);
      return;
    }

    await fetchPosts(true);
  }

  function renderPost({ item }: { item: FeedPost }) {
    const authorName = item.author?.full_name?.trim() || 'İstifadəçi';
    const mapLat = item.lat ?? item.poi?.lat ?? null;
    const mapLng = item.lng ?? item.poi?.lng ?? null;
    const isOwner = !!authUserId && item.user_id === authUserId;

    return (
      <View style={styles.card}>
        <View style={styles.authorRow}>
          {item.author?.avatar_url ? (
            <Image source={{ uri: item.author.avatar_url }} style={styles.avatar} />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <Text style={styles.avatarInitial}>{authorName.charAt(0).toUpperCase()}</Text>
            </View>
          )}
          <View style={styles.authorInfo}>
            <Text style={styles.authorName}>{authorName}</Text>
            <Text style={styles.dateText}>{formatDate(item.created_at)}</Text>
          </View>
          {isOwner ? (
            <Pressable
              onPress={() => handleDeletePost(item.id)}
              disabled={deletingPostId === item.id}
              hitSlop={8}
            >
              {deletingPostId === item.id ? (
                <ActivityIndicator color={colors.danger} size="small" />
              ) : (
                <Text style={styles.deleteText}>Sil</Text>
              )}
            </Pressable>
          ) : null}
        </View>

        {item.photos.length > 0 ? (
          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            style={styles.photoScroll}
          >
            {item.photos.map((photo) => (
              <Image key={photo.id} source={{ uri: photo.url }} style={styles.postPhoto} />
            ))}
          </ScrollView>
        ) : null}

        {item.caption?.trim() ? (
          <Text style={styles.caption} numberOfLines={2} ellipsizeMode="tail">
            {item.caption.trim()}
          </Text>
        ) : null}

        {item.poi ? (
          <Pressable onPress={() => openPoiDetail(item.poi!.id)}>
            <Text style={styles.poiLink}>📍 {item.poi.name}</Text>
          </Pressable>
        ) : null}

        {mapLat != null && mapLng != null ? (
          <Pressable style={styles.mapLink} onPress={() => setMapPost(item)}>
            <Text style={styles.mapLinkText}>🗺 Xəritədə göstər</Text>
          </Pressable>
        ) : null}

        <View style={styles.ratingBlock}>
          <Text style={styles.ratingLabel}>
            ⭐{' '}
            {item.averageRating == null
              ? 'Reytinq yoxdur'
              : `${item.averageRating.toFixed(1)} (${item.ratingCount})`}
          </Text>
          <View style={styles.starsRow}>
            {Array.from({ length: 5 }, (_, index) => {
              const score = index + 1;
              const filled = (item.userScore ?? 0) >= score;
              return (
                <Pressable
                  key={score}
                  onPress={() => submitPostRating(item.id, score)}
                  disabled={ratingBusyId === item.id}
                  hitSlop={6}
                >
                  <FontAwesome
                    name={filled ? 'star' : 'star-o'}
                    size={18}
                    color="#F59E0B"
                  />
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 64 : 0}
    >
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable style={styles.backButton} onPress={() => router.back()} hitSlop={8}>
          <FontAwesome name="chevron-left" size={14} color={colors.accent} />
          <Text style={styles.backText}>Geri</Text>
        </Pressable>
        <Pressable style={styles.shareButton} onPress={openShareModal}>
          <Text style={styles.shareButtonText}>📷 Paylaş</Text>
        </Pressable>
      </View>

      <Text style={styles.title}>Sosial Feed</Text>
      {errorMessage ? <Text style={styles.errorBanner}>{errorMessage}</Text> : null}

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      ) : (
        <FlatList
          data={posts}
          keyExtractor={(item) => item.id}
          style={{ flex: 1 }}
          renderItem={renderPost}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshing={refreshing}
          onRefresh={() => fetchPosts(true)}
          ListEmptyComponent={<Text style={styles.emptyText}>Hələ post yoxdur</Text>}
        />
      )}

      <Modal
        visible={shareVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setShareVisible(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Paylaş</Text>
              <Pressable onPress={() => setShareVisible(false)} hitSlop={12}>
                <Text style={styles.closeText}>Bağla</Text>
              </Pressable>
            </View>

            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.modalContent}
            >
              {shareError ? <Text style={styles.errorBanner}>{shareError}</Text> : null}

              <Pressable style={styles.imagePickButton} onPress={handlePickImages}>
                <FontAwesome name="camera" size={14} color={colors.accent} />
                <Text style={styles.imagePickText}>Şəkil seç (max {MAX_IMAGES})</Text>
              </Pressable>

              {imageUris.length > 0 ? (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ paddingHorizontal: 16 }}
                >
                  {imageUris.map((uri) => (
                    <View key={uri} style={styles.previewWrap}>
                      <Image source={{ uri }} style={styles.preview} />
                      <Pressable
                        style={styles.removePreview}
                        onPress={() => setImageUris((current) => current.filter((item) => item !== uri))}
                      >
                        <FontAwesome name="times" size={12} color="#fff" />
                      </Pressable>
                    </View>
                  ))}
                </ScrollView>
              ) : null}

              <Text style={styles.label}>Caption</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                value={caption}
                onChangeText={setCaption}
                placeholder="Səyahətindən danış..."
                placeholderTextColor={colors.textMuted}
                multiline
                textAlignVertical="top"
              />

              <Text style={styles.label}>Yer (istəyə bağlı)</Text>
              <Pressable style={styles.locationButton} onPress={useCurrentLocation}>
                <Text style={styles.locationButtonText}>Cari lokasiyamı istifadə et</Text>
              </Pressable>
              {lat != null && lng != null && !selectedPoi ? (
                <Text style={styles.coordsText}>
                  📍 {lat.toFixed(5)}, {lng.toFixed(5)}
                </Text>
              ) : null}

              {selectedPoi ? (
                <View style={styles.selectedPoi}>
                  <Text style={styles.selectedPoiText}>{selectedPoi.name}</Text>
                  <Pressable
                    onPress={() => {
                      setSelectedPoi(null);
                    }}
                  >
                    <Text style={styles.removeText}>Sil</Text>
                  </Pressable>
                </View>
              ) : (
                <>
                  <TextInput
                    style={styles.input}
                    value={poiQuery}
                    onChangeText={setPoiQuery}
                    placeholder="POI axtar..."
                    placeholderTextColor={colors.textMuted}
                  />
                  {searchingPois ? (
                    <ActivityIndicator color={colors.accent} style={{ marginTop: 8 }} />
                  ) : null}
                  {poiResults.map((poi) => (
                    <Pressable
                      key={poi.id}
                      style={styles.poiRow}
                      onPress={() => {
                        setSelectedPoi(poi);
                        setLat(poi.lat);
                        setLng(poi.lng);
                        setPoiQuery('');
                        setPoiResults([]);
                      }}
                    >
                      <Text style={styles.poiName}>{poi.name}</Text>
                    </Pressable>
                  ))}
                </>
              )}

              <Pressable
                style={[styles.submitButton, sharing && styles.disabled]}
                onPress={handleShare}
                disabled={sharing}
              >
                {sharing ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.submitText}>Paylaş</Text>
                )}
              </Pressable>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={!!mapPost} transparent animationType="fade" onRequestClose={() => setMapPost(null)}>
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={styles.mapSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Xəritə</Text>
              <Pressable onPress={() => setMapPost(null)} hitSlop={12}>
                <Text style={styles.closeText}>Bağla</Text>
              </Pressable>
            </View>
            {mapPost && (mapPost.lat ?? mapPost.poi?.lat) != null ? (
              <MapView
                style={styles.miniMap}
                initialRegion={{
                  latitude: (mapPost.lat ?? mapPost.poi!.lat) as number,
                  longitude: (mapPost.lng ?? mapPost.poi!.lng) as number,
                  latitudeDelta: 0.05,
                  longitudeDelta: 0.05,
                }}
              >
                <Marker
                  coordinate={{
                    latitude: (mapPost.lat ?? mapPost.poi!.lat) as number,
                    longitude: (mapPost.lng ?? mapPost.poi!.lng) as number,
                  }}
                  title={mapPost.poi?.name ?? 'Post yeri'}
                />
              </MapView>
            ) : null}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <PoiDetailModal
        poi={detailPoi}
        visible={detailVisible}
        onClose={() => {
          setDetailVisible(false);
          setDetailPoi(null);
        }}
      />
    </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  backText: {
    color: colors.accent,
    fontWeight: '600',
  },
  shareButton: {
    backgroundColor: colors.accent,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  shareButtonText: {
    color: colors.textOnAccent,
    fontWeight: '700',
    fontSize: 13,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: colors.text,
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 32,
  },
  card: {
    borderRadius: 24,
    padding: 12,
    marginBottom: 12,
    backgroundColor: colors.surface,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 3,
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  avatarPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: 20,
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
  },
  authorName: {
    fontSize: 15,
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
  photoScroll: {
    marginBottom: 10,
  },
  postPhoto: {
    width: PHOTO_WIDTH,
    height: 220,
    borderRadius: 12,
    marginRight: 8,
    backgroundColor: colors.chip,
  },
  caption: {
    fontSize: 14,
    color: colors.text,
    lineHeight: 20,
    marginBottom: 8,
  },
  poiLink: {
    fontSize: 13,
    color: colors.accent,
    fontWeight: '700',
    marginBottom: 6,
  },
  mapLink: {
    alignSelf: 'flex-start',
    marginBottom: 8,
  },
  mapLinkText: {
    fontSize: 13,
    color: '#0F766E',
    fontWeight: '700',
  },
  ratingBlock: {
    marginTop: 4,
    gap: 6,
  },
  ratingLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  starsRow: {
    flexDirection: 'row',
    gap: 6,
  },
  emptyText: {
    textAlign: 'center',
    color: colors.textMuted,
    marginTop: 48,
    fontSize: 14,
  },
  errorBanner: {
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: colors.dangerSoft,
    color: colors.dangerText,
    borderRadius: 8,
    padding: 10,
    fontSize: 13,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    maxHeight: '92%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  mapSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: 16,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 8,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.text,
  },
  closeText: {
    color: colors.accent,
    fontWeight: '600',
  },
  modalContent: {
    paddingHorizontal: 16,
    paddingBottom: 80,
    flexGrow: 1,
  },
  imagePickButton: {
    borderWidth: 1,
    borderColor: '#BFDBFE',
    backgroundColor: colors.accentSoft,
    borderRadius: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 10,
  },
  imagePickText: {
    color: colors.accent,
    fontWeight: '700',
  },
  previewWrap: {
    marginRight: 10,
    position: 'relative',
  },
  preview: {
    width: 84,
    height: 84,
    borderRadius: 10,
  },
  removePreview: {
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
  label: {
    marginTop: 12,
    marginBottom: 6,
    fontSize: 13,
    fontWeight: '700',
    color: colors.chipText,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 15,
    color: colors.text,
  },
  textArea: {
    minHeight: 90,
  },
  locationButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: colors.surfaceMuted,
  },
  locationButtonText: {
    color: colors.text,
    fontWeight: '700',
  },
  coordsText: {
    marginTop: 8,
    fontSize: 12,
    color: colors.textSecondary,
  },
  selectedPoi: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
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
    color: colors.text,
    flex: 1,
  },
  removeText: {
    color: colors.danger,
    fontWeight: '700',
  },
  poiRow: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 8,
  },
  poiName: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  submitButton: {
    marginTop: 18,
    marginBottom: 20,
    backgroundColor: colors.accent,
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
  },
  submitText: {
    color: colors.textOnAccent,
    fontWeight: '700',
    fontSize: 15,
  },
  disabled: {
    opacity: 0.6,
  },
  miniMap: {
    height: 280,
    marginHorizontal: 16,
    borderRadius: 12,
    overflow: 'hidden',
  },
});
