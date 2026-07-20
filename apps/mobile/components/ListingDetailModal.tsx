import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { REGIONS } from '../constants/regions';
import { FavoriteButton } from './FavoriteButton';
import { TransientHint } from './TransientHint';
import { notifyAdminsViaWhatsApp } from '../lib/adminNotify';
import { getErrorMessage } from '../lib/errors';
import {
  buildListingWhatsAppUrl,
  resolveListingWhatsAppPhone,
} from '../lib/listingWhatsApp';
import {
  LISTING_REPORT_REASONS,
  type ListingReportReasonId,
  reportListing,
  updateListingAsAdmin,
} from '../lib/moderation';
import { supabase } from '../lib/supabase';
import { useIsAdmin } from '../lib/useIsAdmin';
import { confirmDelete, deleteListing } from '../lib/userContentDelete';
import type {
  Listing,
  ListingParticipant,
  ListingType,
  ParticipantStatus,
  Profile,
} from '../types/database';

import { colors } from '../constants/theme';

export type ListingWithCreator = Listing & {
  creator: Pick<Profile, 'id' | 'full_name' | 'avatar_url' | 'phone'> | null;
};

interface ListingDetailModalProps {
  listing: ListingWithCreator | null;
  visible: boolean;
  onClose: () => void;
  onDeleted?: () => void;
}

type ParticipantProfile = Pick<Profile, 'id' | 'full_name' | 'avatar_url' | 'rating_avg'>;

type ParticipantRow = ListingParticipant & {
  profiles: ParticipantProfile | ParticipantProfile[] | null;
};

function getParticipantProfile(row: ParticipantRow): ParticipantProfile | null {
  if (!row.profiles) {
    return null;
  }
  return Array.isArray(row.profiles) ? (row.profiles[0] ?? null) : row.profiles;
}

function CreatorStarRating({ value, loading }: { value: number | null; loading: boolean }) {
  if (loading) {
    return <Text style={styles.ratingLoading}>…</Text>;
  }
  if (value == null || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  const filled = Math.min(5, Math.max(1, Math.round(value)));
  return (
    <View style={styles.ratingRow}>
      {[1, 2, 3, 4, 5].map((n) => (
        <FontAwesome
          key={n}
          name={n <= filled ? 'star' : 'star-o'}
          size={11}
          color={colors.warning}
        />
      ))}
    </View>
  );
}

const STATUS_META: Record<
  ParticipantStatus,
  { label: string; background: string; color: string }
> = {
  pending: { label: 'Gözləyir', background: colors.warningSoft, color: colors.warning },
  approved: { label: 'Təsdiqlənib', background: colors.successSoft, color: colors.success },
  rejected: { label: 'Rədd edilib', background: colors.dangerSoft, color: colors.dangerText },
  cancelled: { label: 'Ləğv edilib', background: colors.chip, color: colors.textSecondary },
};

const TYPE_META: Record<ListingType, { label: string; emoji: string; color: string }> = {
  carpool: { label: 'Carpool', emoji: '🚗', color: colors.accent },
  tour: { label: 'Tur', emoji: '🗺', color: colors.success },
  local_service: { label: 'Yerli xidmət', emoji: '🏔', color: colors.warning },
};

function formatDate(value: string | null): string {
  if (!value) {
    return 'Tarix yoxdur';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString('az-AZ', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function formatPrice(listing: Listing): string {
  if (listing.price == null) {
    return 'Razılaşma ilə';
  }
  if (listing.price_type === 'free' || listing.price === 0) {
    return 'Pulsuz';
  }

  const amount = `${listing.price} ₼`;
  if (listing.type === 'tour' || listing.price_type === 'per_person') {
    return `${amount} / nəfər`;
  }
  if (listing.price_type === 'negotiable') {
    return `${amount} (razılaşma ilə)`;
  }
  if (listing.price_type) {
    return `${amount} (${listing.price_type})`;
  }
  return amount;
}

function getCapacity(listing: Listing): number {
  return listing.capacity ?? listing.max_participants ?? 0;
}

export function ListingDetailModal({
  listing,
  visible,
  onClose,
  onDeleted,
}: ListingDetailModalProps) {
  const router = useRouter();
  const { isAdmin } = useIsAdmin();
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [creatorRating, setCreatorRating] = useState<number | null>(null);
  const [routePois, setRoutePois] = useState<string[]>([]);
  const [routeListOpen, setRouteListOpen] = useState(false);
  const [loadingExtras, setLoadingExtras] = useState(false);
  const [infoToast, setInfoToast] = useState<string | null>(null);
  const [infoToastKey, setInfoToastKey] = useState(0);

  const [showJoinForm, setShowJoinForm] = useState(false);
  const [joinMessage, setJoinMessage] = useState('');
  const [joining, setJoining] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [showReportForm, setShowReportForm] = useState(false);
  const [reportReason, setReportReason] = useState<ListingReportReasonId>('inappropriate');
  const [reportDetails, setReportDetails] = useState('');
  const [reporting, setReporting] = useState(false);

  const [showAdminEdit, setShowAdminEdit] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  const [showParticipants, setShowParticipants] = useState(false);
  const [participants, setParticipants] = useState<ParticipantRow[]>([]);
  const [loadingParticipants, setLoadingParticipants] = useState(false);
  const [updatingParticipantId, setUpdatingParticipantId] = useState<string | null>(null);

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const fetchParticipants = useCallback(async () => {
    if (!listing) {
      return;
    }

    setLoadingParticipants(true);
    setErrorMessage(null);

    const { data, error } = await supabase
      .from('listing_participants')
      .select(
        `
        *,
        profiles (
          id,
          full_name,
          avatar_url,
          rating_avg
        )
      `
      )
      .eq('listing_id', listing.id)
      .order('created_at', { ascending: false });

    if (error) {
      setErrorMessage(getErrorMessage(error));
      setParticipants([]);
      setLoadingParticipants(false);
      return;
    }

    setParticipants((data ?? []) as unknown as ParticipantRow[]);
    setLoadingParticipants(false);
  }, [listing]);

  async function loadParticipants() {
    setShowParticipants(true);
    await fetchParticipants();
  }

  function showInfoToast(message: string) {
    setInfoToast(message);
    setInfoToastKey((key) => key + 1);
  }

  useEffect(() => {
    if (!visible) {
      setInfoToast(null);
    }
  }, [visible]);

  useEffect(() => {
    if (!visible || !routeListOpen || loadingExtras) {
      return;
    }
    if (routePois.length === 0) {
      showInfoToast('Yer siyahısı yoxdur');
    }
  }, [visible, routeListOpen, loadingExtras, routePois.length]);

  useEffect(() => {
    if (!visible || !showParticipants || loadingParticipants) {
      return;
    }
    if (participants.length === 0) {
      showInfoToast('Hələ iştirakçı yoxdur');
    }
  }, [visible, showParticipants, loadingParticipants, participants.length]);

  useEffect(() => {
    if (!visible || !listing) {
      return;
    }

    const channel = supabase
      .channel(`participants-${listing.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'listing_participants',
          filter: `listing_id=eq.${listing.id}`,
        },
        () => {
          fetchParticipants();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [visible, listing, fetchParticipants]);

  useEffect(() => {
    if (!visible || !listing) {
      return;
    }

    let isActive = true;

    async function loadExtras() {
      setLoadingExtras(true);
      setErrorMessage(null);
      setSuccessMessage(null);
      setShowJoinForm(false);
      setShowParticipants(false);
      setShowReportForm(false);
      setShowAdminEdit(false);
      setJoinMessage('');
      setReportDetails('');
      setRoutePois([]);
      setRouteListOpen(false);
      setCreatorRating(null);

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!isActive) {
        return;
      }

      setCurrentUserId(user?.id ?? null);

      const [listingRatingsResult, routePoisResult] = await Promise.all([
        supabase
          .from('ratings')
          .select('score')
          .eq('target_type', 'listing')
          .eq('target_id', listing!.id),
        listing!.type === 'tour' || listing!.type === 'carpool'
          ? supabase.rpc('get_listing_route_poi_names', {
              p_listing_id: listing!.id,
            })
          : Promise.resolve({ data: null, error: null }),
      ]);

      if (!isActive) {
        return;
      }

      if (
        !listingRatingsResult.error &&
        listingRatingsResult.data &&
        listingRatingsResult.data.length > 0
      ) {
        const sum = listingRatingsResult.data.reduce((acc, row) => acc + row.score, 0);
        setCreatorRating(sum / listingRatingsResult.data.length);
      } else {
        setCreatorRating(null);
      }

      if (
        (listing!.type === 'tour' || listing!.type === 'carpool') &&
        !routePoisResult.error
      ) {
        const rpcRows = Array.isArray(routePoisResult.data) ? routePoisResult.data : [];
        if (rpcRows.length > 0) {
          setRoutePois(
            rpcRows
              .map((row: { name?: string | null }) => row.name)
              .filter((name): name is string => Boolean(name))
          );
        } else {
          // Fallback if RPC not deployed yet
          const { data: linkRows, error: linkError } = await supabase
            .from('listing_pois')
            .select('poi_id, sort_order')
            .eq('listing_id', listing!.id);

          if (!isActive) {
            return;
          }

          if (!linkError && linkRows && linkRows.length > 0) {
            const sorted = [...linkRows].sort(
              (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)
            );
            const poiIds = sorted.map((row) => row.poi_id);
            const { data: pois } = await supabase
              .from('pois')
              .select('id, name')
              .in('id', poiIds);

            if (!isActive) {
              return;
            }

            if (pois) {
              const nameById = new Map(pois.map((poi) => [poi.id, poi.name]));
              setRoutePois(poiIds.map((id) => nameById.get(id) ?? id).filter(Boolean));
            }
          }
        }
      }

      if (isActive) {
        setLoadingExtras(false);
      }
    }

    loadExtras();

    return () => {
      isActive = false;
    };
  }, [visible, listing]);

  async function openWhatsApp() {
    if (!listing) {
      return;
    }

    setErrorMessage(null);
    const creatorName = listing.creator?.full_name?.trim() || 'istifadəçi';
    const phoneDigits = resolveListingWhatsAppPhone({
      contactPhone: listing.contact_phone,
      creatorPhone: listing.creator?.phone,
    });

    if (!phoneDigits) {
      setErrorMessage(
        'Bu elanda əlaqə nömrəsi yoxdur. Elan sahibi nömrə əlavə etməyib.'
      );
      return;
    }

    const url = buildListingWhatsAppUrl({
      phoneDigits,
      creatorName,
      listingTitle: listing.title,
    });

    try {
      await Linking.openURL(url);
    } catch (err) {
      setErrorMessage(getErrorMessage(err));
    }
  }

  const contactDisplayPhone =
    listing?.contact_phone?.trim() || listing?.creator?.phone?.trim() || null;

  async function handleJoinSubmit() {
    if (!listing || !currentUserId) {
      setErrorMessage('Qoşulmaq üçün daxil olun.');
      return;
    }

    setJoining(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const { error } = await supabase.from('listing_participants').insert({
        listing_id: listing.id,
        user_id: currentUserId,
        status: 'pending',
        message: joinMessage.trim() || null,
      });

      if (error) {
        setErrorMessage(getErrorMessage(error));
        return;
      }

      setSuccessMessage('Sorğunuz göndərildi, təsdiq gözlənilir');
      setShowJoinForm(false);
      setJoinMessage('');
    } catch (err) {
      setErrorMessage(getErrorMessage(err));
    } finally {
      setJoining(false);
    }
  }

  async function updateParticipantStatus(participantId: string, status: 'approved' | 'rejected') {
    setUpdatingParticipantId(participantId);
    setErrorMessage(null);

    const { error } = await supabase
      .from('listing_participants')
      .update({ status })
      .eq('id', participantId);

    if (error) {
      setErrorMessage(getErrorMessage(error));
      setUpdatingParticipantId(null);
      return;
    }

    setParticipants((current) =>
      current.map((row) => (row.id === participantId ? { ...row, status } : row))
    );
    setUpdatingParticipantId(null);
  }

  async function handleDeleteListing() {
    if (!listing || deleting) {
      return;
    }

    const confirmed = await confirmDelete(
      'Elanı sil',
      'Bu elanı silmək istədiyinizə əminsiniz?'
    );
    if (!confirmed) {
      return;
    }

    setDeleting(true);
    setErrorMessage(null);
    const { error } = await deleteListing(listing.id);
    setDeleting(false);

    if (error) {
      setErrorMessage(error);
      return;
    }

    onClose();
    onDeleted?.();
  }

  async function handleReportSubmit() {
    if (!listing || !currentUserId || reporting) {
      setErrorMessage('Şikayət üçün daxil olun.');
      return;
    }

    setReporting(true);
    setErrorMessage(null);
    const { error } = await reportListing({
      listingId: listing.id,
      reason: reportReason,
      details: reportDetails,
    });
    setReporting(false);

    if (error) {
      setErrorMessage(error);
      return;
    }

    setShowReportForm(false);
    setReportDetails('');
    setSuccessMessage('Şikayətiniz qəbul olundu. Adminə göndərildi.');
    Alert.alert('Şikayət göndərildi', 'Admin ən qısa zamanda yoxlayacaq.', [
      {
        text: 'OK',
        onPress: () => {
          const reasonLabel =
            LISTING_REPORT_REASONS.find((item) => item.id === reportReason)?.label ?? reportReason;
          void notifyAdminsViaWhatsApp(
            'listing_report',
            `"${listing.title}" — ${reasonLabel}`
          );
        },
      },
    ]);
  }

  async function handleAdminSave() {
    if (!listing || savingEdit) {
      return;
    }
    setSavingEdit(true);
    setErrorMessage(null);
    const { error } = await updateListingAsAdmin(listing.id, {
      title: editTitle.trim(),
      description: editDescription.trim() || null,
    });
    setSavingEdit(false);
    if (error) {
      setErrorMessage(error);
      return;
    }
    setShowAdminEdit(false);
    setSuccessMessage('Elan yeniləndi.');
    onDeleted?.();
  }

  if (!listing) {
    return null;
  }

  const meta = TYPE_META[listing.type];
  const regionLabel =
    REGIONS.find((region) => region.id === listing.region)?.label ?? listing.region ?? '—';
  const creatorName = listing.creator?.full_name?.trim() || 'İstifadəçi';
  const isOwner = !!currentUserId && currentUserId === listing.created_by;
  const capacity = getCapacity(listing);
  const spotsLeft = listing.spots_left ?? 0;
  const joinedCount = Math.max(capacity - spotsLeft, 0);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.sheet}>
          <View style={styles.sheetHeader}>
            <FavoriteButton targetType="listing" targetId={listing.id} />
            <Pressable onPress={onClose} style={styles.closeButton} hitSlop={12}>
              <FontAwesome name="times" size={18} color={colors.text} />
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
            <View style={[styles.badge, { backgroundColor: `${meta.color}22` }]}>
              <Text style={[styles.badgeText, { color: meta.color }]}>
                {meta.emoji} {meta.label}
              </Text>
            </View>

            <Text style={styles.title} numberOfLines={2} ellipsizeMode="tail">
              {listing.title}
            </Text>

            <View style={styles.creatorActionsRow}>
              <Pressable
                style={styles.creatorLeft}
                onPress={() => {
                  if (!listing.creator?.id) {
                    return;
                  }
                  onClose();
                  router.push({
                    pathname: '/(tabs)/profil',
                    params: { userId: listing.creator.id },
                  });
                }}
                accessibilityLabel="Profilə bax"
              >
                {listing.creator?.avatar_url ? (
                  <Image source={{ uri: listing.creator.avatar_url }} style={styles.avatar} />
                ) : (
                  <View style={styles.avatarPlaceholder}>
                    <Text style={styles.avatarInitial}>{creatorName.charAt(0).toUpperCase()}</Text>
                  </View>
                )}
                <CreatorStarRating value={creatorRating} loading={loadingExtras} />
              </Pressable>

              <View style={styles.sideActions}>
                <Pressable
                  style={[
                    styles.sideActionBtn,
                    styles.whatsappButton,
                    !contactDisplayPhone && styles.whatsappButtonDisabled,
                  ]}
                  onPress={openWhatsApp}
                >
                  <FontAwesome name="whatsapp" size={12} color={colors.textOnAccent} />
                  <Text style={styles.sideActionText}>
                    {contactDisplayPhone ? 'Whatsappa yaz' : 'Nömrə yox'}
                  </Text>
                </Pressable>

                <Pressable
                  style={[styles.sideActionBtn, styles.splitBillButton]}
                  onPress={() => {
                    onClose();
                    router.push({
                      pathname: '/split-bill',
                      params: { listingId: listing.id },
                    } as never);
                  }}
                >
                  <FontAwesome name="money" size={11} color={colors.textOnAccent} />
                  <Text style={styles.sideActionText}>Xərc bölüşdür</Text>
                </Pressable>
              </View>
            </View>

            <Text style={styles.sectionLabel}>Məlumat</Text>

            {listing.type === 'carpool' ? (
              <>
                <Text style={styles.detailLine}>📍 Haradan: {listing.origin_text || '—'}</Text>
                <Text style={styles.detailLine}>📍 Haraya: {listing.destination_text || '—'}</Text>
                <Text style={styles.detailLine}>📅 Nə vaxt: {formatDate(listing.departure_at)}</Text>
                <Text style={styles.detailLine}>
                  💺 Qalan yer: {spotsLeft} / {capacity || '—'}
                </Text>
                <Text style={styles.detailLine}>💰 Qiymət: {formatPrice(listing)}</Text>
                <Pressable
                  style={styles.routeToggle}
                  onPress={() => setRouteListOpen((open) => !open)}
                >
                  <Text style={styles.routeToggleText}>
                    {routeListOpen ? '▾' : '▸'} Marşrut siyahısına bax
                    {routePois.length > 0 ? ` (${routePois.length})` : ''}
                  </Text>
                </Pressable>
                {routeListOpen ? (
                  loadingExtras ? (
                    <ActivityIndicator color={colors.accent} style={styles.inlineLoader} />
                  ) : routePois.length === 0 ? null : (
                    routePois.map((name, index) => (
                      <Text key={`${name}-${index}`} style={styles.poiItem}>
                        • {name}
                      </Text>
                    ))
                  )
                ) : null}
              </>
            ) : null}

            {listing.type === 'tour' ? (
              <>
                <Text style={styles.detailLine}>📍 Region: {regionLabel}</Text>
                <Text style={styles.detailLine}>📅 Nə vaxt: {formatDate(listing.departure_at)}</Text>
                <Text style={styles.detailLine}>
                  👥 İştirakçı: {joinedCount} / {capacity || '—'}
                </Text>
                <Text style={styles.detailLine}>💰 Qiymət: {formatPrice(listing)}</Text>
                <Pressable
                  style={styles.routeToggle}
                  onPress={() => setRouteListOpen((open) => !open)}
                >
                  <Text style={styles.routeToggleText}>
                    {routeListOpen ? '▾' : '▸'} Marşrut siyahısına bax
                    {routePois.length > 0 ? ` (${routePois.length})` : ''}
                  </Text>
                </Pressable>
                {routeListOpen ? (
                  loadingExtras ? (
                    <ActivityIndicator color={colors.accent} style={styles.inlineLoader} />
                  ) : routePois.length === 0 ? null : (
                    routePois.map((name, index) => (
                      <Text key={`${name}-${index}`} style={styles.poiItem}>
                        • {name}
                      </Text>
                    ))
                  )
                ) : null}
              </>
            ) : null}

            {listing.type === 'local_service' ? (
              <>
                <Text style={styles.detailLine}>📍 Region: {regionLabel}</Text>
                <Text style={styles.detailLine}>💰 Qiymət: {formatPrice(listing)}</Text>
                {listing.is_recurring ? (
                  <Text style={styles.detailLine}>🔄 Daimi xidmət</Text>
                ) : null}
              </>
            ) : null}

            {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}
            {successMessage ? <Text style={styles.successText}>{successMessage}</Text> : null}

            {!isOwner ? (
              <View style={styles.actions}>
                {spotsLeft > 0 ? (
                  showJoinForm ? (
                    <View style={styles.joinForm}>
                      <TextInput
                        style={styles.messageInput}
                        value={joinMessage}
                        onChangeText={setJoinMessage}
                        placeholder="Mesajınızı yazın..."
                        placeholderTextColor={colors.textMuted}
                        multiline
                        editable={!joining}
                      />
                      <Pressable
                        style={[styles.primaryButton, joining && styles.buttonDisabled]}
                        onPress={handleJoinSubmit}
                        disabled={joining}
                      >
                        {joining ? (
                          <ActivityIndicator color={colors.textOnAccent} />
                        ) : (
                          <Text style={styles.primaryButtonText}>Göndər</Text>
                        )}
                      </Pressable>
                    </View>
                  ) : (
                    <Pressable
                      style={styles.joinButton}
                      onPress={() => {
                        setShowJoinForm(true);
                        setSuccessMessage(null);
                        setErrorMessage(null);
                      }}
                    >
                      <Text style={styles.joinButtonText}>Qoşulmaq istəyirəm</Text>
                    </Pressable>
                  )
                ) : (
                  <View style={styles.disabledButton}>
                    <Text style={styles.disabledButtonText}>Yerlər dolub</Text>
                  </View>
                )}

                {showReportForm ? (
                  <View style={styles.reportForm}>
                    <Text style={styles.reportTitle}>Şikayət et</Text>
                    {LISTING_REPORT_REASONS.map((item) => (
                      <Pressable
                        key={item.id}
                        style={[
                          styles.reasonChip,
                          reportReason === item.id && styles.reasonChipSelected,
                        ]}
                        onPress={() => setReportReason(item.id)}
                      >
                        <Text
                          style={[
                            styles.reasonChipText,
                            reportReason === item.id && styles.reasonChipTextSelected,
                          ]}
                        >
                          {item.label}
                        </Text>
                      </Pressable>
                    ))}
                    <TextInput
                      style={styles.messageInput}
                      value={reportDetails}
                      onChangeText={setReportDetails}
                      placeholder="Əlavə izah (istəyə bağlı)"
                      placeholderTextColor={colors.textMuted}
                      multiline
                      editable={!reporting}
                    />
                    <Pressable
                      style={[styles.reportSubmit, reporting && styles.buttonDisabled]}
                      onPress={() => void handleReportSubmit()}
                      disabled={reporting}
                    >
                      {reporting ? (
                        <ActivityIndicator color={colors.textOnAccent} />
                      ) : (
                        <Text style={styles.primaryButtonText}>Şikayəti göndər</Text>
                      )}
                    </Pressable>
                    <Pressable onPress={() => setShowReportForm(false)}>
                      <Text style={styles.cancelReport}>Ləğv et</Text>
                    </Pressable>
                  </View>
                ) : (
                  <Pressable
                    style={styles.reportButton}
                    onPress={() => {
                      setShowReportForm(true);
                      setSuccessMessage(null);
                      setErrorMessage(null);
                    }}
                  >
                    <FontAwesome name="flag" size={13} color={colors.dangerText} />
                    <Text style={styles.reportButtonText}>Şikayət et</Text>
                  </Pressable>
                )}

                {isAdmin ? (
                  <View style={styles.adminActions}>
                    <Pressable
                      style={styles.ownerButton}
                      onPress={() => {
                        setEditTitle(listing.title);
                        setEditDescription(listing.description ?? '');
                        setShowAdminEdit(true);
                      }}
                    >
                      <Text style={styles.ownerButtonText}>Admin: redaktə et</Text>
                    </Pressable>
                    <Pressable
                      style={styles.deleteTextButton}
                      onPress={handleDeleteListing}
                      disabled={deleting}
                    >
                      {deleting ? (
                        <ActivityIndicator color={colors.danger} size="small" />
                      ) : (
                        <Text style={styles.deleteText}>Admin: elanı sil</Text>
                      )}
                    </Pressable>
                  </View>
                ) : null}
              </View>
            ) : (
              <View style={styles.actions}>
                <Pressable style={styles.ownerButton} onPress={loadParticipants}>
                  <Text style={styles.ownerButtonText}>İştirakçıları gör</Text>
                </Pressable>

                <Pressable
                  style={styles.deleteTextButton}
                  onPress={handleDeleteListing}
                  disabled={deleting}
                >
                  {deleting ? (
                    <ActivityIndicator color={colors.danger} size="small" />
                  ) : (
                    <Text style={styles.deleteText}>Elanı sil</Text>
                  )}
                </Pressable>

                {isAdmin ? (
                  <Pressable
                    style={styles.ownerButton}
                    onPress={() => {
                      setEditTitle(listing.title);
                      setEditDescription(listing.description ?? '');
                      setShowAdminEdit(true);
                    }}
                  >
                    <Text style={styles.ownerButtonText}>Admin: redaktə et</Text>
                  </Pressable>
                ) : null}

                {showParticipants ? (
                  <View style={styles.participantsBlock}>
                    {loadingParticipants ? (
                      <ActivityIndicator color={colors.accent} />
                    ) : participants.length === 0 ? null : (
                      participants.map((participant) => {
                        const profile = getParticipantProfile(participant);
                        const name = profile?.full_name?.trim() || 'İstifadəçi';
                        const statusMeta = STATUS_META[participant.status] ?? STATUS_META.pending;

                        return (
                          <View key={participant.id} style={styles.participantRow}>
                            {profile?.avatar_url ? (
                              <Image
                                source={{ uri: profile.avatar_url }}
                                style={styles.participantAvatar}
                              />
                            ) : (
                              <View style={styles.participantAvatarPlaceholder}>
                                <Text style={styles.participantAvatarInitial}>
                                  {name.charAt(0).toUpperCase()}
                                </Text>
                              </View>
                            )}

                            <View style={styles.participantInfo}>
                              <Text style={styles.participantName}>{name}</Text>
                              {participant.message?.trim() ? (
                                <Text style={styles.participantMessage}>
                                  {participant.message.trim()}
                                </Text>
                              ) : null}
                              <View
                                style={[
                                  styles.statusBadge,
                                  { backgroundColor: statusMeta.background },
                                ]}
                              >
                                <Text style={[styles.statusBadgeText, { color: statusMeta.color }]}>
                                  {statusMeta.label}
                                </Text>
                              </View>

                              {isOwner && participant.status === 'pending' ? (
                                <View style={styles.participantActions}>
                                  <Pressable
                                    style={styles.approveButton}
                                    disabled={updatingParticipantId === participant.id}
                                    onPress={() =>
                                      updateParticipantStatus(participant.id, 'approved')
                                    }
                                  >
                                    {updatingParticipantId === participant.id ? (
                                      <ActivityIndicator color={colors.success} size="small" />
                                    ) : (
                                      <Text style={styles.approveButtonText}>✓ Təsdiqlə</Text>
                                    )}
                                  </Pressable>
                                  <Pressable
                                    style={styles.rejectButton}
                                    disabled={updatingParticipantId === participant.id}
                                    onPress={() =>
                                      updateParticipantStatus(participant.id, 'rejected')
                                    }
                                  >
                                    <Text style={styles.rejectButtonText}>✗ Rədd et</Text>
                                  </Pressable>
                                </View>
                              ) : null}
                            </View>
                          </View>
                        );
                      })
                    )}
                  </View>
                ) : null}
              </View>
            )}

            {showAdminEdit ? (
              <View style={styles.reportForm}>
                <Text style={styles.reportTitle}>Admin: elanı redaktə et</Text>
                <TextInput
                  style={[styles.messageInput, { minHeight: 44 }]}
                  value={editTitle}
                  onChangeText={setEditTitle}
                  placeholder="Başlıq"
                  placeholderTextColor={colors.textMuted}
                />
                <TextInput
                  style={styles.messageInput}
                  value={editDescription}
                  onChangeText={setEditDescription}
                  placeholder="Təsvir"
                  placeholderTextColor={colors.textMuted}
                  multiline
                />
                <Pressable
                  style={[styles.primaryButton, savingEdit && styles.buttonDisabled]}
                  onPress={() => void handleAdminSave()}
                  disabled={savingEdit}
                >
                  {savingEdit ? (
                    <ActivityIndicator color={colors.textOnAccent} />
                  ) : (
                    <Text style={styles.primaryButtonText}>Yadda saxla</Text>
                  )}
                </Pressable>
                <Pressable onPress={() => setShowAdminEdit(false)}>
                  <Text style={styles.cancelReport}>Ləğv et</Text>
                </Pressable>
              </View>
            ) : null}
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
    overflow: 'hidden',
  },
  toastHost: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 36,
    zIndex: 30,
    alignItems: 'center',
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
    top: 14,
    right: 14,
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
  badge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginBottom: 12,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.text,
    marginBottom: 12,
    paddingRight: 36,
  },
  creatorActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 16,
  },
  creatorLeft: {
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
  },
  avatarPlaceholder: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.chipText,
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  ratingLoading: {
    fontSize: 11,
    color: colors.textMuted,
  },
  sideActions: {
    flexShrink: 0,
    alignItems: 'stretch',
    justifyContent: 'center',
    gap: 6,
    marginLeft: 'auto',
  },
  sideActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 10,
    minWidth: 128,
  },
  sideActionText: {
    color: colors.textOnAccent,
    fontWeight: '700',
    fontSize: 12,
  },
  whatsappButton: {
    backgroundColor: colors.whatsapp,
  },
  whatsappButtonDisabled: {
    backgroundColor: colors.textMuted,
    opacity: 0.9,
  },
  splitBillButton: {
    backgroundColor: colors.accent,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  detailLine: {
    fontSize: 14,
    color: colors.chipText,
    marginBottom: 6,
  },
  routeToggle: {
    marginTop: 4,
    marginBottom: 6,
    paddingVertical: 6,
  },
  routeToggleText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.accent,
  },
  poiItem: {
    fontSize: 13,
    color: colors.textSecondary,
    marginLeft: 8,
    marginBottom: 4,
  },
  muted: {
    fontSize: 13,
    color: colors.textMuted,
    marginBottom: 8,
  },
  inlineLoader: {
    alignSelf: 'flex-start',
    marginBottom: 8,
  },
  actions: {
    marginTop: 16,
    marginBottom: 20,
    gap: 10,
  },
  joinButton: {
    backgroundColor: colors.success,
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
  },
  joinButtonText: {
    color: colors.textOnAccent,
    fontWeight: '700',
    fontSize: 15,
  },
  disabledButton: {
    backgroundColor: colors.border,
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
  },
  disabledButtonText: {
    color: colors.textMuted,
    fontWeight: '700',
    fontSize: 15,
  },
  joinForm: {
    gap: 8,
  },
  messageInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    minHeight: 80,
    paddingHorizontal: 12,
    paddingVertical: 10,
    textAlignVertical: 'top',
    color: colors.text,
  },
  primaryButton: {
    backgroundColor: colors.accent,
    borderRadius: 16,
    paddingVertical: 13,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: colors.textOnAccent,
    fontWeight: '700',
    fontSize: 14,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  ownerButton: {
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: 16,
    paddingVertical: 13,
    alignItems: 'center',
  },
  ownerButtonText: {
    color: colors.accent,
    fontWeight: '700',
    fontSize: 14,
  },
  deleteTextButton: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  deleteText: {
    color: colors.danger,
    fontWeight: '700',
    fontSize: 14,
  },
  reportButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: '#FECACA',
    backgroundColor: '#FFF7F7',
    borderRadius: 16,
    paddingVertical: 12,
  },
  reportButtonText: {
    color: colors.dangerText,
    fontWeight: '700',
    fontSize: 14,
  },
  reportForm: {
    gap: 8,
    borderWidth: 1,
    borderColor: '#FECACA',
    backgroundColor: '#FFF7F7',
    borderRadius: 12,
    padding: 12,
  },
  reportTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#991B1B',
  },
  reasonChip: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  reasonChipSelected: {
    borderColor: colors.dangerText,
    backgroundColor: colors.dangerSoft,
  },
  reasonChipText: {
    color: colors.chipText,
    fontSize: 13,
    fontWeight: '600',
  },
  reasonChipTextSelected: {
    color: colors.dangerText,
  },
  reportSubmit: {
    backgroundColor: colors.dangerText,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  cancelReport: {
    textAlign: 'center',
    color: colors.textSecondary,
    fontWeight: '600',
    marginTop: 4,
  },
  adminActions: {
    gap: 8,
    marginTop: 4,
  },
  participantsBlock: {
    marginTop: 4,
    gap: 10,
  },
  participantRow: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 12,
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
  },
  participantAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  participantAvatarPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  participantAvatarInitial: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.chipText,
  },
  participantInfo: {
    flex: 1,
  },
  participantName: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  participantMessage: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 4,
  },
  statusBadge: {
    alignSelf: 'flex-start',
    marginTop: 8,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  statusBadgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  participantActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  approveButton: {
    borderRadius: 16,
    backgroundColor: colors.successSoft,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minWidth: 96,
    alignItems: 'center',
  },
  approveButtonText: {
    color: colors.success,
    fontWeight: '700',
    fontSize: 13,
  },
  rejectButton: {
    borderRadius: 16,
    backgroundColor: colors.dangerSoft,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minWidth: 96,
    alignItems: 'center',
  },
  rejectButtonText: {
    color: colors.dangerText,
    fontWeight: '700',
    fontSize: 13,
  },
  errorText: {
    marginTop: 12,
    color: colors.dangerText,
    fontSize: 13,
  },
  successText: {
    marginTop: 12,
    color: colors.success,
    fontSize: 13,
    fontWeight: '600',
  },
});
