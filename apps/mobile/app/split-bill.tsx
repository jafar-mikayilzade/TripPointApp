import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
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

import { getErrorMessage } from '../lib/errors';
import { calculateSettlements, sumExpenses } from '../lib/splitBill';
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

type GroupCard = ExpenseGroup & {
  memberCount: number;
  totalAmount: number;
};

type ExpenseRow = Expense & {
  payerName: string;
};

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

    const [ownedResult, memberResult] = await Promise.all([
      supabase.from('expense_groups').select('*').eq('created_by', user.id),
      supabase.from('expense_group_members').select('group_id').eq('user_id', user.id),
    ]);

    if (ownedResult.error) {
      setErrorMessage(getErrorMessage(ownedResult.error));
      setGroups([]);
      setLoading(false);
      return;
    }

    if (memberResult.error) {
      setErrorMessage(getErrorMessage(memberResult.error));
      setGroups([]);
      setLoading(false);
      return;
    }

    const memberGroupIds = (memberResult.data ?? []).map((row) => row.group_id);
    const ownedGroups = ownedResult.data ?? [];
    const ownedIds = new Set(ownedGroups.map((row) => row.id));
    const missingIds = memberGroupIds.filter((id) => !ownedIds.has(id));

    let memberGroups: ExpenseGroup[] = [];
    if (missingIds.length > 0) {
      const { data, error } = await supabase.from('expense_groups').select('*').in('id', missingIds);
      if (error) {
        setErrorMessage(getErrorMessage(error));
        setGroups([]);
        setLoading(false);
        return;
      }
      memberGroups = data ?? [];
    }

    const allGroups = [...ownedGroups, ...memberGroups].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    if (allGroups.length === 0) {
      setGroups([]);
      setLoading(false);
      return;
    }

    const groupIds = allGroups.map((item) => item.id);
    const [membersResult, expensesResult] = await Promise.all([
      supabase.from('expense_group_members').select('group_id').in('group_id', groupIds),
      supabase.from('expenses').select('group_id, amount').in('group_id', groupIds),
    ]);

    if (membersResult.error) {
      setErrorMessage(getErrorMessage(membersResult.error));
    }
    if (expensesResult.error) {
      setErrorMessage(getErrorMessage(expensesResult.error));
    }

    const memberCountMap = new Map<string, number>();
    for (const row of membersResult.data ?? []) {
      memberCountMap.set(row.group_id, (memberCountMap.get(row.group_id) ?? 0) + 1);
    }

    const totalMap = new Map<string, number>();
    for (const row of expensesResult.data ?? []) {
      totalMap.set(row.group_id, (totalMap.get(row.group_id) ?? 0) + Number(row.amount));
    }

    setGroups(
      allGroups.map((item) => ({
        ...item,
        memberCount: memberCountMap.get(item.id) ?? 0,
        totalAmount: Math.round((totalMap.get(item.id) ?? 0) * 100) / 100,
      }))
    );
    setLoading(false);
  }, []);

  const loadGroupDetail = useCallback(async (groupId: string) => {
    setDetailLoading(true);
    setErrorMessage(null);

    const { data: groupData, error: groupError } = await supabase
      .from('expense_groups')
      .select('*')
      .eq('id', groupId)
      .maybeSingle();

    if (groupError || !groupData) {
      setErrorMessage(groupError ? getErrorMessage(groupError) : 'Qrup tapılmadı.');
      setGroup(null);
      setMembers([]);
      setExpenses([]);
      setDetailLoading(false);
      return;
    }

    setGroup(groupData);

    const { data: memberRows, error: membersError } = await supabase
      .from('expense_group_members')
      .select('user_id')
      .eq('group_id', groupId);

    if (membersError) {
      setErrorMessage(getErrorMessage(membersError));
      setDetailLoading(false);
      return;
    }

    const userIds = (memberRows ?? []).map((row) => row.user_id);
    let memberProfiles: MemberProfile[] = [];

    if (userIds.length > 0) {
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('id, full_name, phone')
        .in('id', userIds);

      if (profilesError) {
        setErrorMessage(getErrorMessage(profilesError));
      } else {
        memberProfiles = (profiles ?? []) as MemberProfile[];
      }
    }

    setMembers(memberProfiles);

    const { data: expenseRows, error: expensesError } = await supabase
      .from('expenses')
      .select('*')
      .eq('group_id', groupId)
      .order('created_at', { ascending: false });

    if (expensesError) {
      setErrorMessage(getErrorMessage(expensesError));
      setExpenses([]);
      setDetailLoading(false);
      return;
    }

    const nameMap = new Map(
      memberProfiles.map((item) => [item.id, item.full_name?.trim() || 'İstifadəçi'])
    );
    setExpenses(
      (expenseRows ?? []).map((row) => ({
        ...row,
        payerName: nameMap.get(row.paid_by) || 'İstifadəçi',
      }))
    );
    setDetailLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadGroups();
      if (paramGroupId) {
        setSelectedGroupId(paramGroupId);
      }
      if (paramListingId) {
        setSelectedListingId(paramListingId);
        setCreateVisible(true);
      }
    }, [loadGroups, paramGroupId, paramListingId])
  );

  useFocusEffect(
    useCallback(() => {
      if (selectedGroupId) {
        loadGroupDetail(selectedGroupId);
      }
    }, [loadGroupDetail, selectedGroupId])
  );

  const settlements = useMemo(() => {
    return calculateSettlements(
      members.map((member) => ({
        id: member.id,
        name: member.full_name?.trim() || 'İstifadəçi',
        phone: member.phone,
      })),
      expenses.map((expense) => ({
        paid_by: expense.paid_by,
        amount: expense.amount,
      }))
    );
  }, [expenses, members]);

  const totalAmount = useMemo(() => sumExpenses(expenses), [expenses]);

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

    const { data: created, error: createErr } = await supabase
      .from('expense_groups')
      .insert({
        created_by: user.id,
        name: groupName.trim(),
        listing_id: selectedListingId,
        status: 'active',
      })
      .select('*')
      .single();

    if (createErr || !created) {
      setCreateError(createErr ? getErrorMessage(createErr) : 'Qrup yaradılmadı.');
      setCreating(false);
      return;
    }

    const { error: membersError } = await supabase.from('expense_group_members').insert({
      group_id: created.id,
      user_id: user.id,
    });
    if (membersError) {
      setCreateError(`Qrup yaradıldı, amma üzv yazılmadı: ${getErrorMessage(membersError)}`);
      setCreating(false);
      await loadGroups();
      setSelectedGroupId(created.id);
      setCreateVisible(false);
      return;
    }

    setCreating(false);
    setCreateVisible(false);
    await loadGroups();
    setSelectedGroupId(created.id);
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
            <Text style={styles.title}>{group.name}</Text>
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
                  {authUserId && item.paid_by === authUserId ? (
                    <Pressable
                      style={styles.deleteTextButton}
                      onPress={() => handleDeleteExpense(item.id)}
                      hitSlop={8}
                    >
                      <Text style={styles.deleteText}>Sil</Text>
                    </Pressable>
                  ) : null}
                </View>
              ))
            )}

            <Text style={styles.sectionTitle}>Kim kimə nə qədər borcludur?</Text>
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

            {authUserId && group.created_by === authUserId ? (
              <Pressable
                style={styles.deleteTextButton}
                onPress={() => handleDeleteGroup(group.id)}
                hitSlop={8}
              >
                <Text style={styles.deleteText}>Sil</Text>
              </Pressable>
            ) : null}
          </ScrollView>
        )}

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
              <Pressable
                key={item.id}
                style={styles.card}
                onPress={() => setSelectedGroupId(item.id)}
              >
                <Text style={styles.cardTitle} numberOfLines={2} ellipsizeMode="tail">
                  {item.name}
                </Text>
                <Text style={styles.metaLine}>👥 {item.memberCount} üzv</Text>
                <Text style={styles.metaLine}>💰 {formatMoney(item.totalAmount)}</Text>
                <Text style={styles.metaLine}>
                  {item.status === 'settled' ? '✅ Hesablanıb' : '🔵 Aktiv'}
                </Text>
                {authUserId && item.created_by === authUserId ? (
                  <Pressable
                    style={styles.deleteTextButton}
                    onPress={(event) => {
                      event.stopPropagation?.();
                      handleDeleteGroup(item.id);
                    }}
                    hitSlop={8}
                  >
                    <Text style={styles.deleteText}>Sil</Text>
                  </Pressable>
                ) : null}
              </Pressable>
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
                MVP: qrup yalnız sizin üçün yaradılır. Üzv əlavə etmə tezliklə gələcək.
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
  deleteText: {
    color: colors.danger,
    fontWeight: '700',
    fontSize: 13,
  },
});
