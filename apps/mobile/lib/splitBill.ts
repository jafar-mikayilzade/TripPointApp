export type SplitMember = {
  id: string;
  name: string;
  phone?: string | null;
};

export type SplitExpense = {
  paid_by: string;
  amount: number;
};

export type SettlementTransfer = {
  fromUserId: string;
  fromName: string;
  toUserId: string;
  toName: string;
  toPhone: string | null;
  amount: number;
};

/** Müsbət = alacağı var, mənfi = verəcəyi var */
export type MemberBalance = {
  id: string;
  name: string;
  paid: number;
  fairShare: number;
  balance: number;
};

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function calculateMemberBalances(
  members: SplitMember[],
  expenses: SplitExpense[]
): { total: number; fairShare: number; balances: MemberBalance[] } {
  if (members.length === 0) {
    return { total: 0, fairShare: 0, balances: [] };
  }

  const paidMap = new Map<string, number>();
  for (const member of members) {
    paidMap.set(member.id, 0);
  }

  let total = 0;
  for (const expense of expenses) {
    const amount = Number(expense.amount) || 0;
    total += amount;
    if (paidMap.has(expense.paid_by)) {
      paidMap.set(expense.paid_by, (paidMap.get(expense.paid_by) ?? 0) + amount);
    }
  }

  total = roundMoney(total);
  const fairShare = roundMoney(total / members.length);
  const balances = members.map((member) => {
    const paid = roundMoney(paidMap.get(member.id) ?? 0);
    return {
      id: member.id,
      name: member.name,
      paid,
      fairShare,
      balance: roundMoney(paid - fairShare),
    };
  });

  return { total, fairShare, balances };
}

/** 16 rəqəmi 4-lük qruplarla göstər */
export function formatCardNumber(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 16);
  return digits.replace(/(\d{4})(?=\d)/g, '$1 ').trim();
}

export function normalizeCardNumber(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 16);
}

/**
 * Splitwise-style minimum transfers:
 * 1) sum paid per member
 * 2) fair share = total / member count
 * 3) balance = paid - fair share
 * 4) settle largest debtor → largest creditor greedily
 */
export function calculateSettlements(
  members: SplitMember[],
  expenses: SplitExpense[]
): SettlementTransfer[] {
  if (members.length === 0) {
    return [];
  }

  // Eyni yuvarlaqlaşdırma — Adambaşı və köçürmələr uyğun olsun
  const { balances: memberBalances } = calculateMemberBalances(members, expenses);
  const phoneById = new Map(members.map((m) => [m.id, m.phone ?? null]));

  const balances = memberBalances.map((row) => ({
    id: row.id,
    name: row.name,
    phone: phoneById.get(row.id) ?? null,
    balance: row.balance,
  }));

  const debtors = balances
    .filter((item) => item.balance < -0.009)
    .map((item) => ({ ...item, balance: Math.abs(item.balance) }))
    .sort((a, b) => b.balance - a.balance);

  const creditors = balances
    .filter((item) => item.balance > 0.009)
    .sort((a, b) => b.balance - a.balance);

  const transfers: SettlementTransfer[] = [];
  let i = 0;
  let j = 0;

  while (i < debtors.length && j < creditors.length) {
    const debtor = debtors[i];
    const creditor = creditors[j];
    const amount = roundMoney(Math.min(debtor.balance, creditor.balance));

    if (amount > 0) {
      transfers.push({
        fromUserId: debtor.id,
        fromName: debtor.name,
        toUserId: creditor.id,
        toName: creditor.name,
        toPhone: creditor.phone,
        amount,
      });
    }

    debtor.balance = roundMoney(debtor.balance - amount);
    creditor.balance = roundMoney(creditor.balance - amount);

    if (debtor.balance <= 0.009) {
      i += 1;
    }
    if (creditor.balance <= 0.009) {
      j += 1;
    }
  }

  return transfers;
}

export function sumExpenses(expenses: SplitExpense[]): number {
  return roundMoney(expenses.reduce((sum, item) => sum + (Number(item.amount) || 0), 0));
}
