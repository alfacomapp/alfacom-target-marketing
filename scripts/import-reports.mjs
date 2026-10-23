import fs from 'node:fs';
import { validateReport } from '../shared/model.js';

const url = process.env.SUPABASE_URL?.replace(/\/$/, '');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in this shell');
const rows = JSON.parse(fs.readFileSync(new URL('../normalized_reports.private.json', import.meta.url), 'utf8'));
if (rows.length !== 18) throw new Error(`Expected 18 reports, found ${rows.length}`);
const payload = rows.map(({ store_code, period, source_file, source_period, revenue, hpp, gross_profit, operating_expenses_reported, investor_paid, other_income, other_expense, net_reported, commission, delivery, other_operating_cost, lines }) => {
  const report = { store_code, period, source_file, source_period, revenue, hpp, gross_profit, operating_expenses_reported, investor_paid, other_income, other_expense, net_reported, commission, delivery, other_operating_cost, lines };
  validateReport(report);
  return report;
});
const response = await fetch(`${url}/rest/v1/marketing_reports?on_conflict=store_code,period`, {
  method: 'POST',
  headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=representation' },
  body: JSON.stringify(payload),
});
if (!response.ok) throw new Error(`Import failed: ${response.status} ${await response.text()}`);
const inserted = await response.json();
if (inserted.length !== 18) throw new Error(`Import returned ${inserted.length}, expected 18`);
console.log('Imported and verified 18 monthly reports (9 Kendari, 9 Raha).');
