import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRouter } from 'expo-router';
import { useMemo, useCallback, useEffect, useState } from 'react';
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { REGIONS } from '../constants/regions';
import { FavoriteButton } from './FavoriteButton';
import { SubscribeMenuButton } from './SubscribeMenuButton';
import { TransientHint } from './TransientHint';
import { notifyAdmins } from '../lib/adminNotify';
import { getErrorMessage } from '../lib/errors';
import { resolveSplitBillParamsForListing } from '../lib/expenseGroups';
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
import {
  listListingSubscribers,
  notifyParticipantStatus,
  notifyTourSubscribersUpdate,
  type ListingSubscriberRow,
} from '../lib/subscriptions';
import {
  getListingDisplayDescription,
  openStopInMaps,
  resolveListingRouteStops,
  stripRouteBlockFromDescription,
  type ListingRouteStop,
} from '../lib/listingRouteStops';
import { trackEvent } from '../lib/trackEvent';
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

import type { ThemeColors } from '../constants/theme';
import { createStyles } from './ListingDetailModal.styles';
import { useThemeColors } from '../theme/ThemeProvider';

export type ListingWithCreator = Listing & {
  creator: Pick<Profile, 'id' | 'full_name' | 'avatar_url' | 'phone' | 'is_verified'> | null;
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
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
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

function getStatusMeta(colors: ThemeColors): Record<
  ParticipantStatus,
  { label: string; background: string; color: string }
> {
  return {
  pending: { label: 'Gözləyir', background: colors.warningSoft, color: colors.warning },
  approved: { label: 'Təsdiqlənib', background: colors.successSoft, color: colors.success },
  rejected: { label: 'Rədd edilib', background: colors.dangerSoft, color: colors.dangerText },
  cancelled: { label: 'Ləğv edilib', background: colors.chip, color: colors.textSecondary },
};
}

function getTypeMeta(colors: ThemeColors): Record<
  ListingType,
  { label: string; icon: 'car' | 'map' | 'briefcase'; color: string; soft: string }
> {
  return {
  carpool: {
    label: 'Carpool',
    icon: 'car',
    color: colors.accent,
    soft: colors.accentSoft,
  },
  tour: {
    label: 'Tur',
    icon: 'map',
    color: colors.success,
    soft: colors.successSoft,
  },
  local_service: {
    label: 'Yerli xidmət',
    icon: 'briefcase',
    color: colors.warning,
    soft: colors.warningSoft,
  },
};
}

function InfoFact({
  icon,
  label,
  value,
}: {
  icon: 'map-marker' | 'calendar' | 'users' | 'money' | 'road' | 'refresh' | 'map';
  label: string;
  value: string;
}) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.infoFact}>
      <View style={styles.infoIconWrap}>
        <FontAwesome name={icon} size={13} color={colors.accent} />
      </View>
      <View style={styles.infoFactBody}>
        <Text style={styles.infoFactLabel}>{label}</Text>
        <Text style={styles.infoFactValue} numberOfLines={3}>
          {value}
        </Text>
      </View>
    </View>
  );
}

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
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const STATUS_META = useMemo(() => getStatusMeta(colors), [colors]);
  const TYPE_META = useMemo(() => getTypeMeta(colors), [colors]);
  const bottomSafe = Math.max(insets.bottom, 12);
  const router = useRouter();
  const { isAdmin } = useIsAdmin();
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [creatorRating, setCreatorRating] = useState<number | null>(null);
  const [routePois, setRoutePois] = useState<string[]>([]);
  const [routeStops, setRouteStops] = useState<ListingRouteStop[]>([]);
  const [routeListOpen, setRouteListOpen] = useState(false);
  const [loadingExtras, setLoadingExtras] = useState(false);
  const [subscribersOpen, setSubscribersOpen] = useState(false);
  const [subscribers, setSubscribers] = useState<ListingSubscriberRow[]>([]);
  const [loadingSubscribers, setLoadingSubscribers] = useState(false);
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
    if (routeStops.length === 0 && routePois.length === 0) {
      showInfoToast('Yer siyahısı yoxdur');
    }
  }, [visible, routeListOpen, loadingExtras, routeStops.length, routePois.length]);

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
      setShowJoinForm(false);
      setShowParticipants(false);
      setShowReportForm(false);
      setShowAdminEdit(false);
      setJoinMessage('');
      setReportDetails('');
      setRoutePois([]);
      setRouteStops([]);
      setRouteListOpen(false);
      setSubscribersOpen(false);
      setSubscribers([]);
      setCreatorRating(null);

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!isActive) {
        return;
      }

      setCurrentUserId(user?.id ?? null);

      const [listingRatingsResult, routePoisResult, routeStopsResult] =
        await Promise.all([
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
          listing!.type === 'tour' || listing!.type === 'carpool'
            ? supabase
                .from('listings')
                .select('route_stops, description')
                .eq('id', listing!.id)
                .maybeSingle()
            : Promise.resolve({ data: null, error: null }),
        ]);

      if (!isActive) {
        return;
      }

      const resolvedStops = resolveListingRouteStops({
        route_stops: routeStopsResult.error
          ? []
          : (routeStopsResult.data?.route_stops ?? listing!.route_stops ?? []),
        description: routeStopsResult.data?.description ?? listing!.description,
      });
      if (resolvedStops.length > 0) {
        setRouteStops(resolvedStops);
        setRoutePois(resolvedStops.map((s) => s.name));
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
        resolvedStops.length === 0 &&
        (listing!.type === 'tour' || listing!.type === 'carpool') &&
        !routePoisResult.error
      ) {
        const rpcRows = Array.isArray(routePoisResult.data) ? routePoisResult.data : [];
        if (rpcRows.length > 0) {
          const names = rpcRows
            .map((row: { name?: string | null }) => row.name)
            .filter((name): name is string => Boolean(name));
          setRoutePois(names);
          setRouteStops(names.map((name) => ({ name, lat: null, lng: null })));
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
              const names = poiIds
                .map((id) => nameById.get(id) ?? id)
                .filter(Boolean) as string[];
              setRoutePois(names);
              setRouteStops(names.map((name) => ({ name, lat: null, lng: null })));
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

      void trackEvent('listing_join', { listingId: listing.id, type: listing.type });
      showInfoToast('Sorğunuz göndərildi, təsdiq gözlənilir');
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

    const participant = participants.find((row) => row.id === participantId);

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

    if (listing && participant?.user_id && currentUserId) {
      void notifyParticipantStatus({
        userId: participant.user_id,
        listingId: listing.id,
        listingTitle: listing.title,
        approved: status === 'approved',
        actorId: currentUserId,
      });
    }
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
    const { error, reportId } = await reportListing({
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
    showInfoToast('Şikayətiniz qəbul olundu');
    const reasonLabel =
      LISTING_REPORT_REASONS.find((item) => item.id === reportReason)?.label ?? reportReason;
    void notifyAdmins(
      'listing_report',
      `"${listing.title}" — ${reasonLabel}`,
      reportId
    );
  }

  async function handleAdminSave() {
    if (!listing || savingEdit) {
      return;
    }
    setSavingEdit(true);
    setErrorMessage(null);
    const { error } = await updateListingAsAdmin(listing.id, {
      title: editTitle.trim(),
      description: stripRouteBlockFromDescription(editDescription) || null,
    });
    setSavingEdit(false);
    if (error) {
      setErrorMessage(error);
      return;
    }
    setShowAdminEdit(false);
    showInfoToast('Elan yeniləndi');
    if (listing.type === 'tour' && currentUserId) {
      void notifyTourSubscribersUpdate({
        listingId: listing.id,
        title: editTitle.trim() || listing.title,
        actorId: currentUserId,
      });
    }
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
  const displayDescription = getListingDisplayDescription(listing);

  async function toggleSubscribersPanel() {
    const next = !subscribersOpen;
    setSubscribersOpen(next);
    if (!next || !listing) {
      return;
    }
    setLoadingSubscribers(true);
    const result = await listListingSubscribers(listing.id);
    setLoadingSubscribers(false);
    if (result.error) {
      setErrorMessage(result.error);
      setSubscribers([]);
      return;
    }
    setSubscribers(result.data);
    if (result.data.length === 0) {
      showInfoToast('Hələ abunə yoxdur');
    }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={[styles.sheet, { paddingBottom: bottomSafe }]}>
          <View style={styles.handle} />
          <View style={styles.sheetHeader}>
            <View style={styles.headerFavWrap}>
              <FavoriteButton targetType="listing" targetId={listing.id} size={18} />
            </View>
            <Pressable onPress={onClose} style={styles.closeButton} hitSlop={12}>
              <FontAwesome name="times" size={16} color={colors.textMuted} />
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
            <Pressable
              style={styles.creatorHeader}
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
                <View style={[styles.avatarPlaceholder, styles.avatarAccent]}>
                  <Text style={styles.avatarInitialAccent}>
                    {creatorName.charAt(0).toUpperCase()}
                  </Text>
                </View>
              )}
              <View style={styles.creatorMeta}>
                <View style={styles.creatorNameRow}>
                  <Text style={styles.creatorNameLg} numberOfLines={1}>
                    {creatorName}
                  </Text>
                  {listing.creator?.is_verified ? (
                    <FontAwesome name="check-circle" size={14} color={colors.success} />
                  ) : null}
                </View>
                <CreatorStarRating value={creatorRating} loading={loadingExtras} />
              </View>
            </Pressable>

            <View style={[styles.badge, { backgroundColor: meta.soft }]}>
              <FontAwesome name={meta.icon} size={11} color={meta.color} />
              <Text style={[styles.badgeText, { color: meta.color }]}>{meta.label}</Text>
            </View>

            <Text style={styles.title} numberOfLines={2} ellipsizeMode="tail">
              {listing.title}
            </Text>

            {displayDescription ? (
              <View style={styles.descriptionCard}>
                <Text style={styles.descriptionText}>{displayDescription}</Text>
              </View>
            ) : null}

            <View style={styles.quickActionsRow}>
              <Pressable
                style={[
                  styles.quickActionBtn,
                  styles.whatsappButton,
                  !contactDisplayPhone && styles.whatsappButtonDisabled,
                ]}
                onPress={openWhatsApp}
              >
                <FontAwesome name="whatsapp" size={16} color="#FFFFFF" />
                <Text style={styles.quickActionText} numberOfLines={1}>
                  {contactDisplayPhone ? "WhatsApp'a yaz" : 'Nömrə yox'}
                </Text>
              </Pressable>

              <Pressable
                style={[styles.quickActionBtn, styles.splitBillButton]}
                onPress={() => {
                  onClose();
                  void (async () => {
                    const params = await resolveSplitBillParamsForListing(listing.id);
                    router.push({
                      pathname: '/split-bill',
                      params,
                    } as never);
                  })();
                }}
              >
                <FontAwesome name="paper-plane" size={14} color="#FFFFFF" />
                <Text style={styles.quickActionText}>Xərc bölüşdür</Text>
              </Pressable>
            </View>

            <Text style={styles.sectionLabel}>MƏLUMAT</Text>

            <View style={styles.infoGrid}>
              {listing.type === 'carpool' ? (
                <>
                  <InfoFact icon="map-marker" label="Region" value={regionLabel} />
                  <InfoFact
                    icon="calendar"
                    label="Nə vaxt"
                    value={formatDate(listing.departure_at)}
                  />
                  <InfoFact
                    icon="users"
                    label="İştirakçı"
                    value={`${joinedCount} / ${capacity || '—'}`}
                  />
                  <InfoFact icon="money" label="Qiymət" value={formatPrice(listing)} />
                  <InfoFact icon="road" label="Marşrut" value={`${listing.origin_text || '—'} → ${listing.destination_text || '—'}`} />
                </>
              ) : null}

              {listing.type === 'tour' ? (
                <>
                  <InfoFact icon="map" label="Region" value={regionLabel} />
                  <InfoFact
                    icon="calendar"
                    label="Nə vaxt"
                    value={formatDate(listing.departure_at)}
                  />
                  <InfoFact
                    icon="users"
                    label="İştirakçı"
                    value={`${joinedCount} / ${capacity || '—'}`}
                  />
                  <InfoFact icon="money" label="Qiymət" value={formatPrice(listing)} />
                </>
              ) : null}

              {listing.type === 'local_service' ? (
                <>
                  <InfoFact icon="map" label="Region" value={regionLabel} />
                  <InfoFact icon="money" label="Qiymət" value={formatPrice(listing)} />
                  {listing.is_recurring ? (
                    <InfoFact icon="refresh" label="Rejim" value="Daimi xidmət" />
                  ) : null}
                </>
              ) : null}
            </View>

            {(listing.type === 'tour' || listing.type === 'carpool') ? (
              <View style={styles.metaLinksRow}>
                <Pressable
                  style={[
                    styles.metaActionBtn,
                    listing.type === 'tour' && !isOwner && currentUserId
                      ? null
                      : styles.metaActionBtnSolo,
                  ]}
                  onPress={() => setRouteListOpen((open) => !open)}
                >
                  <FontAwesome
                    name={routeListOpen ? 'chevron-down' : 'chevron-right'}
                    size={12}
                    color={colors.brand}
                  />
                  <Text style={styles.routeToggleText}>
                    Marşrut
                    {routeStops.length > 0
                      ? ` · ${routeStops.length}`
                      : routePois.length > 0
                        ? ` · ${routePois.length}`
                        : ''}
                  </Text>
                </Pressable>

                {listing.type === 'tour' && !isOwner && currentUserId ? (
                  <SubscribeMenuButton
                    expandable
                    rowPartner
                    listingId={listing.id}
                    organizerId={
                      listing.created_by && listing.created_by !== currentUserId
                        ? listing.created_by
                        : null
                    }
                  />
                ) : null}
              </View>
            ) : null}

            {listing.type === 'tour' || listing.type === 'carpool' ? (
              <>
                {routeListOpen ? (
                  loadingExtras ? (
                    <ActivityIndicator color={colors.accent} style={styles.inlineLoader} />
                  ) : routeStops.length > 0 ? (
                    <View style={styles.routeListCard}>
                      {routeStops.map((stop, index) => (
                        <Pressable
                          key={`${stop.name}-${index}`}
                          style={[
                            styles.poiItemRow,
                            index < routeStops.length - 1 && styles.poiItemBorder,
                          ]}
                          onPress={() =>
                            void openStopInMaps(stop).catch((err) =>
                              setErrorMessage(getErrorMessage(err))
                            )
                          }
                        >
                          <View style={styles.poiIndex}>
                            <Text style={styles.poiIndexText}>{index + 1}</Text>
                          </View>
                          <Text style={styles.poiItem} numberOfLines={2}>
                            {stop.name}
                          </Text>
                          <FontAwesome name="map-marker" size={13} color={colors.accent} />
                        </Pressable>
                      ))}
                    </View>
                  ) : routePois.length === 0 ? null : (
                    <View style={styles.routeListCard}>
                      {routePois.map((name, index) => (
                        <Text
                          key={`${name}-${index}`}
                          style={[styles.poiItem, styles.poiItemPad]}
                        >
                          {index + 1}. {name}
                        </Text>
                      ))}
                    </View>
                  )
                ) : null}
              </>
            ) : null}

            {listing.type === 'tour' && isOwner ? (
              <View style={styles.subscribersWrap}>
                <Pressable
                  style={styles.subscribersPill}
                  onPress={() => void toggleSubscribersPanel()}
                  accessibilityLabel="Abunəçilər"
                >
                  <FontAwesome name="bell" size={14} color={colors.accentPressed} />
                  <Text style={styles.subscribersPillText}>
                    Abunəçilər
                    {subscribersOpen && !loadingSubscribers
                      ? ` · ${subscribers.length}`
                      : ''}
                  </Text>
                  <FontAwesome
                    name={subscribersOpen ? 'chevron-up' : 'chevron-down'}
                    size={11}
                    color={colors.textMuted}
                  />
                </Pressable>
                {subscribersOpen ? (
                  loadingSubscribers ? (
                    <ActivityIndicator color={colors.accent} style={styles.inlineLoader} />
                  ) : subscribers.length === 0 ? (
                    <Text style={styles.subscribersEmpty}>Hələ heç kim abunə olmayıb</Text>
                  ) : (
                    <View style={styles.subscribersPanel}>
                      {subscribers.map((sub, index) => {
                        const name = sub.full_name?.trim() || 'İstifadəçi';
                        return (
                          <Pressable
                            key={sub.id}
                            style={[
                              styles.subscriberRow,
                              index > 0 && styles.subscriberRowBorder,
                            ]}
                            onPress={() => {
                              onClose();
                              router.push({
                                pathname: '/(tabs)/profil',
                                params: { userId: sub.user_id },
                              });
                            }}
                          >
                            {sub.avatar_url ? (
                              <Image
                                source={{ uri: sub.avatar_url }}
                                style={styles.subscriberAvatar}
                              />
                            ) : (
                              <View style={styles.subscriberAvatarPlaceholder}>
                                <Text style={styles.subscriberAvatarInitial}>
                                  {name.charAt(0).toUpperCase()}
                                </Text>
                              </View>
                            )}
                            <Text style={styles.subscriberName} numberOfLines={1}>
                              {name}
                            </Text>
                            <FontAwesome
                              name="chevron-right"
                              size={11}
                              color={colors.textMuted}
                            />
                          </Pressable>
                        );
                      })}
                    </View>
                  )
                ) : null}
              </View>
            ) : null}

            {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}

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
                        setEditDescription(
                          stripRouteBlockFromDescription(listing.description)
                        );
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
                      setEditDescription(
                        stripRouteBlockFromDescription(listing.description)
                      );
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

          <View style={[styles.toastHost, { bottom: bottomSafe + 12 }]} pointerEvents="none">
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

