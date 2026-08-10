import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useMemo, useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { getApiBaseUrl } from '../lib/apiBase';
import { getAuthHeaders } from '../lib/authHeaders';
import { getErrorMessage } from '../lib/errors';
import {
  setListingReportStatus,
  setPoiPhotoStatus,
  setPostPhotoStatus,
  setPoiStatus,
  updateListingAsAdmin,
  deleteListingAsAdminOrOwner,
} from '../lib/moderation';
import { pickPhotoUrl } from '../lib/photoUrls';
import { confirmDelete } from '../lib/userContentDelete';
import { supabase } from '../lib/supabase';
import type { ListingReport, Poi, PoiPhoto, PostPhoto } from '../types/database';

import type { ThemeColors } from '../constants/theme';
import { useThemeColors } from '../theme/ThemeProvider';

type ModTab = 'pois' | 'photos' | 'reports';

type PendingModPhoto = {
  id: string;
  kind: 'poi' | 'post';
  photo_url: string;
  thumb_url?: string | null;
  medium_url?: string | null;
  label: string;
};

type ReportRow = ListingReport & {
  listing_title?: string | null;
};

interface AdminModerationModalProps {
  visible: boolean;
  onClose: () => void;
  /** Open on a specific queue tab */
  initialTab?: ModTab;
}

export function AdminModerationModal({
  visible,
  onClose,
  initialTab = 'pois',
}: AdminModerationModalProps) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [tab, setTab] = useState<ModTab>(initialTab);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingPois, setPendingPois] = useState<Poi[]>([]);
  const [pendingPhotos, setPendingPhotos] = useState<PendingModPhoto[]>([]);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editListingId, setEditListingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setErrorMessage(null);

    const base = getApiBaseUrl();
    const headers = await getAuthHeaders();

    const modPhotos: PendingModPhoto[] = [];
    let poiPhotosLoadedViaApi = false;
    let postPhotosLoadedViaApi = false;

    if (base && headers) {
      try {
        const [poiRes, postRes] = await Promise.all([
          fetch(`${base}/api/pois/photos/pending`, { headers }),
          fetch(`${base}/api/posts/photos/pending`, { headers }),
        ]);
        if (poiRes.ok) {
          const json = (await poiRes.json()) as {
            photos?: (PoiPhoto & { poi_name?: string })[];
          };
          for (const photo of json.photos ?? []) {
            modPhotos.push({
              id: photo.id,
              kind: 'poi',
              photo_url: photo.photo_url,
              thumb_url: photo.thumb_url,
              medium_url: photo.medium_url,
              label: photo.poi_name ? `Məkan · ${photo.poi_name}` : 'Məkan şəkli',
            });
          }
          poiPhotosLoadedViaApi = true;
        }
        if (postRes.ok) {
          const json = (await postRes.json()) as {
            photos?: (PostPhoto & { post_caption?: string })[];
          };
          for (const photo of json.photos ?? []) {
            const caption = photo.post_caption?.trim();
            modPhotos.push({
              id: photo.id,
              kind: 'post',
              photo_url: photo.photo_url,
              label: caption ? `Paylaşım · ${caption}` : 'Paylaşım şəkli',
            });
          }
          postPhotosLoadedViaApi = true;
        }
      } catch {
        // fall back to supabase
      }
    }

    const [poisRes, photosRes, postPhotosRes, reportsRes] = await Promise.all([
      supabase
        .from('pois')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(50),
      poiPhotosLoadedViaApi
        ? Promise.resolve({ data: [] as PoiPhoto[], error: null })
        : supabase
            .from('poi_photos')
            .select(
              'id, poi_id, photo_url, thumb_url, medium_url, order_index, status, uploaded_by, created_at'
            )
            .eq('status', 'pending')
            .order('created_at', { ascending: false })
            .limit(50),
      postPhotosLoadedViaApi
        ? Promise.resolve({ data: [] as PostPhoto[], error: null })
        : supabase
            .from('post_photos')
            .select('id, post_id, photo_url, order_index, status, created_at')
            .eq('status', 'pending')
            .order('created_at', { ascending: false })
            .limit(50),
      supabase
        .from('listing_reports')
        .select('id, listing_id, reporter_id, reason, details, status, created_at')
        .eq('status', 'open')
        .order('created_at', { ascending: false })
        .limit(50),
    ]);

    if (poisRes.error || photosRes.error || reportsRes.error) {
      setErrorMessage(
        getErrorMessage(poisRes.error || photosRes.error || reportsRes.error)
      );
      setLoading(false);
      return;
    }

    if (!poiPhotosLoadedViaApi) {
      const rows = (photosRes.data ?? []) as PoiPhoto[];
      const poiIds = [...new Set(rows.map((p) => p.poi_id))];
      let poiNameById = new Map<string, string>();
      if (poiIds.length > 0) {
        const { data: poiNames } = await supabase.from('pois').select('id, name').in('id', poiIds);
        poiNameById = new Map((poiNames ?? []).map((p) => [p.id, p.name]));
      }
      for (const photo of rows) {
        modPhotos.push({
          id: photo.id,
          kind: 'poi',
          photo_url: photo.photo_url,
          thumb_url: photo.thumb_url,
          medium_url: photo.medium_url,
          label: poiNameById.get(photo.poi_id)
            ? `Məkan · ${poiNameById.get(photo.poi_id)}`
            : 'Məkan şəkli',
        });
      }
    }

    if (!postPhotosLoadedViaApi && !postPhotosRes.error) {
      const rows = (postPhotosRes.data ?? []) as PostPhoto[];
      const postIds = [...new Set(rows.map((p) => p.post_id))];
      let captionById = new Map<string, string>();
      if (postIds.length > 0) {
        const { data: posts } = await supabase
          .from('posts')
          .select('id, caption')
          .in('id', postIds);
        captionById = new Map(
          (posts ?? []).map((p) => [p.id, (p.caption || '').trim().slice(0, 80)])
        );
      }
      for (const photo of rows) {
        const caption = captionById.get(photo.post_id);
        modPhotos.push({
          id: photo.id,
          kind: 'post',
          photo_url: photo.photo_url,
          label: caption ? `Paylaşım · ${caption}` : 'Paylaşım şəkli',
        });
      }
    }

    const reportRows = (reportsRes.data ?? []) as ListingReport[];
    const listingIds = [...new Set(reportRows.map((r) => r.listing_id))];
    let listingTitleById = new Map<string, string>();
    if (listingIds.length > 0) {
      const { data: listingTitles } = await supabase
        .from('listings')
        .select('id, title')
        .in('id', listingIds);
      listingTitleById = new Map((listingTitles ?? []).map((l) => [l.id, l.title]));
    }

    setPendingPois((poisRes.data ?? []) as Poi[]);
    setPendingPhotos(modPhotos);
    setReports(
      reportRows.map((report) => ({
        ...report,
        listing_title: listingTitleById.get(report.listing_id) ?? null,
      }))
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    if (visible) {
      setTab(initialTab);
      void load();
    }
  }, [visible, initialTab, load]);

  async function approvePoi(id: string) {
    setBusyId(id);
    const { error } = await setPoiStatus(id, 'approved');
    setBusyId(null);
    if (error) {
      setErrorMessage(error);
      return;
    }
    await load();
  }

  async function rejectPoi(id: string) {
    setBusyId(id);
    const { error } = await setPoiStatus(id, 'rejected');
    setBusyId(null);
    if (error) {
      setErrorMessage(error);
      return;
    }
    await load();
  }

  async function approvePhoto(photo: PendingModPhoto) {
    setBusyId(photo.id);
    const { error } =
      photo.kind === 'post'
        ? await setPostPhotoStatus(photo.id, 'approved')
        : await setPoiPhotoStatus(photo.id, 'approved');
    setBusyId(null);
    if (error) {
      setErrorMessage(error);
      return;
    }
    await load();
  }

  async function rejectPhoto(photo: PendingModPhoto) {
    setBusyId(photo.id);
    const { error } =
      photo.kind === 'post'
        ? await setPostPhotoStatus(photo.id, 'rejected')
        : await setPoiPhotoStatus(photo.id, 'rejected');
    setBusyId(null);
    if (error) {
      setErrorMessage(error);
      return;
    }
    await load();
  }

  async function dismissReport(id: string) {
    setBusyId(id);
    const { error } = await setListingReportStatus(id, 'dismissed');
    setBusyId(null);
    if (error) {
      setErrorMessage(error);
      return;
    }
    await load();
  }

  async function removeListingFromReport(report: ReportRow) {
    const confirmed = await confirmDelete(
      'Elanı sil',
      `"${report.listing_title ?? 'Elan'}" silinsin və şikayət bağlansın?`
    );
    if (!confirmed) {
      return;
    }

    setBusyId(report.id);
    const del = await deleteListingAsAdminOrOwner(report.listing_id);
    if (del.error) {
      setBusyId(null);
      setErrorMessage(del.error);
      return;
    }
    const { error } = await setListingReportStatus(report.id, 'actioned');
    setBusyId(null);
    if (error) {
      setErrorMessage(error);
      return;
    }
    await load();
  }

  async function openEditListing(report: ReportRow) {
    setEditListingId(report.listing_id);
    setEditTitle(report.listing_title ?? '');
    setEditDescription('');
    const { data } = await supabase
      .from('listings')
      .select('title, description')
      .eq('id', report.listing_id)
      .maybeSingle();
    if (data) {
      setEditTitle(data.title);
      setEditDescription(data.description ?? '');
    }
  }

  async function saveListingEdit() {
    if (!editListingId) {
      return;
    }
    setBusyId(editListingId);
    const { error } = await updateListingAsAdmin(editListingId, {
      title: editTitle.trim(),
      description: editDescription.trim() || null,
    });
    setBusyId(null);
    if (error) {
      setErrorMessage(error);
      return;
    }
    setEditListingId(null);
    await load();
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>Admin nəzarəti</Text>
            <Pressable onPress={onClose} hitSlop={12}>
              <FontAwesome name="times" size={18} color={colors.textSecondary} />
            </Pressable>
          </View>

          <View style={styles.tabs}>
            {(
              [
                { id: 'pois', label: 'Məkanlar' },
                { id: 'photos', label: 'Şəkillər' },
                { id: 'reports', label: 'Şikayətlər' },
              ] as const
            ).map((item) => (
              <Pressable
                key={item.id}
                style={[styles.tab, tab === item.id && styles.tabActive]}
                onPress={() => setTab(item.id)}
              >
                <Text style={[styles.tabText, tab === item.id && styles.tabTextActive]}>
                  {item.label}
                </Text>
              </Pressable>
            ))}
          </View>

          {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}

          {loading ? (
            <ActivityIndicator color={colors.accent} style={{ marginTop: 24 }} />
          ) : (
            <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
              {tab === 'pois'
                ? pendingPois.length === 0
                  ? <Text style={styles.empty}>Gözləyən məkan yoxdur</Text>
                  : pendingPois.map((poi) => (
                      <View key={poi.id} style={styles.card}>
                        <Text style={styles.cardTitle}>{poi.name}</Text>
                        <Text style={styles.meta}>{poi.region} · {poi.category}</Text>
                        {poi.description ? (
                          <Text style={styles.meta} numberOfLines={2}>{poi.description}</Text>
                        ) : null}
                        <View style={styles.row}>
                          <Pressable
                            style={[styles.btn, styles.approve]}
                            disabled={busyId === poi.id}
                            onPress={() => void approvePoi(poi.id)}
                          >
                            <Text style={styles.btnText}>Təsdiq et</Text>
                          </Pressable>
                          <Pressable
                            style={[styles.btn, styles.reject]}
                            disabled={busyId === poi.id}
                            onPress={() => void rejectPoi(poi.id)}
                          >
                            <Text style={styles.btnTextDark}>Rədd et</Text>
                          </Pressable>
                        </View>
                      </View>
                    ))
                : null}

              {tab === 'photos'
                ? pendingPhotos.length === 0
                  ? <Text style={styles.empty}>Gözləyən şəkil yoxdur</Text>
                  : pendingPhotos.map((photo) => (
                      <View key={`${photo.kind}-${photo.id}`} style={styles.card}>
                        <Image
                          source={{
                            uri:
                              pickPhotoUrl(photo, 'thumb') ?? photo.photo_url,
                          }}
                          style={styles.thumb}
                        />
                        <Text style={styles.meta}>{photo.label}</Text>
                        <View style={styles.row}>
                          <Pressable
                            style={[styles.btn, styles.approve]}
                            disabled={busyId === photo.id}
                            onPress={() => void approvePhoto(photo)}
                          >
                            <Text style={styles.btnText}>Təsdiq et</Text>
                          </Pressable>
                          <Pressable
                            style={[styles.btn, styles.reject]}
                            disabled={busyId === photo.id}
                            onPress={() => void rejectPhoto(photo)}
                          >
                            <Text style={styles.btnTextDark}>Rədd et</Text>
                          </Pressable>
                        </View>
                      </View>
                    ))
                : null}

              {tab === 'reports'
                ? reports.length === 0
                  ? <Text style={styles.empty}>Açıq şikayət yoxdur</Text>
                  : reports.map((report) => (
                      <View key={report.id} style={styles.card}>
                        <Text style={styles.cardTitle}>{report.listing_title ?? 'Elan'}</Text>
                        <Text style={styles.meta}>Səbəb: {report.reason}</Text>
                        {report.details ? (
                          <Text style={styles.meta}>{report.details}</Text>
                        ) : null}
                        <View style={styles.row}>
                          <Pressable
                            style={[styles.btn, styles.approve]}
                            onPress={() => void openEditListing(report)}
                          >
                            <Text style={styles.btnText}>Redaktə</Text>
                          </Pressable>
                          <Pressable
                            style={[styles.btn, styles.reject]}
                            disabled={busyId === report.id}
                            onPress={() => void removeListingFromReport(report)}
                          >
                            <Text style={styles.btnTextDark}>Elanı sil</Text>
                          </Pressable>
                        </View>
                        <Pressable
                          style={styles.linkBtn}
                          disabled={busyId === report.id}
                          onPress={() => void dismissReport(report.id)}
                        >
                          <Text style={styles.linkText}>Şikayəti bağla</Text>
                        </Pressable>
                      </View>
                    ))
                : null}

              {editListingId ? (
                <View style={styles.editBox}>
                  <Text style={styles.cardTitle}>Elanı redaktə et</Text>
                  <TextInput
                    style={styles.input}
                    value={editTitle}
                    onChangeText={setEditTitle}
                    placeholder="Başlıq"
                  />
                  <TextInput
                    style={[styles.input, styles.textArea]}
                    value={editDescription}
                    onChangeText={setEditDescription}
                    placeholder="Təsvir"
                    multiline
                  />
                  <View style={styles.row}>
                    <Pressable
                      style={[styles.btn, styles.approve]}
                      disabled={busyId === editListingId}
                      onPress={() => void saveListingEdit()}
                    >
                      <Text style={styles.btnText}>Yadda saxla</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.btn, styles.reject]}
                      onPress={() => setEditListingId(null)}
                    >
                      <Text style={styles.btnTextDark}>Ləğv et</Text>
                    </Pressable>
                  </View>
                </View>
              ) : null}
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
    maxHeight: '88%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.text,
  },
  tabs: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  tab: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: colors.chip,
    alignItems: 'center',
  },
  tabActive: {
    backgroundColor: colors.text,
  },
  tabText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.chipText,
  },
  tabTextActive: {
    color: colors.textOnAccent,
  },
  list: {
    paddingBottom: 28,
    gap: 10,
  },
  empty: {
    textAlign: 'center',
    color: colors.textMuted,
    marginTop: 28,
  },
  card: {
    borderRadius: 24,
    padding: 12,
    backgroundColor: colors.surface,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 3,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  meta: {
    marginTop: 4,
    fontSize: 13,
    color: colors.textSecondary,
  },
  thumb: {
    width: '100%',
    height: 140,
    borderRadius: 8,
    marginBottom: 8,
    backgroundColor: colors.chip,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  btn: {
    flex: 1,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  approve: {
    backgroundColor: colors.success,
  },
  reject: {
    backgroundColor: colors.dangerSoft,
  },
  btnText: {
    color: colors.textOnAccent,
    fontWeight: '700',
  },
  btnTextDark: {
    color: colors.dangerText,
    fontWeight: '700',
  },
  linkBtn: {
    marginTop: 8,
    alignSelf: 'flex-start',
  },
  linkText: {
    color: colors.textSecondary,
    fontWeight: '600',
    fontSize: 13,
  },
  error: {
    backgroundColor: colors.dangerSoft,
    color: colors.dangerText,
    padding: 8,
    borderRadius: 8,
    marginBottom: 8,
    fontSize: 13,
  },
  editBox: {
    borderWidth: 1,
    borderColor: '#BFDBFE',
    backgroundColor: colors.accentSoft,
    borderRadius: 12,
    padding: 12,
    marginTop: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginTop: 8,
    backgroundColor: colors.surface,
  },
  textArea: {
    minHeight: 72,
    textAlignVertical: 'top',
  },
});
}
