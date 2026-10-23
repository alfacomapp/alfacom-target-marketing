import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { requiredRevenue, validateReport } from '../_shared/model.js';

const url = Deno.env.get('SUPABASE_URL')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const db = createClient(url, serviceKey, { auth: { persistSession: false } });
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, apikey, content-type', 'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS' };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...cors, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const bad = (message: string, status = 400) => json({ error: message }, status);
class InputError extends Error {}
const readJson = async (request: Request) => {
  const size = Number(request.headers.get('content-length') || 0);
  if (size > 100_000) throw new InputError('Ukuran data terlalu besar');
  try { return await request.json(); } catch { throw new InputError('Format JSON tidak valid'); }
};
const money = (value: unknown, label: string) => {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || Math.abs(n) > 1_000_000_000_000) throw new InputError(`${label} harus bilangan rupiah bulat`);
  return n;
};

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  try {
    const action = new URL(request.url).searchParams.get('action') || 'bootstrap';
    if (request.method === 'GET' && action === 'public') {
      const { data: reports, error } = await db.from('marketing_reports').select('*').order('period', { ascending: true });
      if (error) throw error;
      return json({ reports: (reports || []).map(row => ({
        store_code: row.store_code, period: row.period,
        revenue: row.revenue, hpp: row.hpp, gross_profit: row.gross_profit,
        operating_expenses_reported: row.operating_expenses_reported,
        investor_paid: row.investor_paid, other_income: row.other_income,
        other_expense: row.other_expense, net_reported: row.net_reported,
        commission: row.commission, delivery: row.delivery,
        other_operating_cost: row.other_operating_cost,
        has_revenue_adjustment: Array.isArray(row.lines) && row.lines.some((line: { label?: string; amount?: number }) => line.label === 'BIAYA' && Number(line.amount) < 0),
      })) });
    }
    const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
    if (!token) return bad('Sesi diperlukan', 401);
    const { data: auth, error: authError } = await db.auth.getUser(token);
    if (authError || !auth.user) return bad('Sesi tidak valid', 401);
    const { data: member, error: memberError } = await db.from('marketing_members').select('role,allowed_stores').eq('user_id', auth.user.id).maybeSingle();
    if (memberError) throw memberError;
    if (!member) return bad('Akun belum diberi akses aplikasi target marketing', 403);

    if (request.method === 'GET' && action === 'bootstrap') {
      const { data: reports, error: reportError } = await db.from('marketing_reports').select('*').in('store_code', member.allowed_stores).order('period', { ascending: true });
      if (reportError) throw reportError;
      const { data: scenarios, error: scenarioError } = await db.from('marketing_scenarios').select('*').eq('user_id', auth.user.id).in('store_code', member.allowed_stores).order('created_at', { ascending: false });
      if (scenarioError) throw scenarioError;
      return json({ member, reports, scenarios });
    }

    if (request.method === 'POST' && action === 'scenario') {
      const body = await readJson(request);
      const store = String(body.store_code || '');
      if (!member.allowed_stores.includes(store)) return bad('Toko tidak diizinkan', 403);
      const name = String(body.name || '').trim();
      if (!name || name.length > 120) return bad('Nama skenario harus 1–120 karakter');
      const x = body.inputs || {};
      const inputs = {
        targetProfit: money(x.targetProfit, 'Target laba'), targetKind: x.targetKind,
        hppRate: Number(x.hppRate), variableRate: Number(x.variableRate),
        fixedCost: money(x.fixedCost, 'Biaya tetap'), otherNet: money(x.otherNet ?? 0, 'Pendapatan/biaya lain'),
        investorMode: x.investorMode, investorValue: Number(x.investorValue ?? 0),
        marketingShare: Number(x.marketingShare), people: Number(x.people),
        simulationRevenue: money(x.simulationRevenue, 'Simulasi omzet'),
      };
      if (inputs.hppRate < 0 || inputs.variableRate < 0 || inputs.hppRate > 1 || inputs.variableRate > 1 ||
          !Number.isFinite(inputs.marketingShare) || inputs.marketingShare < 0 || inputs.marketingShare > 100 ||
          !Number.isInteger(inputs.people) || inputs.people < 1 || inputs.people > 1000 || inputs.simulationRevenue < 0 ||
          !['operating', 'owner'].includes(inputs.targetKind)) return bad('Asumsi skenario tidak valid');
      try { requiredRevenue(inputs); } catch (error) { throw new InputError(error instanceof Error ? error.message : 'Asumsi tidak valid'); }
      const { data, error } = await db.from('marketing_scenarios').insert({ user_id: auth.user.id, store_code: store, name, inputs }).select('*').single();
      if (error) throw error;
      return json({ scenario: data }, 201);
    }

    if (request.method === 'DELETE' && action === 'scenario') {
      const id = new URL(request.url).searchParams.get('id');
      if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return bad('ID skenario tidak valid');
      const { error } = await db.from('marketing_scenarios').delete().eq('id', id).eq('user_id', auth.user.id);
      if (error) throw error;
      return json({ ok: true });
    }

    if (request.method === 'POST' && action === 'report') {
      if (member.role !== 'admin') return bad('Hanya admin yang dapat menyimpan laporan', 403);
      const body = await readJson(request);
      const store = String(body.store_code || '');
      if (!member.allowed_stores.includes(store)) return bad('Toko tidak diizinkan', 403);
      const period = String(body.period || '');
      if (!/^20\d{2}-(0[1-9]|1[0-2])-01$/.test(period)) return bad('Periode harus tanggal satu setiap bulan');
      const report = {
        store_code: store, period, source_file: String(body.source_file || 'Input manual').slice(0, 240),
        source_period: String(body.source_period || '').slice(0, 120),
        revenue: money(body.revenue, 'Pendapatan'), hpp: money(body.hpp, 'HPP'),
        gross_profit: money(body.gross_profit, 'Laba kotor'),
        operating_expenses_reported: money(body.operating_expenses_reported, 'Total biaya'),
        investor_paid: body.investor_paid == null ? null : money(body.investor_paid, 'Bagi hasil investor'),
        other_income: money(body.other_income ?? 0, 'Pendapatan lain'),
        other_expense: money(body.other_expense ?? 0, 'Biaya lain'),
        net_reported: body.net_reported == null ? null : money(body.net_reported, 'Laba dilaporkan'),
        commission: money(body.commission ?? 0, 'Komisi'), delivery: money(body.delivery ?? 0, 'Pengiriman'),
        other_operating_cost: money(body.other_operating_cost, 'Biaya operasional lain'),
        lines: Array.isArray(body.lines) ? body.lines.slice(0, 120) : [],
        updated_at: new Date().toISOString(),
      };
      try { validateReport(report); } catch (error) { throw new InputError(error instanceof Error ? error.message : 'Laporan tidak valid'); }
      const { data, error } = await db.from('marketing_reports').upsert(report, { onConflict: 'store_code,period' }).select('*').single();
      if (error) throw error;
      return json({ report: data });
    }
    return bad('Endpoint tidak ditemukan', 404);
  } catch (error) {
    console.error(error);
    if (error instanceof InputError) return bad(error.message, 400);
    return bad('Gagal memproses permintaan', 500);
  }
});
