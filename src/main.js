import { createClient } from '@supabase/supabase-js';
import { allocateMarketing, backtest, calibrate, forecast, requiredRevenue, validateReport } from '../supabase/functions/_shared/model.js';
import './style.css';

const app = document.getElementById('app');
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const publicKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const demo = import.meta.env.DEV && (!supabaseUrl || !publicKey);
const client = !demo && supabaseUrl && publicKey ? createClient(supabaseUrl, publicKey) : null;
const idr = value => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Math.round(value || 0));
const compact = value => new Intl.NumberFormat('id-ID', { notation: 'compact', maximumFractionDigits: 1 }).format(value || 0);
const pct = value => `${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 }).format(value * 100)}%`;
const month = period => new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${period.slice(0, 10)}T00:00:00Z`));
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const round = value => Math.round(Number(value) || 0);
const numberInput = (label, key, value, { step = '1', hint = '', min = '0' } = {}) => `<label class="field"><span>${label}</span><input name="${key}" type="number" inputmode="decimal" min="${min}" step="${step}" value="${esc(value)}" required>${hint ? `<small>${hint}</small>` : ''}</label>`;
const state = { store: 'kendari', page: 'overview', reports: [], scenarios: [], member: null, user: null, drafts: {}, selectedReport: null, alert: '', busy: false };

function storeRows() { return state.reports.filter(row => row.store_code === state.store).sort((a, b) => a.period.localeCompare(b.period)); }
function calibration() { return calibrate(storeRows()); }
function defaultDraft() {
  const c = calibration();
  return { targetProfit: 10_000_000, targetKind: 'operating', hppRate: c.hppRate, variableRate: c.variableRate, fixedCost: Math.round(c.fixedCost), otherNet: 0, investorMode: 'unset', investorValue: 0, marketingShare: 60, people: 3, simulationRevenue: Math.round(c.revenue / c.months) };
}
function draft() { return state.drafts[state.store] ??= defaultDraft(); }
function storeLabel() { return state.store === 'kendari' ? 'Kendari' : 'Raha'; }
function notify(message) { state.alert = message; render(); setTimeout(() => { if (state.alert === message) { state.alert = ''; document.querySelector('.toast')?.remove(); } }, 6000); }

async function api(action, { method = 'GET', body, id } = {}) {
  const { data: { session } } = await client.auth.getSession();
  if (!session) throw new Error('Sesi berakhir. Silakan masuk lagi.');
  const params = new URLSearchParams({ action });
  if (id) params.set('id', id);
  const response = await fetch(`${supabaseUrl}/functions/v1/marketing-api?${params}`, {
    method, headers: { Authorization: `Bearer ${session.access_token}`, apikey: publicKey, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Permintaan gagal (${response.status})`);
  return result;
}

async function bootstrap() {
  state.busy = true; render();
  try {
    const result = demo ? await fetch('/__demo').then(async r => { if (!r.ok) throw new Error('Jalankan npm run prepare:demo lebih dulu'); return r.json(); }) : await api('bootstrap');
    state.reports = result.reports || [];
    state.scenarios = result.scenarios || [];
    state.member = result.member;
    if (!state.member.allowed_stores.includes(state.store)) state.store = state.member.allowed_stores[0];
    state.drafts = {};
  } catch (error) { state.alert = error.message; }
  state.busy = false; render();
}

function sparkline(rows) {
  if (!rows.length) return '';
  const values = rows.map(row => validateReport(row).profitBeforeInvestor);
  const min = Math.min(...values, 0), max = Math.max(...values, 0), span = max - min || 1;
  const points = values.map((value, index) => `${38 + index * 76},${125 - (value - min) / span * 95}`).join(' ');
  const zero = 125 - (0 - min) / span * 95;
  return `<svg viewBox="0 0 690 150" class="spark" role="img" aria-label="Tren laba sebelum bagi hasil selama ${rows.length} bulan"><line x1="24" x2="666" y1="${zero}" y2="${zero}" stroke="#d6ded8" stroke-dasharray="4 5"/><polyline points="${points}" fill="none" stroke="#247a61" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>${values.map((value, index) => `<circle cx="${38 + index * 76}" cy="${125 - (value - min) / span * 95}" r="5" fill="#247a61"><title>${month(rows[index].period)}: ${idr(value)}</title></circle>`).join('')}</svg>`;
}

function overview() {
  const rows = storeRows(), c = calibration(), test = backtest(rows);
  const avg = c.revenue / c.months;
  const breakeven = requiredRevenue({ ...c, targetProfit: 0, targetKind: 'operating', otherNet: 0, investorMode: 'unset' });
  const anomalies = rows.flatMap(row => (row.lines || []).filter(line => line.label === 'BIAYA' && line.amount < 0).map(line => `${month(row.period)}: akun “BIAYA” ${idr(line.amount)} mengurangi pendapatan dalam laporan sumber.`));
  return `<div class="page-heading"><div><span class="eyebrow">Kinerja historis</span><h1>Dasar target ${storeLabel()}</h1><p>${c.months} bulan laporan laba rugi · ${month(c.periodStart)}–${month(c.periodEnd)}</p></div><button class="button primary" data-action="page" data-page="planner">Buat target <span aria-hidden="true">↗</span></button></div>
    <div class="stats-grid">
      <article class="metric highlight"><span>Total pendapatan</span><strong>${idr(c.revenue)}</strong><small>Rata-rata ${idr(avg)} per bulan</small></article>
      <article class="metric"><span>Margin kontribusi dasar</span><strong>${pct(c.contributionRate)}</strong><small>Setelah HPP, komisi, pengiriman</small></article>
      <article class="metric"><span>Biaya lain median / bulan</span><strong>${idr(c.fixedCost)}</strong><small>${c.months} observasi, termasuk gaji dan operasional</small></article>
      <article class="metric"><span>Titik impas perkiraan</span><strong>${idr(breakeven)}</strong><small>Omzet bulanan sebelum bagi hasil investor</small></article>
    </div>
    <div class="two-col"><section class="panel trend"><div class="panel-head"><div><span class="eyebrow">Laba usaha</span><h2>Pergerakan sebelum bagi hasil</h2></div><span class="pill">${c.months} bulan</span></div>${sparkline(rows)}<div class="months">${rows.map(r => `<span>${month(r.period).split(' ')[0].slice(0, 3)}</span>`).join('')}</div><div class="note">Laba sebelum bagi hasil = laba rugi laporan + pembayaran investor yang tercatat. Ini ukuran kinerja usaha; kewajiban investor yang belum dibayar belum diketahui.</div></section>
      <section class="panel"><div class="panel-head"><div><span class="eyebrow">Rekonsiliasi</span><h2>Dua lapis laba</h2></div></div><div class="ledger-row"><span>Laba rugi sesuai laporan</span><strong>${idr(c.reportedNet)}</strong></div><div class="ledger-row"><span>+ Bagi hasil investor dibayar</span><strong>${idr(c.investorPaidTotal)}</strong></div><div class="ledger-row total"><span>Laba sebelum pembayaran investor</span><strong>${idr(c.profitBeforeInvestor)}</strong></div><p class="fine">Akun bagi hasil muncul pada ${c.investorPaidMonths} dari ${c.months} bulan. Pada bulan lain statusnya <b>belum tercatat dibayar</b>; aplikasi tidak mengisinya dengan angka nol.</p></section></div>
    <div class="two-col"><section class="panel"><div class="panel-head"><div><span class="eyebrow">Asumsi model</span><h2>Cara angka dihitung</h2></div></div><ol class="steps"><li>Rasio HPP = total HPP ÷ total pendapatan seluruh bulan.</li><li>Rasio variabel = (komisi + pengiriman) ÷ total pendapatan.</li><li>Biaya lain bulanan = median dari seluruh biaya operasional selain investor, komisi, dan pengiriman.</li><li>Target omzet = (biaya lain + target laba − pendapatan lain neto) ÷ margin kontribusi.</li></ol></section>
    <section class="panel"><div class="panel-head"><div><span class="eyebrow">Catatan audit</span><h2>Keterbatasan yang terlihat</h2></div></div><p>Uji silang dengan menyisihkan satu bulan bergantian menghasilkan rata-rata selisih laba <b>${idr(test.meanAbsoluteError)}</b> per bulan. Ini ukuran kesalahan historis, bukan batas pasti bulan depan.</p><p>Proyeksi memakai hubungan biaya historis, sehingga tidak menangkap perubahan harga beli, komposisi jasa/barang, atau biaya satu kali di bulan mendatang. Semua driver dapat disunting di Kalkulator Target.</p>${anomalies.map(text => `<div class="warning">${esc(text)}</div>`).join('') || '<div class="success">Tidak ada akun pendapatan berlabel biaya yang perlu ditinjau.</div>'}<p class="fine">Pendapatan/biaya lain nonoperasional tidak dimasukkan dalam dasar proyeksi (default Rp0). Pembayaran investor ditampilkan terpisah.</p></section></div>`;
}

function plannerResults() {
  const x = draft(), c = calibration();
  try {
    const target = requiredRevenue(x);
    const result = forecast({ ...x, revenue: target });
    const split = allocateMarketing(target, x.marketingShare, x.people);
    const sensitivity = [c.lowCost, c.highCost].map(cost => requiredRevenue({ ...x, ...cost }));
    const current = forecast({ ...x, revenue: x.simulationRevenue });
    return `<div class="result-hero"><span>TARGET OMZET BULANAN</span><strong>${idr(target)}</strong><p>Untuk target ${x.targetKind === 'owner' ? 'laba pemilik' : 'laba usaha'} ${idr(x.targetProfit)}</p></div>
      <div class="result-grid"><div><span>Estimasi HPP</span><strong>${idr(result.hpp)}</strong></div><div><span>Komisi + pengiriman</span><strong>${idr(result.variableCost)}</strong></div><div><span>Biaya operasional lain</span><strong>${idr(result.fixedCost)}</strong></div><div><span>Laba sebelum investor</span><strong>${idr(result.operatingProfit)}</strong></div></div>
      <div class="result-grid soft"><div><span>Target tim marketing</span><strong>${idr(split.marketingTarget)}</strong></div><div><span>Per orang</span><strong>${idr(split.perPerson)}</strong></div><div><span>Target toko / walk-in</span><strong>${idr(split.walkInTarget)}</strong></div><div><span>Pembayaran investor</span><strong>${result.investorDistribution == null ? 'Belum ditetapkan' : idr(result.investorDistribution)}</strong></div></div>
      <div class="callout"><b>Jika omzet ${idr(x.simulationRevenue)}</b><span>Perkiraan laba usaha: ${idr(current.operatingProfit)}${current.ownerProfit == null ? '' : ` · laba pemilik: ${idr(current.ownerProfit)}`}</span></div>
      <div class="range"><span>Uji sensitivitas historis</span><strong>${idr(Math.min(...sensitivity))} – ${idr(Math.max(...sensitivity))}</strong><small>Biaya pada persentil 25–75 dari ${c.months} bulan. Ini rentang skenario, bukan jaminan hasil.</small></div>`;
  } catch (error) { return `<div class="warning">${esc(error.message)}</div>`; }
}

function planner() {
  const x = draft();
  return `<div class="page-heading"><div><span class="eyebrow">Perencanaan</span><h1>Kalkulator target laba</h1><p>Ubah asumsi, lihat omzet yang perlu dicapai oleh ${storeLabel()}.</p></div></div>
    <div class="planner-layout"><section class="panel planner-form"><div class="panel-head"><div><span class="eyebrow">01 / Sasaran</span><h2>Target dan dasar biaya</h2></div><button class="link-button" data-action="reset">Kembalikan data historis</button></div><div class="fields">${numberInput('Target laba per bulan (Rp)', 'targetProfit', x.targetProfit)}<label class="field"><span>Jenis target laba</span><select name="targetKind"><option value="operating" ${x.targetKind === 'operating' ? 'selected' : ''}>Laba usaha sebelum investor</option><option value="owner" ${x.targetKind === 'owner' ? 'selected' : ''}>Laba pemilik sesudah investor</option></select></label>${numberInput('Simulasi omzet untuk perkiraan laba (Rp)', 'simulationRevenue', x.simulationRevenue, { hint: 'Awalnya rata-rata omzet historis' })}${numberInput('HPP / pendapatan (%)', 'hppRate', (x.hppRate * 100).toFixed(2), { step: '.01', hint: 'Termasuk penyesuaian stok di laporan' })}${numberInput('Komisi + pengiriman (%)', 'variableRate', (x.variableRate * 100).toFixed(2), { step: '.01' })}${numberInput('Biaya operasional lain (Rp)', 'fixedCost', x.fixedCost, { hint: 'Gaji, sewa, operasional lain, dll.' })}${numberInput('Pendapatan lain neto (Rp)', 'otherNet', x.otherNet, { min: '-1000000000000', hint: 'Default nol karena tidak rutin' })}</div>
      <div class="divider"></div><div class="panel-head"><div><span class="eyebrow">02 / Investor</span><h2>Aturan bagi hasil</h2></div></div><div class="fields"><label class="field"><span>Perhitungan investor</span><select name="investorMode"><option value="unset" ${x.investorMode === 'unset' ? 'selected' : ''}>Belum ditetapkan</option><option value="percentage" ${x.investorMode === 'percentage' ? 'selected' : ''}>Persentase dari laba positif</option><option value="amount" ${x.investorMode === 'amount' ? 'selected' : ''}>Nominal tetap per bulan</option></select><small>Riwayat pembayaran tidak dipakai sebagai tarif bagi hasil.</small></label>${x.investorMode === 'unset' ? '' : numberInput(x.investorMode === 'percentage' ? 'Bagian investor (%)' : 'Pembayaran investor (Rp)', 'investorValue', x.investorValue, { step: x.investorMode === 'percentage' ? '.01' : '1' })}</div>
      <div class="divider"></div><div class="panel-head"><div><span class="eyebrow">03 / Penyaluran target</span><h2>Tim marketing</h2></div></div><div class="fields">${numberInput('Porsi omzet tim marketing (%)', 'marketingShare', x.marketingShare, { step: '.1' })}${numberInput('Jumlah anggota marketing', 'people', x.people)}</div><div class="form-actions"><button class="button primary" data-action="save-scenario">Simpan skenario</button><span class="fine">Porsi tim hanya membagi omzet; margin tiap kanal belum tersedia di laporan.</span></div></section>
    <section class="panel result-panel"><div class="panel-head"><div><span class="eyebrow">Hasil proyeksi</span><h2>Target ${storeLabel()}</h2></div></div><div id="planner-results">${plannerResults()}</div></section></div>`;
}

function reports() {
  const rows = storeRows();
  const selected = rows.find(row => row.period === state.selectedReport) || rows.at(-1);
  return `<div class="page-heading"><div><span class="eyebrow">Sumber perhitungan</span><h1>Laporan laba rugi</h1><p>Angka sumber dan rekonsiliasi untuk ${storeLabel()}.</p></div>${state.member?.role === 'admin' ? '<button class="button primary" data-action="toggle-report-form">Tambah laporan bulanan</button>' : ''}</div>
    <section id="report-form-slot"></section><section class="panel table-panel"><div class="table-scroll"><table><thead><tr><th>Periode</th><th>Pendapatan</th><th>HPP</th><th>Laba kotor</th><th>Laba sebelum investor</th><th>Investor dibayar</th><th>Laba rugi laporan</th></tr></thead><tbody>${rows.map(row => { const v = validateReport(row); return `<tr class="${selected?.period === row.period ? 'selected' : ''}" data-action="report-detail" data-period="${row.period}"><td><b>${month(row.period)}</b><small>${esc(row.source_file)}</small></td><td>${idr(row.revenue)}</td><td>${idr(row.hpp)}</td><td>${idr(row.gross_profit)}</td><td>${idr(v.profitBeforeInvestor)}</td><td>${row.investor_paid == null ? '<span class="status pending">Belum tercatat</span>' : idr(row.investor_paid)}</td><td class="${v.net < 0 ? 'negative' : ''}">${idr(v.net)}</td></tr>`; }).join('')}</tbody></table></div></section>
    ${selected ? `<section class="panel detail"><div class="panel-head"><div><span class="eyebrow">Rincian sumber</span><h2>${month(selected.period)} · ${storeLabel()}</h2><p>${esc(selected.source_file)}</p></div><span class="pill">Selisih rekonsiliasi: ${idr((selected.revenue - selected.hpp) - selected.gross_profit)}</span></div><div class="detail-grid"><div><span>Pendapatan − HPP</span><b>${idr(selected.gross_profit)}</b></div><div><span>Biaya laporan, termasuk investor</span><b>${idr(selected.operating_expenses_reported)}</b></div><div><span>Pendapatan lain − biaya lain</span><b>${idr(selected.other_income - selected.other_expense)}</b></div><div><span>Pembayaran investor</span><b>${selected.investor_paid == null ? 'Belum tercatat' : idr(selected.investor_paid)}</b></div></div>${selected.net_reported == null ? '<p class="fine">Baris laba rugi kosong pada sumber; hasil hitung rekonsiliasi adalah Rp0.</p>' : ''}<details><summary>Lihat akun pada laporan sumber</summary><div class="line-list">${(selected.lines || []).map(line => `<div><span><i>Baris ${line.row}</i> ${esc(line.label)}</span><b>${idr(line.amount)}</b></div>`).join('') || '<p>Rincian akun tidak tersedia untuk input manual.</p>'}</div></details></section>` : ''}`;
}

function scenarios() {
  const rows = state.scenarios.filter(row => row.store_code === state.store);
  return `<div class="page-heading"><div><span class="eyebrow">Perencanaan tersimpan</span><h1>Skenario ${storeLabel()}</h1><p>Bandingkan dan buka kembali asumsi yang pernah disimpan.</p></div><button class="button primary" data-action="page" data-page="planner">Buat skenario</button></div><section class="scenario-grid">${rows.length ? rows.map(row => { let target; try { target = requiredRevenue(row.inputs); } catch { target = null; } return `<article class="panel scenario-card"><span class="eyebrow">${month(row.created_at.slice(0, 10))}</span><h2>${esc(row.name)}</h2><p>Target laba ${idr(row.inputs.targetProfit)}</p><strong>${target == null ? 'Perlu diperbarui' : idr(target)}</strong><small>Omzet bulanan · ${row.inputs.targetKind === 'owner' ? 'sesudah investor' : 'sebelum investor'}</small><div class="scenario-actions"><button class="button outline" data-action="load-scenario" data-id="${row.id}">Buka</button><button class="link-button danger" data-action="delete-scenario" data-id="${row.id}">Hapus</button></div></article>`; }).join('') : '<div class="panel empty"><span>◇</span><h2>Belum ada skenario</h2><p>Simpan perhitungan dari Kalkulator Target untuk membandingkannya nanti.</p></div>'}</section>`;
}

function shell() {
  const nav = [['overview', '▦', 'Ringkasan'], ['planner', '◎', 'Kalkulator Target'], ['reports', '▤', 'Laporan'], ['scenarios', '◇', 'Skenario']];
  const pages = { overview, planner, reports, scenarios };
  return `<div class="layout"><aside class="sidebar"><div class="brand"><span class="brand-mark">A</span><div><strong>ALFACOM</strong><small>Target Marketing</small></div></div><div class="side-label">WORKSPACE</div><nav>${nav.map(([key, icon, title]) => `<button class="nav-item ${state.page === key ? 'active' : ''}" data-action="page" data-page="${key}"><span>${icon}</span>${title}</button>`).join('')}</nav><div class="side-bottom"><div class="side-caption">MODEL</div><p>Berdasarkan laba rugi<br>Januari–September 2026</p><button class="logout" data-action="logout">Keluar ↗</button></div></aside>
  <div class="main-wrap"><header class="topbar"><div class="mobile-brand">ALFACOM <span>Target Marketing</span></div><div class="topbar-left"><span class="breadcrumb">Dashboard <b>/ ${nav.find(x => x[0] === state.page)[2]}</b></span></div><div class="topbar-right">${demo ? '<span class="demo-chip">PRATINJAU LOKAL</span>' : ''}<label class="store-select"><span>TOKO</span><select id="store-select">${state.member.allowed_stores.map(code => `<option value="${code}" ${state.store === code ? 'selected' : ''}>${code === 'kendari' ? 'Kendari' : 'Raha'}</option>`).join('')}</select></label><div class="avatar" title="${esc(state.user?.email || 'Pratinjau')}">${esc((state.user?.email || 'A')[0].toUpperCase())}</div></div></header><div class="mobile-nav">${nav.map(([key, icon, title]) => `<button class="${state.page === key ? 'active' : ''}" data-action="page" data-page="${key}"><span>${icon}</span><small>${title.replace('Kalkulator Target', 'Target')}</small></button>`).join('')}</div><main>${pages[state.page]()}</main><footer>Alfacom Multi Solution · Estimasi untuk perencanaan, diperbarui saat laporan baru dimasukkan.</footer></div></div>`;
}

function authScreen() {
  if (!client && !demo) return `<div class="auth-wrap"><div class="auth-card"><span class="brand-mark">A</span><h1>Konfigurasi belum selesai</h1><p>Atur URL dan publishable/anon key Supabase pada build frontend agar aplikasi dapat terhubung ke proyek baru.</p><code>VITE_SUPABASE_URL · VITE_SUPABASE_ANON_KEY</code></div></div>`;
  return `<div class="auth-wrap"><div class="auth-card"><div class="auth-logo"><span class="brand-mark">A</span><div><strong>ALFACOM</strong><small>Target Marketing</small></div></div><span class="eyebrow">Akses privat</span><h1>Rencanakan laba<br>dengan dasar yang jelas.</h1><p>Masuk untuk melihat laporan Kendari dan Raha serta menyusun target omzet.</p><form id="login-form"><label class="field"><span>Email</span><input type="email" name="email" required autocomplete="username" placeholder="email@perusahaan.com"></label><label class="field"><span>Kata sandi</span><input type="password" name="password" autocomplete="current-password" placeholder="••••••••"></label><button class="button primary full" type="submit">Masuk dengan kata sandi →</button></form><button class="link-button magic-link" data-action="magic-link">Kirim tautan masuk ke email</button><small class="fine">Akun dibuat oleh admin proyek Supabase. Data laporan tidak dibuka untuk pengunjung umum.</small></div><div class="auth-side"><span>ALFACOM / 2026</span><div><p>“Target yang baik dapat ditelusuri kembali ke angka laporan.”</p><small>Perencanaan dua toko · Kendari & Raha</small></div></div></div>`;
}

function emptyDataScreen() {
  return `<div class="auth-wrap"><div class="auth-card"><span class="brand-mark">A</span><h1>Belum ada laporan</h1><p>Akun sudah aktif, tetapi 18 laporan awal belum diimpor ke proyek Supabase. Jalankan alat impor sesuai README, lalu muat ulang halaman.</p><button class="button outline" data-action="logout">Keluar</button></div></div>`;
}

function render() {
  app.innerHTML = `${state.busy ? '<div class="loading">Memuat laporan…</div>' : state.member ? (state.reports.length ? shell() : emptyDataScreen()) : authScreen()}${state.alert ? `<div class="toast">${esc(state.alert)}</div>` : ''}`;
}

function readPlannerField(element) {
  const x = draft(), key = element.name;
  if (key === 'hppRate' || key === 'variableRate') x[key] = Number(element.value) / 100;
  else if (['targetKind', 'investorMode'].includes(key)) x[key] = element.value;
  else x[key] = Number(element.value);
}

function reportForm() {
  const now = new Date();
  return `<form id="report-form" class="panel report-form"><div class="panel-head"><div><span class="eyebrow">Input admin</span><h2>Tambah atau perbarui laporan bulanan</h2></div><button type="button" class="link-button" data-action="toggle-report-form">Tutup</button></div><p class="fine">Isikan angka total persis seperti laporan. Menyimpan periode yang sudah ada akan menggantinya.</p><div class="fields"><label class="field"><span>Periode bulan</span><input name="period" type="month" value="${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}" required></label>${numberInput('Total pendapatan (Rp)', 'revenue', 0)}${numberInput('Total HPP akhir (Rp)', 'hpp', 0)}${numberInput('Total biaya laporan (Rp)', 'operating_expenses_reported', 0)}${numberInput('Komisi (Rp)', 'commission', 0)}${numberInput('Pengiriman (Rp)', 'delivery', 0)}<label class="field"><span>Bagi hasil investor dalam laporan?</span><select name="investorStatus"><option value="unpaid">Tidak ada akun / belum dibayar</option><option value="paid">Ada akun / sudah dibayar</option></select></label>${numberInput('Bagi hasil investor dibayar (Rp)', 'investor_paid', 0)}${numberInput('Pendapatan lain (Rp)', 'other_income', 0)}${numberInput('Biaya lain (Rp)', 'other_expense', 0)}</div><button class="button primary" type="submit">Simpan laporan</button></form>`;
}

document.addEventListener('click', async event => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  try {
    if (action === 'page') { state.page = button.dataset.page; render(); window.scrollTo(0, 0); }
    if (action === 'logout') { if (!demo) await client.auth.signOut(); state.member = null; state.reports = []; render(); }
    if (action === 'magic-link') {
      if (!client) throw new Error('Supabase belum terhubung');
      const email = document.querySelector('#login-form [name="email"]')?.value.trim();
      if (!email || !document.querySelector('#login-form [name="email"]').checkValidity()) throw new Error('Isi alamat email yang valid');
      const redirectTo = `${location.origin}${import.meta.env.BASE_URL}`;
      const { error } = await client.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo, shouldCreateUser: false } });
      if (error) throw error;
      notify('Tautan masuk dikirim. Periksa email Anda.');
    }
    if (action === 'reset') { state.drafts[state.store] = defaultDraft(); render(); }
    if (action === 'report-detail') { state.selectedReport = button.dataset.period; render(); }
    if (action === 'toggle-report-form') { const slot = document.getElementById('report-form-slot'); if (slot) slot.innerHTML = slot.innerHTML ? '' : reportForm(); }
    if (action === 'save-scenario') {
      if (demo) throw new Error('Penyimpanan tersedia setelah Supabase terhubung');
      const name = prompt('Nama skenario target:');
      if (!name?.trim()) return;
      const result = await api('scenario', { method: 'POST', body: { store_code: state.store, name: name.trim(), inputs: draft() } });
      state.scenarios.unshift(result.scenario); notify('Skenario tersimpan.');
    }
    if (action === 'load-scenario') { const item = state.scenarios.find(x => x.id === button.dataset.id); if (item) { state.drafts[state.store] = { ...item.inputs }; state.page = 'planner'; render(); } }
    if (action === 'delete-scenario') { if (!confirm('Hapus skenario ini?')) return; if (demo) throw new Error('Penyimpanan tersedia setelah Supabase terhubung'); await api('scenario', { method: 'DELETE', id: button.dataset.id }); state.scenarios = state.scenarios.filter(x => x.id !== button.dataset.id); notify('Skenario dihapus.'); }
  } catch (error) { notify(error.message); }
});

document.addEventListener('change', event => {
  if (event.target.id === 'store-select') { state.store = event.target.value; state.selectedReport = null; render(); }
  if (event.target.closest('.planner-form') && event.target.name) { readPlannerField(event.target); if (['investorMode', 'targetKind'].includes(event.target.name)) render(); else document.getElementById('planner-results').innerHTML = plannerResults(); }
});
document.addEventListener('input', event => {
  if (event.target.closest('.planner-form') && event.target.name && event.target.type === 'number') { readPlannerField(event.target); document.getElementById('planner-results').innerHTML = plannerResults(); }
});
document.addEventListener('submit', async event => {
  if (!['login-form', 'report-form'].includes(event.target.id)) return;
  event.preventDefault();
  const form = event.target, values = Object.fromEntries(new FormData(form));
  try {
    if (form.id === 'login-form') {
      if (!client) throw new Error('Supabase belum terhubung');
      const { data, error } = await client.auth.signInWithPassword({ email: values.email, password: values.password });
      if (error) throw error;
      state.user = data.user;
      await bootstrap();
    } else {
      if (demo) throw new Error('Input laporan tersedia setelah Supabase terhubung');
      const revenue = round(values.revenue), hpp = round(values.hpp), expenses = round(values.operating_expenses_reported);
      const investor = values.investorStatus === 'paid' ? round(values.investor_paid) : null;
      const commission = round(values.commission), delivery = round(values.delivery);
      const report = { store_code: state.store, period: `${values.period}-01`, source_file: 'Input manual', source_period: values.period, revenue, hpp, gross_profit: revenue - hpp, operating_expenses_reported: expenses, investor_paid: investor, other_income: round(values.other_income), other_expense: round(values.other_expense), commission, delivery, other_operating_cost: expenses - (investor ?? 0) - commission - delivery, net_reported: null, lines: [] };
      validateReport(report);
      const result = await api('report', { method: 'POST', body: report });
      state.reports = state.reports.filter(x => !(x.store_code === state.store && x.period === report.period)).concat(result.report);
      state.drafts = {}; state.selectedReport = report.period; notify('Laporan tersimpan dan model diperbarui.');
    }
  } catch (error) { notify(error.message); }
});

async function start() {
  if (demo) { state.user = { email: 'preview@local' }; await bootstrap(); return; }
  if (!client) { render(); return; }
  const { data: { session } } = await client.auth.getSession();
  if (session) { state.user = session.user; await bootstrap(); } else render();
  client.auth.onAuthStateChange((event, session) => { if (event === 'SIGNED_OUT') { state.member = null; state.reports = []; state.user = null; render(); } else if (session) state.user = session.user; });
}
start();
