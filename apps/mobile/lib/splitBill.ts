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

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
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

  const fairShare = total / members.length;
  const balances = members.map((member) => ({
    id: member.id,
    name: member.name,
    phone: member.phone ?? null,
    balance: roundMoney((paidMap.get(member.id) ?? 0) - fairShare),
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
