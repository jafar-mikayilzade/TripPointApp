import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getErrorMessage } from '../lib/errors';
import {
  createExpenseGroup,
  fetchGroupDetail,
  fetchUserGroupCards,
  findActiveGroupForListing,
  type ExpenseGroupCard,
} from '../lib/expenseGroups';
import { shareSplitBillPdf } from '../lib/shareSplitBill';
import {
  calculateMemberBalances,
  calculateSettlements,
  formatCardNumber,
  normalizeCardNumber,
  sumExpenses,
} from '../lib/splitBill';
import { supabase } from '../lib/supabase';
import {
  confirmDelete,
  deleteExpense,
  deleteExpenseGroup,
} from '../lib/userContentDelete';
import type {
  Expense,
  ExpenseGroup,
  ExpenseGroupStatus,
  Listing,
  Profile,
} from '../types/database';

import { colors } from '../constants/theme';

type MemberProfile = Pick<Profile, 'id' | 'full_name' | 'phone'>;

type ExpenseRow = Expense & {
  payerName: string;
};

type GroupCard = ExpenseGroupCard;

function formatMoney(amount: number): string {
  return `${amount.toFixed(2)}₼`;
}

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

function statusLabel(status: ExpenseGroupStatus): string {
  return status === 'settled' ? 'Hesablanıb' : 'Aktiv';
}

function normalizeParam(value: string | string[] | undefined): string | null {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  if (Array.isArray(value) && value[0]?.trim()) {
    return value[0].trim();
  }
  return null;
}

export default function SplitBillScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ groupId?: string | string[]; listingId?: string | string[] }>();
  const paramGroupId = normalizeParam(params.groupId);
  const paramListingId = normalizeParam(params.listingId);

  const [authUserId, setAuthUserId] = useState<string | null>(null);
  const [groups, setGroups] = useState<GroupCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(paramGroupId);
  const [group, setGroup] = useState<ExpenseGroup | null>(null);
  const [members, setMembers] = useState<MemberProfile[]>([]);
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  const [createVisible, setCreateVisible] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [myListings, setMyListings] = useState<Pick<Listing, 'id' | 'title'>[]>([]);
  const [selectedListingId, setSelectedListingId] = useState<string | null>(paramListingId);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [expenseVisible, setExpenseVisible] = useState(false);
  const [paidBy, setPaidBy] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [savingExpense, setSavingExpense] = useState(false);
  const [expenseError, setExpenseError] = useState<string | null>(null);
  const [settling, setSettling] = useState(false);
  const [paymentCard, setPaymentCard] = useState<string | null>(null);
  const [listingRegion, setListingRegion] = useState<string | null>(null);
  const [cardDraft, setCardDraft] = useState('');
  const [savingCard, setSavingCard] = useState(false);
  const [cardEditVisible, setCardEditVisible] = useState(false);

  const loadGroups = useCallback(async () => {
    setLoading(true);
    setErrorMessage(null);

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      setErrorMessage(userError ? getErrorMessage(userError) : 'Daxil olmaq lazımdır.');
      setLoading(false);
      return;
    }

    setAuthUserId(user.id);

    try {
      setGroups(await fetchUserGroupCards(user.id));
    } catch (err) {
      setErrorMessage(getErrorMessage(err));
      setGroups([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadGroupDetailGen = useRef(0);

  const loadGroupDetail = useCallback(async (groupId: string) => {
    const gen = ++loadGroupDetailGen.current;
    setDetailLoading(true);
    setErrorMessage(null);

    try {
      const detail = await fetchGroupDetail(groupId);
      if (gen !== loadGroupDetailGen.current) {
        return;
      }
      if (!detail) {
        setErrorMessage('Qrup tapılmadı.');
        setGroup(null);
        setMembers([]);
        setExpenses([]);
        return;
      }
      setGroup(detail.group);
      setMembers(detail.members);
      setExpenses(detail.expenses);
      setPaymentCard(detail.paymentCard);
      setListingRegion(detail.listingRegion);
    } catch (err) {
      if (gen !== loadGroupDetailGen.current) {
        return;
      }
      setErrorMessage(getErrorMessage(err));
    } finally {
      if (gen === loadGroupDetailGen.current) {
        setDetailLoading(false);
      }
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadGroups();
      if (paramGroupId) {
        setSelectedGroupId(paramGroupId);
        return;
      }
      if (paramListingId) {
        void (async () => {
          const existingId = await findActiveGroupForListing(paramListingId);
          if (existingId) {
            setSelectedGroupId(existingId);
            setCreateVisible(false);
          } else {
            setSelectedListingId(paramListingId);
            setCreateVisible(true);
          }
        })();
      }
    }, [loadGroups, paramGroupId, paramListingId])
  );

  useFocusEffect(
    useCallback(() => {
      if (!selectedGroupId) {
        return;
      }
      void loadGroupDetail(selectedGroupId);

      const channel = supabase
        .channel(`expense-group-${selectedGroupId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'expenses',
            filter: `group_id=eq.${selectedGroupId}`,
          },
          () => {
            void loadGroupDetail(selectedGroupId);
          }
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'expense_group_members',
            filter: `group_id=eq.${selectedGroupId}`,
          },
          () => {
            void loadGroupDetail(selectedGroupId);
          }
        )
        .subscribe();

      return () => {
        void supabase.removeChannel(channel);
      };
    }, [loadGroupDetail, selectedGroupId])
  );

  const splitMembers = useMemo(
    () =>
      members.map((member) => ({
        id: member.id,
        name: member.full_name?.trim() || 'İstifadəçi',
        phone: member.phone,
      })),
    [members]
  );

  const splitExpenses = useMemo(
    () =>
      expenses.map((expense) => ({
        paid_by: expense.paid_by,
        amount: expense.amount,
      })),
    [expenses]
  );

  const settlements = useMemo(
    () => calculateSettlements(splitMembers, splitExpenses),
    [splitMembers, splitExpenses]
  );

  const { fairShare, balances } = useMemo(
    () => calculateMemberBalances(splitMembers, splitExpenses),
    [splitMembers, splitExpenses]
  );

  const totalAmount = useMemo(() => sumExpenses(expenses), [expenses]);
  const isGroupOwner = Boolean(authUserId && group?.created_by === authUserId);

  async function openCreateModal() {
    setCreateError(null);
    setGroupName('');
    setSelectedListingId(paramListingId);
    setCreateVisible(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return;
    }

    const { data, error } = await supabase
      .from('listings')
      .select('id, title')
      .eq('created_by', user.id)
      .order('created_at', { ascending: false });

    if (error) {
      setCreateError(getErrorMessage(error));
      setMyListings([]);
      return;
    }

    setMyListings(data ?? []);
  }

  async function createGroup() {
    if (!groupName.trim()) {
      setCreateError('Qrup adı məcburidir.');
      return;
    }

    setCreating(true);
    setCreateError(null);

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      setCreateError(userError ? getErrorMessage(userError) : 'Daxil olmaq lazımdır.');
      setCreating(false);
      return;
    }

    const { groupId, error } = await createExpenseGroup({
      name: groupName.trim(),
      listingId: selectedListingId,
      userId: user.id,
    });

    setCreating(false);

    if (!groupId) {
      setCreateError(error || 'Qrup yaradılmadı.');
      return;
    }

    if (error) {
      setCreateError(error);
    }

    setCreateVisible(false);
    await loadGroups();
    setSelectedGroupId(groupId);
  }

  async function shareGroupPdf() {
    if (!group) {
      return;
    }
    try {
      await shareSplitBillPdf({
        groupName: group.name,
        region: listingRegion,
        totalAmount,
        fairShare,
        expenses: expenses.map((item) => ({
          title: item.description,
          amount: item.amount,
          payerName: item.payerName,
          createdAt: item.created_at,
        })),
        balances,
        settlements,
      });
    } catch (err) {
      const message = getErrorMessage(err);
      if (!/dismiss|cancel|ləğv/i.test(message)) {
        setErrorMessage(message);
      }
    }
  }

  async function copyPaymentCard() {
    if (!paymentCard) {
      return;
    }
    try {
      // expo-clipboard native rebuild tələb edir — Share ilə kopyalama/paylaşım
      await Share.share({
        message: paymentCard,
        title: 'Kart nömrəsi',
      });
    } catch (err) {
      // İstifadəçi ləğv edibsə səssiz keç
      const message = getErrorMessage(err);
      if (!/dismiss|cancel|ləğv/i.test(message)) {
        setErrorMessage(message);
      }
    }
  }

  async function savePaymentCard() {
    if (!group?.listing_id || !isGroupOwner) {
      return;
    }
    const digits = normalizeCardNumber(cardDraft);
    if (digits.length > 0 && digits.length !== 16) {
      Alert.alert('Kart', 'Kart nömrəsi 16 rəqəm olmalıdır (və ya boş saxlayın).');
      return;
    }

    setSavingCard(true);
    const { error } = await supabase
      .from('listings')
      .update({ payment_card: digits.length === 16 ? digits : null })
      .eq('id', group.listing_id)
      .eq('created_by', authUserId ?? '');

    setSavingCard(false);

    if (error) {
      setErrorMessage(getErrorMessage(error));
      return;
    }

    setPaymentCard(digits.length === 16 ? digits : null);
    setCardEditVisible(false);
  }

  function openExpenseModal() {
    setExpenseError(null);
    setAmount('');
    setDescription('');
    setPaidBy(authUserId);
    setExpenseVisible(true);
  }

  async function addExpense() {
    if (!selectedGroupId || !paidBy) {
      setExpenseError('Ödəyən seçin.');
      return;
    }

    const parsed = Number(amount.replace(',', '.'));
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setExpenseError('Düzgün məbləğ daxil edin.');
      return;
    }

    if (!description.trim()) {
      setExpenseError('Nə üçün sahəsi məcburidir.');
      return;
    }

    setSavingExpense(true);
    setExpenseError(null);

    const { error } = await supabase.from('expenses').insert({
      group_id: selectedGroupId,
      paid_by: paidBy,
      amount: parsed,
      description: description.trim(),
    });

    setSavingExpense(false);

    if (error) {
      setExpenseError(getErrorMessage(error));
      return;
    }

    setExpenseVisible(false);
    await loadGroupDetail(selectedGroupId);
    await loadGroups();
  }

  async function markSettled() {
    if (!selectedGroupId || !group) {
      return;
    }

    setSettling(true);
    const { error } = await supabase
      .from('expense_groups')
      .update({ status: 'settled' })
      .eq('id', selectedGroupId);

    setSettling(false);

    if (error) {
      setErrorMessage(getErrorMessage(error));
      return;
    }

    await loadGroupDetail(selectedGroupId);
    await loadGroups();
  }

  async function remindOnWhatsApp(toName: string, toPhone: string | null, fromName: string, amountValue: number) {
    const text = encodeURIComponent(
      `Salam ${toName}! TripPoint xərc bölüşdürücüdə ${fromName} sənə ${formatMoney(amountValue)} borcludur.`
    );
    const phone = toPhone?.replace(/[^\d]/g, '') ?? '';
    const url = phone ? `https://wa.me/${phone}?text=${text}` : `https://wa.me/?text=${text}`;

    try {
      await Linking.openURL(url);
    } catch (err) {
      setErrorMessage(getErrorMessage(err));
    }
  }

  async function handleDeleteExpense(expenseId: string) {
    if (!selectedGroupId) {
      return;
    }

    const confirmed = await confirmDelete(
      'Xərci sil',
      'Bu xərci silmək istədiyinizə əminsiniz?'
    );
    if (!confirmed) {
      return;
    }

    const { error } = await deleteExpense(expenseId);
    if (error) {
      setErrorMessage(error);
      return;
    }

    await loadGroupDetail(selectedGroupId);
    await loadGroups();
  }

  async function handleDeleteGroup(groupId: string) {
    const confirmed = await confirmDelete(
      'Qrupu sil',
      'Bu qrupu və bütün xərclərini silmək istədiyinizə əminsiniz?'
    );
    if (!confirmed) {
      return;
    }

    const { error } = await deleteExpenseGroup(groupId);
    if (error) {
      setErrorMessage(error);
      return;
    }

    if (selectedGroupId === groupId) {
      setSelectedGroupId(null);
      setGroup(null);
    }
    await loadGroups();
  }

  if (selectedGroupId) {
    return (
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 64 : 0}
      >
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <Pressable
            style={styles.backButton}
            onPress={() => {
              setSelectedGroupId(null);
              setGroup(null);
              setPaymentCard(null);
              setMembers([]);
              setExpenses([]);
            }}
            hitSlop={8}
          >
            <FontAwesome name="chevron-left" size={14} color={colors.accent} />
            <Text style={styles.backText}>Qruplar</Text>
          </Pressable>
        </View>

        {detailLoading || !group ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={colors.accent} />
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <Text style={styles.title} numberOfLines={2}>
              {group.name}
            </Text>
            <Text style={styles.totalText}>Ümumi: {formatMoney(totalAmount)}</Text>
            <View
              style={[
                styles.statusBadge,
                { backgroundColor: group.status === 'settled' ? colors.successSoft : '#DBEAFE' },
              ]}
            >
              <Text
                style={[
                  styles.statusText,
                  { color: group.status === 'settled' ? '#166534' : colors.accentPressed },
                ]}
              >
                {statusLabel(group.status)}
              </Text>
            </View>

            {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}

            {group.status === 'active' ? (
              <Pressable style={styles.primaryButton} onPress={openExpenseModal}>
                <Text style={styles.primaryButtonText}>Xərc əlavə et</Text>
              </Pressable>
            ) : null}

            <Pressable style={styles.pdfButton} onPress={() => void shareGroupPdf()}>
              <FontAwesome name="file-pdf-o" size={14} color={colors.accent} />
              <Text style={styles.pdfButtonText}>PDF paylaş</Text>
            </Pressable>

            <Text style={styles.sectionTitle}>Xərclər</Text>
            {expenses.length === 0 ? (
              <Text style={styles.emptyText}>Hələ xərc yoxdur</Text>
            ) : (
              expenses.map((item) => (
                <View key={item.id} style={styles.card}>
                  <Text style={styles.cardTitle} numberOfLines={2} ellipsizeMode="tail">
                    {item.description}
                  </Text>
                  <Text style={styles.metaLine}>👤 {item.payerName}</Text>
                  <Text style={styles.metaLine}>💰 {formatMoney(item.amount)}</Text>
                  <Text style={styles.metaLine}>📅 {formatDate(item.created_at)}</Text>
                  {authUserId &&
                  (item.paid_by === authUserId || isGroupOwner) ? (
                    <Pressable
                      style={styles.deleteTextButton}
                      onPress={() => {
                        void handleDeleteExpense(item.id);
                      }}
                      hitSlop={8}
                    >
                      <Text style={styles.deleteText}>Xərci sil</Text>
                    </Pressable>
                  ) : null}
                </View>
              ))
            )}

            <Text style={styles.sectionTitle}>Adambaşı hesab</Text>
            <Text style={styles.metaLine}>
              Ümumi {formatMoney(totalAmount)} · {members.length} nəfər · adambaşı{' '}
              {formatMoney(fairShare)}
            </Text>
            {balances.length === 0 ? (
              <Text style={styles.emptyText}>Üzv yoxdur</Text>
            ) : (
              balances.map((row) => (
                <View key={row.id} style={styles.balanceCard}>
                  <Text style={styles.cardTitle} numberOfLines={1}>
                    {row.name}
                  </Text>
                  <Text style={styles.metaLine}>Ödəyib: {formatMoney(row.paid)}</Text>
                  <Text
                    style={[
                      styles.balanceLine,
                      row.balance > 0.009
                        ? styles.balanceCredit
                        : row.balance < -0.009
                          ? styles.balanceDebt
                          : styles.balanceEven,
                    ]}
                  >
                    {row.balance > 0.009
                      ? `Alacağı: ${formatMoney(row.balance)}`
                      : row.balance < -0.009
                        ? `Verəcəyi: ${formatMoney(Math.abs(row.balance))}`
                        : 'Bərabər'}
                  </Text>
                </View>
              ))
            )}

            <Text style={styles.sectionTitle}>Kim kimə ödəsin?</Text>
            {settlements.length === 0 ? (
              <Text style={styles.emptyText}>Hamı bərabərdir — borc yoxdur</Text>
            ) : (
              settlements.map((item, index) => (
                <View key={`${item.fromUserId}-${item.toUserId}-${index}`} style={styles.settleCard}>
                  <Text style={styles.settleText}>
                    {item.fromName} → {item.toName}: {formatMoney(item.amount)}
                  </Text>
                  <Pressable
                    style={styles.whatsappButton}
                    onPress={() =>
                      remindOnWhatsApp(item.toName, item.toPhone, item.fromName, item.amount)
                    }
                  >
                    <FontAwesome name="whatsapp" size={14} color={colors.textOnAccent} />
                    <Text style={styles.whatsappText}>WhatsApp-da xatırlat</Text>
                  </Pressable>
                </View>
              ))
            )}

            {group.listing_id ? (
              <>
                <Text style={styles.sectionTitle}>Ödəniş kartı</Text>
                {paymentCard ? (
                  <View style={styles.cardBox}>
                    <Text style={styles.cardHint}>
                      Uzun basıb kopyalaya bilərsiniz və ya düymə ilə paylaşın
                    </Text>
                    <TextInput
                      style={styles.cardNumberInput}
                      value={formatCardNumber(paymentCard)}
                      editable={false}
                      selectTextOnFocus
                    />
                    <Pressable style={styles.copyButton} onPress={() => void copyPaymentCard()}>
                      <FontAwesome name="share" size={13} color={colors.textOnAccent} />
                      <Text style={styles.copyButtonText}>Paylaş / Kopyala</Text>
                    </Pressable>
                  </View>
                ) : (
                  <Text style={styles.emptyText}>
                    {isGroupOwner
                      ? 'Kart hələ əlavə olunmayıb.'
                      : 'Elan sahibi kart paylaşmayıb.'}
                  </Text>
                )}
                {isGroupOwner ? (
                  <Pressable
                    style={styles.secondaryButton}
                    onPress={() => {
                      setCardDraft(paymentCard ? formatCardNumber(paymentCard) : '');
                      setCardEditVisible(true);
                    }}
                  >
                    <Text style={styles.secondaryButtonText}>
                      {paymentCard ? 'Kartı dəyiş' : 'Kart əlavə et'}
                    </Text>
                  </Pressable>
                ) : null}
              </>
            ) : null}

            {group.status === 'active' ? (
              <Pressable
                style={[styles.settleButton, settling && styles.disabled]}
                onPress={markSettled}
                disabled={settling}
              >
                {settling ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.primaryButtonText}>Hesablandı</Text>
                )}
              </Pressable>
            ) : null}

            {isGroupOwner ? (
              <Pressable
                style={styles.deleteGroupButton}
                onPress={() => {
                  void handleDeleteGroup(group.id);
                }}
                hitSlop={8}
              >
                <Text style={styles.deleteText}>Qrupu sil</Text>
              </Pressable>
            ) : null}
          </ScrollView>
        )}

        <Modal
          visible={cardEditVisible}
          transparent
          animationType="slide"
          onRequestClose={() => setCardEditVisible(false)}
        >
          <KeyboardAvoidingView
            style={styles.modalOverlay}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          >
            <View style={styles.modalSheet}>
              <Text style={styles.modalTitle}>Ödəniş kartı</Text>
              <Text style={styles.metaLine}>
                16 rəqəm — elanın üzvləri görüb kopyalaya bilər.
              </Text>
              <TextInput
                style={styles.input}
                value={cardDraft}
                onChangeText={(text) => setCardDraft(formatCardNumber(text))}
                placeholder="ACCT-000003"
                placeholderTextColor={colors.textMuted}
                keyboardType="number-pad"
                maxLength={19}
              />
              <View style={styles.modalActions}>
                <Pressable
                  style={styles.secondaryButton}
                  onPress={() => setCardEditVisible(false)}
                  disabled={savingCard}
                >
                  <Text style={styles.secondaryButtonText}>Ləğv et</Text>
                </Pressable>
                <Pressable
                  style={[styles.primaryButton, styles.flexOne, savingCard && styles.disabled]}
                  onPress={() => {
                    void savePaymentCard();
                  }}
                  disabled={savingCard}
                >
                  {savingCard ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.primaryButtonText}>Yadda saxla</Text>
                  )}
                </Pressable>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>

        <Modal
          visible={expenseVisible}
          transparent
          animationType="slide"
          onRequestClose={() => setExpenseVisible(false)}
        >
          <KeyboardAvoidingView
            style={styles.modalOverlay}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          >
            <View style={styles.modalSheet}>
              <Text style={styles.modalTitle}>Xərc əlavə et</Text>
              {expenseError ? <Text style={styles.errorText}>{expenseError}</Text> : null}

              <Text style={styles.label}>Kim ödədi</Text>
              <View style={styles.chipWrap}>
                {members.map((member) => {
                  const selected = paidBy === member.id;
                  const name = member.full_name?.trim() || 'İstifadəçi';
                  return (
                    <Pressable
                      key={member.id}
                      style={[styles.chip, selected && styles.chipSelected]}
                      onPress={() => setPaidBy(member.id)}
                    >
                      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                        {name}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={styles.label}>Məbləğ</Text>
              <TextInput
                style={styles.input}
                value={amount}
                onChangeText={setAmount}
                placeholder="0.00"
                placeholderTextColor={colors.textMuted}
                keyboardType="decimal-pad"
              />

              <Text style={styles.label}>Nə üçün</Text>
              <TextInput
                style={styles.input}
                value={description}
                onChangeText={setDescription}
                placeholder="Yemək, yanacaq..."
                placeholderTextColor={colors.textMuted}
              />

              <View style={styles.modalActions}>
                <Pressable
                  style={styles.secondaryButton}
                  onPress={() => setExpenseVisible(false)}
                  disabled={savingExpense}
                >
                  <Text style={styles.secondaryButtonText}>Ləğv et</Text>
                </Pressable>
                <Pressable
                  style={[styles.primaryButton, styles.flexOne, savingExpense && styles.disabled]}
                  onPress={addExpense}
                  disabled={savingExpense}
                >
                  {savingExpense ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.primaryButtonText}>Göndər</Text>
                  )}
                </Pressable>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>
      </View>
      </KeyboardAvoidingView>
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
        <Pressable style={styles.addButton} onPress={openCreateModal}>
          <FontAwesome name="plus" size={12} color="#fff" />
          <Text style={styles.addButtonText}>Yeni Qrup</Text>
        </Pressable>
      </View>

      <Text style={styles.screenTitle}>Xərc Bölüşdürücü</Text>

      {errorMessage ? <Text style={[styles.errorText, { marginHorizontal: 16 }]}>{errorMessage}</Text> : null}

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {groups.length === 0 ? (
            <Text style={styles.emptyText}>Hələ qrup yoxdur. Yeni qrup yaradın.</Text>
          ) : (
            groups.map((item) => (
              <View key={item.id} style={styles.card}>
                <Pressable onPress={() => setSelectedGroupId(item.id)}>
                  <Text style={styles.cardTitle} numberOfLines={2} ellipsizeMode="tail">
                    {item.name}
                  </Text>
                  <Text style={styles.metaLine}>👥 {item.memberCount} üzv</Text>
                  <Text style={styles.metaLine}>💰 {formatMoney(item.totalAmount)}</Text>
                  <Text style={styles.metaLine}>
                    {item.status === 'settled' ? '✅ Hesablanıb' : '🔵 Aktiv'}
                  </Text>
                </Pressable>
                {authUserId && item.created_by === authUserId ? (
                  <Pressable
                    style={styles.deleteGroupButton}
                    onPress={() => {
                      void handleDeleteGroup(item.id);
                    }}
                    hitSlop={8}
                  >
                    <Text style={styles.deleteText}>Qrupu sil</Text>
                  </Pressable>
                ) : null}
              </View>
            ))
          )}
        </ScrollView>
      )}

      <Modal
        visible={createVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setCreateVisible(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <ScrollView
            contentContainerStyle={styles.modalScroll}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.modalSheet}>
              <Text style={styles.modalTitle}>Yeni qrup</Text>
              {createError ? <Text style={styles.errorText}>{createError}</Text> : null}

              <Text style={styles.label}>Qrup adı</Text>
              <TextInput
                style={styles.input}
                value={groupName}
                onChangeText={setGroupName}
                placeholder="Quba səfəri xərcləri"
                placeholderTextColor={colors.textMuted}
              />

              <Text style={styles.label}>Listing (istəyə bağlı)</Text>
              <View style={styles.chipWrap}>
                <Pressable
                  style={[styles.chip, selectedListingId === null && styles.chipSelected]}
                  onPress={() => setSelectedListingId(null)}
                >
                  <Text
                    style={[
                      styles.chipText,
                      selectedListingId === null && styles.chipTextSelected,
                    ]}
                  >
                    Seçilməyib
                  </Text>
                </Pressable>
                {myListings.map((listing) => {
                  const selected = selectedListingId === listing.id;
                  return (
                    <Pressable
                      key={listing.id}
                      style={[styles.chip, selected && styles.chipSelected]}
                      onPress={() => setSelectedListingId(listing.id)}
                    >
                      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                        {listing.title}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={styles.mvpHint}>
                Tur elanına bağlasanız, təsdiqlənmiş iştirakçılar avtomatik qrupa əlavə olunur.
              </Text>

              <View style={styles.modalActions}>
                <Pressable
                  style={styles.secondaryButton}
                  onPress={() => setCreateVisible(false)}
                  disabled={creating}
                >
                  <Text style={styles.secondaryButtonText}>Ləğv et</Text>
                </Pressable>
                <Pressable
                  style={[styles.primaryButton, styles.flexOne, creating && styles.disabled]}
                  onPress={createGroup}
                  disabled={creating}
                >
                  {creating ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.primaryButtonText}>Yarat</Text>
                  )}
                </Pressable>
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
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
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.accent,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  addButtonText: {
    color: colors.textOnAccent,
    fontWeight: '700',
    fontSize: 13,
  },
  screenTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: colors.text,
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.text,
    flexShrink: 1,
    minWidth: 0,
  },
  totalText: {
    marginTop: 6,
    fontSize: 16,
    fontWeight: '700',
    color: colors.chipText,
  },
  statusBadge: {
    alignSelf: 'flex-start',
    marginTop: 10,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '700',
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 32,
  },
  sectionTitle: {
    marginTop: 20,
    marginBottom: 10,
    fontSize: 16,
    fontWeight: '800',
    color: colors.text,
  },
  card: {
    borderRadius: 24,
    padding: 14,
    marginBottom: 10,
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
    marginBottom: 4,
  },
  metaLine: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
  },
  emptyText: {
    textAlign: 'center',
    color: colors.textMuted,
    marginTop: 24,
    fontSize: 14,
  },
  primaryButton: {
    marginTop: 14,
    backgroundColor: colors.accent,
    borderRadius: 16,
    paddingVertical: 12,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: colors.textOnAccent,
    fontWeight: '700',
  },
  settleButton: {
    marginTop: 20,
    backgroundColor: colors.success,
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
  },
  settleCard: {
    borderRadius: 24,
    padding: 12,
    marginBottom: 10,
    backgroundColor: colors.surface,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 3,
  },
  settleText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 8,
  },
  whatsappButton: {
    alignSelf: 'flex-start',
    backgroundColor: '#25D366',
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  whatsappText: {
    color: colors.textOnAccent,
    fontWeight: '700',
    fontSize: 12,
  },
  errorText: {
    backgroundColor: colors.dangerSoft,
    color: colors.dangerText,
    borderRadius: 8,
    padding: 10,
    marginTop: 10,
    fontSize: 13,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  modalScroll: {
    flexGrow: 1,
    justifyContent: 'flex-end',
    paddingBottom: 80,
  },
  modalSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 16,
    paddingBottom: 80,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.text,
    marginBottom: 8,
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
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: colors.chip,
  },
  chipSelected: {
    backgroundColor: colors.accent,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.chipText,
  },
  chipTextSelected: {
    color: colors.textOnAccent,
  },
  mvpHint: {
    marginTop: 14,
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
    marginBottom: 20,
  },
  secondaryButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: colors.chipText,
    fontWeight: '700',
  },
  pdfButton: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    paddingVertical: 12,
    backgroundColor: colors.surface,
  },
  pdfButtonText: {
    color: colors.accent,
    fontWeight: '700',
    fontSize: 14,
  },
  flexOne: {
    flex: 1,
  },
  disabled: {
    opacity: 0.6,
  },
  deleteTextButton: {
    alignSelf: 'flex-start',
    marginTop: 8,
    paddingVertical: 4,
  },
  deleteGroupButton: {
    alignSelf: 'flex-start',
    marginTop: 12,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  deleteText: {
    color: colors.danger,
    fontWeight: '700',
    fontSize: 13,
  },
  balanceCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSoft,
    padding: 12,
    marginBottom: 8,
  },
  balanceLine: {
    marginTop: 4,
    fontSize: 14,
    fontWeight: '700',
  },
  balanceCredit: {
    color: colors.success,
  },
  balanceDebt: {
    color: colors.danger,
  },
  balanceEven: {
    color: colors.textSecondary,
  },
  cardBox: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    gap: 10,
  },
  cardNumber: {
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 1.2,
    color: colors.text,
  },
  cardNumberInput: {
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 1.2,
    color: colors.text,
    paddingVertical: 4,
  },
  cardHint: {
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: 2,
  },
  copyButton: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.accent,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  copyButtonText: {
    color: colors.textOnAccent,
    fontWeight: '700',
    fontSize: 13,
  },
});
