import { Platform, Share } from 'react-native';

import type { MemberBalance, SettlementTransfer } from './splitBill';

export type SplitBillExpenseLine = {
  title: string;
  amount: number;
  payerName: string;
  createdAt?: string;
};

export type SplitBillPdfInput = {
  groupName: string;
  region?: string | null;
  totalAmount: number;
  fairShare: number;
  expenses: SplitBillExpenseLine[];
  balances: MemberBalance[];
  settlements: SettlementTransfer[];
};

function formatMoney(amount: number): string {
  return `${amount.toFixed(2)}₼`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatSplitBillShareText(input: SplitBillPdfInput): string {
  const lines: string[] = [`TripPoint · ${input.groupName}`, ''];
  if (input.region) {
    lines.push(`Region: ${input.region}`, '');
  }
  lines.push(`Ümumi: ${formatMoney(input.totalAmount)}`);
  lines.push(`Hər nəfər: ${formatMoney(input.fairShare)}`, '');

  lines.push('Xərclər:');
  for (const expense of input.expenses) {
    lines.push(`• ${expense.title} — ${formatMoney(expense.amount)} (${expense.payerName})`);
  }

  lines.push('', 'Balans:');
  for (const row of input.balances) {
    const label =
      row.balance > 0.009
        ? `alacağı ${formatMoney(row.balance)}`
        : row.balance < -0.009
          ? `verəcəyi ${formatMoney(Math.abs(row.balance))}`
          : 'bərabər';
    lines.push(`• ${row.name}: ${label}`);
  }

  if (input.settlements.length > 0) {
    lines.push('', 'Köçürmələr:');
    for (const s of input.settlements) {
      lines.push(
        `• ${s.fromName} → ${s.toName}: ${formatMoney(s.amount)}`
      );
    }
  }

  lines.push('', 'trippoint://');
  return lines.join('\n');
}

async function shareSplitBillText(input: SplitBillPdfInput): Promise<void> {
  const message = formatSplitBillShareText(input);
  await Share.share(
    Platform.OS === 'ios'
      ? { message }
      : { message, title: 'TripPoint xərclər' }
  );
}

/** PDF when expo-print native modul var; əks halda text Share. */
export async function shareSplitBillPdf(input: SplitBillPdfInput): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Print = require('expo-print') as typeof import('expo-print');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Sharing = require('expo-sharing') as typeof import('expo-sharing');

    const expenseRows = input.expenses
      .map(
        (e) =>
          `<tr><td>${escapeHtml(e.title)}</td><td>${escapeHtml(e.payerName)}</td><td>${escapeHtml(formatMoney(e.amount))}</td></tr>`
      )
      .join('');

    const balanceRows = input.balances
      .map((b) => {
        const label =
          b.balance > 0.009
            ? `+${formatMoney(b.balance)}`
            : b.balance < -0.009
              ? `−${formatMoney(Math.abs(b.balance))}`
              : '0';
        return `<tr><td>${escapeHtml(b.name)}</td><td>${escapeHtml(formatMoney(b.paid))}</td><td>${escapeHtml(label)}</td></tr>`;
      })
      .join('');

    const settlementRows = input.settlements
      .map(
        (s) =>
          `<li>${escapeHtml(s.fromName)} → ${escapeHtml(s.toName)}: <strong>${escapeHtml(formatMoney(s.amount))}</strong></li>`
      )
      .join('');

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/>
      <style>
        body{font-family:sans-serif;padding:24px;color:#111}
        h1{font-size:20px} table{width:100%;border-collapse:collapse;margin:12px 0}
        th,td{border:1px solid #ddd;padding:8px;text-align:left;font-size:13px}
        th{background:#f5f5f5}
      </style></head><body>
      <h1>TripPoint — ${escapeHtml(input.groupName)}</h1>
      ${input.region ? `<p>Region: ${escapeHtml(input.region)}</p>` : ''}
      <p><strong>Ümumi:</strong> ${escapeHtml(formatMoney(input.totalAmount))} ·
         <strong>Hər nəfər:</strong> ${escapeHtml(formatMoney(input.fairShare))}</p>
      <h2>Xərclər</h2>
      <table><thead><tr><th>Ad</th><th>Ödəyən</th><th>Məbləğ</th></tr></thead>
      <tbody>${expenseRows || '<tr><td colspan="3">Yoxdur</td></tr>'}</tbody></table>
      <h2>Balans</h2>
      <table><thead><tr><th>Üzv</th><th>Ödəyib</th><th>Balans</th></tr></thead>
      <tbody>${balanceRows}</tbody></table>
      ${
        settlementRows
          ? `<h2>Köçürmələr</h2><ul>${settlementRows}</ul>`
          : ''
      }
    </body></html>`;

    const { uri } = await Print.printToFileAsync({ html });
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, {
        mimeType: 'application/pdf',
        dialogTitle: 'Xərcləri paylaş',
        UTI: 'com.adobe.pdf',
      });
      return;
    }
  } catch {
    // Native modul yoxdursa text
  }

  await shareSplitBillText(input);
}
