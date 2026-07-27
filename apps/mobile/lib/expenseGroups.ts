/**
 * Single data layer for expense groups — profile and listing entry points
 * both use these helpers so groups stay in sync.
 */

import { getErrorMessage } from './errors';
import { supabase } from './supabase';
import type { Expense, ExpenseGroup, Profile } from '../types/database';

export type ExpenseGroupMemberProfile = Pick<Profile, 'id' | 'full_name' | 'phone'>;

export type ExpenseGroupCard = ExpenseGroup & {
  memberCount: number;
  totalAmount: number;
};

export type ExpenseGroupDetail = {
  group: ExpenseGroup;
  members: ExpenseGroupMemberProfile[];
  expenses: Array<Expense & { payerName: string }>;
  paymentCard: string | null;
  listingRegion: string | null;
};

/** Active expense group for a tour listing, if any. */
export async function findActiveGroupForListing(
  listingId: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from('expense_groups')
    .select('id')
    .eq('listing_id', listingId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    if (__DEV__) {
      console.warn('[expenseGroups] findActiveGroupForListing', getErrorMessage(error));
    }
    return null;
  }
  return data?.id ?? null;
}

/** Keep expense members aligned with approved tour participants. */
export async function syncGroupMembersFromListing(
  groupId: string,
  listingId: string
): Promise<void> {
  const [{ data: group }, { data: participants }] = await Promise.all([
    supabase.from('expense_groups').select('created_by').eq('id', groupId).maybeSingle(),
    supabase
      .from('listing_participants')
      .select('user_id')
      .eq('listing_id', listingId)
      .eq('status', 'approved'),
  ]);

  if (!group) {
    return;
  }

  const wanted = new Set<string>([group.created_by]);
  for (const row of participants ?? []) {
    if (row.user_id) {
      wanted.add(row.user_id);
    }
  }

  const { data: currentRows } = await supabase
    .from('expense_group_members')
    .select('user_id')
    .eq('group_id', groupId);

  const current = new Set((currentRows ?? []).map((r) => r.user_id));
  const missing = [...wanted].filter((uid) => !current.has(uid));
  if (missing.length === 0) {
    return;
  }

  await supabase.from('expense_group_members').insert(
    missing.map((user_id) => ({ group_id: groupId, user_id }))
  );
}

export async function fetchUserGroupCards(userId: string): Promise<ExpenseGroupCard[]> {
  const [ownedResult, memberResult] = await Promise.all([
    supabase.from('expense_groups').select('*').eq('created_by', userId),
    supabase.from('expense_group_members').select('group_id').eq('user_id', userId),
  ]);

  if (ownedResult.error) {
    throw ownedResult.error;
  }
  if (memberResult.error) {
    throw memberResult.error;
  }

  const memberGroupIds = (memberResult.data ?? []).map((row) => row.group_id);
  const ownedGroups = ownedResult.data ?? [];
  const ownedIds = new Set(ownedGroups.map((row) => row.id));
  const missingIds = memberGroupIds.filter((id) => !ownedIds.has(id));

  let memberGroups: ExpenseGroup[] = [];
  if (missingIds.length > 0) {
    const { data, error } = await supabase
      .from('expense_groups')
      .select('*')
      .in('id', missingIds);
    if (error) {
      throw error;
    }
    memberGroups = data ?? [];
  }

  const allGroups = [...ownedGroups, ...memberGroups].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  if (allGroups.length === 0) {
    return [];
  }

  const groupIds = allGroups.map((item) => item.id);
  const [membersResult, expensesResult] = await Promise.all([
    supabase.from('expense_group_members').select('group_id').in('group_id', groupIds),
    supabase.from('expenses').select('group_id, amount').in('group_id', groupIds),
  ]);

  if (membersResult.error) {
    throw membersResult.error;
  }
  if (expensesResult.error) {
    throw expensesResult.error;
  }

  const memberCountMap = new Map<string, number>();
  for (const row of membersResult.data ?? []) {
    memberCountMap.set(row.group_id, (memberCountMap.get(row.group_id) ?? 0) + 1);
  }

  const totalMap = new Map<string, number>();
  for (const row of expensesResult.data ?? []) {
    totalMap.set(row.group_id, (totalMap.get(row.group_id) ?? 0) + Number(row.amount));
  }

  return allGroups.map((item) => ({
    ...item,
    memberCount: memberCountMap.get(item.id) ?? 0,
    totalAmount: Math.round((totalMap.get(item.id) ?? 0) * 100) / 100,
  }));
}

export async function fetchGroupDetail(groupId: string): Promise<ExpenseGroupDetail | null> {
  const { data: groupData, error: groupError } = await supabase
    .from('expense_groups')
    .select('*')
    .eq('id', groupId)
    .maybeSingle();

  if (groupError || !groupData) {
    return null;
  }

  if (groupData.listing_id) {
    await syncGroupMembersFromListing(groupId, groupData.listing_id);
  }

  let paymentCard: string | null = null;
  let listingRegion: string | null = null;

  if (groupData.listing_id) {
    const { data: listingRow } = await supabase
      .from('listings')
      .select('payment_card, region')
      .eq('id', groupData.listing_id)
      .maybeSingle();
    const card = listingRow?.payment_card?.replace(/\D/g, '') || null;
    paymentCard = card && card.length >= 12 ? card : null;
    listingRegion = listingRow?.region?.trim() || null;
  }

  const { data: memberRows, error: membersError } = await supabase
    .from('expense_group_members')
    .select('user_id')
    .eq('group_id', groupId);

  if (membersError) {
    throw membersError;
  }

  const userIds = (memberRows ?? []).map((row) => row.user_id);
  let memberProfiles: ExpenseGroupMemberProfile[] = [];

  if (userIds.length > 0) {
    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select('id, full_name, phone')
      .in('id', userIds);

    if (profilesError) {
      throw profilesError;
    }
    memberProfiles = (profiles ?? []) as ExpenseGroupMemberProfile[];
  }

  const { data: expenseRows, error: expensesError } = await supabase
    .from('expenses')
    .select('*')
    .eq('group_id', groupId)
    .order('created_at', { ascending: false });

  if (expensesError) {
    throw expensesError;
  }

  const nameMap = new Map(
    memberProfiles.map((item) => [item.id, item.full_name?.trim() || 'İstifadəçi'])
  );

  return {
    group: groupData,
    members: memberProfiles,
    expenses: (expenseRows ?? []).map((row) => ({
      ...row,
      payerName: nameMap.get(row.paid_by) || 'İstifadəçi',
    })),
    paymentCard,
    listingRegion,
  };
}

export async function createExpenseGroup(input: {
  name: string;
  listingId: string | null;
  userId: string;
}): Promise<{ groupId: string | null; error: string | null }> {
  if (input.listingId) {
    const existing = await findActiveGroupForListing(input.listingId);
    if (existing) {
      return { groupId: existing, error: null };
    }
  }

  const { data: created, error: createErr } = await supabase
    .from('expense_groups')
    .insert({
      created_by: input.userId,
      name: input.name.trim(),
      listing_id: input.listingId,
      status: 'active',
    })
    .select('id')
    .single();

  if (createErr || !created) {
    return {
      groupId: null,
      error: createErr ? getErrorMessage(createErr) : 'Qrup yaradılmadı.',
    };
  }

  const memberIds = new Set<string>([input.userId]);

  if (input.listingId) {
    const { data: participants } = await supabase
      .from('listing_participants')
      .select('user_id')
      .eq('listing_id', input.listingId)
      .eq('status', 'approved');
    for (const row of participants ?? []) {
      if (row.user_id) {
        memberIds.add(row.user_id);
      }
    }
  }

  const { error: membersError } = await supabase.from('expense_group_members').insert(
    [...memberIds].map((userId) => ({
      group_id: created.id,
      user_id: userId,
    }))
  );

  if (membersError) {
    return {
      groupId: created.id,
      error: `Qrup yaradıldı, amma üzv yazılmadı: ${getErrorMessage(membersError)}`,
    };
  }

  return { groupId: created.id, error: null };
}

/** Open split-bill for a listing — reuses existing active group when present. */
export async function resolveSplitBillParamsForListing(
  listingId: string
): Promise<{ groupId?: string; listingId?: string }> {
  const groupId = await findActiveGroupForListing(listingId);
  return groupId ? { groupId } : { listingId };
}
