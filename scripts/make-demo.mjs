import fs from 'node:fs';
const source = JSON.parse(fs.readFileSync(new URL('../normalized_reports.private.json', import.meta.url), 'utf8'));
const reports = source.map(({ store_code, period, revenue, hpp, gross_profit, operating_expenses_reported, investor_paid, other_income, other_expense, net_reported, commission, delivery, other_operating_cost, lines }) => ({
  store_code, period, revenue, hpp, gross_profit, operating_expenses_reported, investor_paid, other_income, other_expense, net_reported, commission, delivery, other_operating_cost,
  has_revenue_adjustment: lines.some(line => line.label === 'BIAYA' && Number(line.amount) < 0),
}));
fs.writeFileSync(new URL('../demo-data.private.json', import.meta.url), JSON.stringify({ reports }));
console.log('Local-only preview data prepared');
