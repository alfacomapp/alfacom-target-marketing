"""Normalize all source P&L reports and audit the accounting identities.

Run locally. Output contains confidential financial figures and is gitignored.
"""
from pathlib import Path
import json
import os
import re
import xlrd

ROOT = Path(__file__).resolve().parents[1]
MONTHS = []
MONTH_NAMES = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']

def value(row, label, occurrence=0):
    matches = [x['amount'] for x in row if x['label'] == label]
    return matches[occurrence] if len(matches) > occurrence else None

for file in sorted(ROOT.glob('bulan *.xls')):
    match = re.fullmatch(r'bulan (\d+) (kendari|raha)\.xls', file.name, re.I)
    if not match:
        continue
    month, store = int(match.group(1)), match.group(2).lower()
    with open(os.devnull, 'w') as quiet:
        sheet = xlrd.open_workbook(str(file), logfile=quiet).sheet_by_index(0)
    lines = []
    period_text = ''
    for row_idx in range(sheet.nrows):
        cells = sheet.row_values(row_idx)
        if any(isinstance(c, str) and 'PERIODE' in c for c in cells):
            period_text = next(c.strip() for c in cells if isinstance(c, str) and 'PERIODE' in c)
        label = next((c.strip() for c in cells[:14] if isinstance(c, str) and c.strip()), '')
        money = next((round(c) for c in cells[14:] if isinstance(c, (int, float)) and not isinstance(c, bool)), None)
        if label and money is not None:
            lines.append({'row': row_idx + 1, 'label': label, 'amount': money})
    if f'{MONTH_NAMES[month - 1]} 2026'.lower() not in period_text.lower():
        raise ValueError(f'Period label differs from filename: {file.name}: {period_text}')

    revenue = value(lines, 'TOTAL PENDAPATAN')
    gross = value(lines, 'LABA KOTOR')
    gross_index = next(i for i, item in enumerate(lines) if item['label'] == 'LABA KOTOR')
    hpp = [x['amount'] for x in lines[:gross_index] if x['label'] == 'TOTAL HPP'][-1]
    after_gross = lines[gross_index + 1:]
    expense_idx = next(i for i, item in enumerate(after_gross) if item['label'] == 'TOTAL BIAYA')
    expense_lines = after_gross[:expense_idx]
    expenses = after_gross[expense_idx]['amount']
    tail = after_gross[expense_idx + 1:]
    other_income = sum(x['amount'] for x in tail if x['label'] == 'TOTAL PENDAPATAN LAIN')
    other_expense = sum(x['amount'] for x in tail if x['label'] == 'TOTAL BIAYA')
    net_reported = value(tail, 'LABA / RUGI')
    net_calculated = gross - expenses + other_income - other_expense
    investor_line = next((x for x in expense_lines if x['label'] == 'BIAYA BAGI HASIL INVESTOR'), None)
    investor_paid = investor_line['amount'] if investor_line else None
    commission = sum(x['amount'] for x in expense_lines if x['label'] == 'BIAYA KOMISI')
    delivery = sum(x['amount'] for x in expense_lines if x['label'] == 'BIAYA PENGIRIMAN')
    operating_ex_investor = expenses - (investor_paid or 0)
    record = {
        'store_code': store, 'period': f'2026-{month:02d}-01', 'source_file': file.name,
        'source_period': period_text, 'revenue': revenue, 'hpp': hpp, 'gross_profit': gross,
        'operating_expenses_reported': expenses, 'investor_paid': investor_paid,
        'other_income': other_income, 'other_expense': other_expense,
        'net_reported': net_reported, 'net_calculated': net_calculated,
        'profit_before_investor': net_calculated + (investor_paid or 0),
        'operating_profit_before_investor': gross - operating_ex_investor,
        'commission': commission, 'delivery': delivery,
        'other_operating_cost': operating_ex_investor - commission - delivery,
        'audit_revenue_hpp_gross': revenue - hpp - gross,
        'audit_net': None if net_reported is None else net_reported - net_calculated,
        'lines': lines,
    }
    if net_reported is None and net_calculated != 0:
        raise ValueError(f'Missing reported net with nonzero calculated result: {file.name}')
    if abs(record['audit_revenue_hpp_gross']) > 2 or (record['audit_net'] is not None and abs(record['audit_net']) > 2):
        raise ValueError(f'Reconciliation failed for {file.name}: {record}')
    MONTHS.append(record)

MONTHS.sort(key=lambda r: (r['store_code'], r['period']))
output = ROOT / 'normalized_reports.private.json'
output.write_text(json.dumps(MONTHS, ensure_ascii=False, indent=2), encoding='utf-8')
for code in ('kendari', 'raha'):
    subset = [r for r in MONTHS if r['store_code'] == code]
    print(code, 'months', len(subset), 'revenue', sum(r['revenue'] for r in subset),
          'hpp', sum(r['hpp'] for r in subset), 'net', sum(r['net_calculated'] for r in subset),
          'paid_investor_months', sum(r['investor_paid'] is not None for r in subset),
          'paid_investor_total', sum(r['investor_paid'] or 0 for r in subset),
          'pre_investor', sum(r['profit_before_investor'] for r in subset))
print('written', output.name)
