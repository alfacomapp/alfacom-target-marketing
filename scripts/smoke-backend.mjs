/** Live auth/API smoke test. Creates and deletes a temporary user automatically. */
import { randomBytes, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { calibrate } from '../supabase/functions/_shared/model.js';

const url = process.env.SUPABASE_URL?.replace(/\/$/, '');
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.SUPABASE_ANON_KEY;
if (!url || !serviceKey || !anonKey) throw new Error('SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SUPABASE_ANON_KEY are required');
const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
const visitor = createClient(url, anonKey, { auth: { persistSession: false } });
const email = `marketing-smoke-${randomUUID()}@example.invalid`;
const password = randomBytes(30).toString('base64url');
let userId;
let testReportId;

async function call(action, token, method = 'GET', body, id) {
  const params = new URLSearchParams({ action });
  if (id) params.set('id', id);
  const response = await fetch(`${url}/functions/v1/marketing-api?${params}`, {
    method, headers: { Authorization: `Bearer ${token}`, apikey: anonKey, ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() };
}

try {
  const publicResponse = await fetch(`${url}/functions/v1/marketing-api?action=public`);
  const publicData = await publicResponse.json();
  assert.equal(publicResponse.status, 200);
  assert.equal(publicData.reports.length, 18);
  assert(publicData.reports.every(row => !('lines' in row) && !('source_file' in row) && !('source_period' in row)));
  const blockedWrite = await fetch(`${url}/functions/v1/marketing-api?action=report`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(blockedWrite.status, 401);
  const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (createError) throw createError;
  userId = created.user.id;
  const { error: memberError } = await admin.from('marketing_members').insert({ user_id: userId, role: 'planner', allowed_stores: ['kendari', 'raha'] });
  if (memberError) throw memberError;
  const { data: signedIn, error: loginError } = await visitor.auth.signInWithPassword({ email, password });
  if (loginError) throw loginError;
  const token = signedIn.session.access_token;
  const initial = await call('bootstrap', token);
  assert.equal(initial.status, 200);
  assert.equal(initial.body.reports.length, 18);
  assert.equal(initial.body.member.role, 'planner');
  const kendari = initial.body.reports.filter(row => row.store_code === 'kendari');
  const raha = initial.body.reports.filter(row => row.store_code === 'raha');
  assert.equal(kendari.length, 9);
  assert.equal(raha.length, 9);
  const c = calibrate(kendari);
  const scenario = await call('scenario', token, 'POST', {
    store_code: 'kendari', name: 'Smoke test sementara',
    inputs: { targetProfit: 10_000_000, targetKind: 'operating', hppRate: c.hppRate, variableRate: c.variableRate, fixedCost: Math.round(c.fixedCost), otherNet: 0, investorMode: 'unset', investorValue: 0, marketingShare: 60, people: 3, simulationRevenue: 200_000_000 },
  });
  assert.equal(scenario.status, 201);
  assert(scenario.body.scenario.id);
  const denied = await call('report', token, 'POST', { store_code: 'kendari' });
  assert.equal(denied.status, 403);
  const removed = await call('scenario', token, 'DELETE', undefined, scenario.body.scenario.id);
  assert.equal(removed.status, 200);
  const { error: promoteError } = await admin.from('marketing_members').update({ role: 'admin' }).eq('user_id', userId);
  if (promoteError) throw promoteError;
  const { data: existingReport, error: existingError } = await admin.from('marketing_reports').select('id').eq('store_code', 'kendari').eq('period', '2099-12-01').maybeSingle();
  if (existingError) throw existingError;
  if (existingReport) throw new Error('Periode uji 2099-12 sudah berisi laporan; pemeriksaan input admin dihentikan');
  const adminReport = await call('report', token, 'POST', {
    store_code: 'kendari', period: '2099-12-01', source_file: 'Temporary smoke test', source_period: '2099-12',
    revenue: 100_000_000, hpp: 60_000_000, gross_profit: 40_000_000,
    operating_expenses_reported: 30_000_000, investor_paid: null, other_income: 0, other_expense: 0,
    net_reported: 10_000_000, commission: 0, delivery: 0, other_operating_cost: 30_000_000, lines: [],
  });
  assert.equal(adminReport.status, 200);
  testReportId = adminReport.body.report.id;
  console.log('Live smoke test passed: public monthly summary, protected detail, scenario save/delete, role enforcement, admin report input.');
} finally {
  if (testReportId) {
    const { error } = await admin.from('marketing_reports').delete().eq('id', testReportId);
    if (error) throw error;
    console.log('Temporary test report removed.');
  }
  if (userId) {
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) throw error;
    console.log('Temporary test user removed.');
  }
}
