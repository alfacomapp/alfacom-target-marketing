/** Transparent monthly contribution model. All money is Indonesian rupiah. */
const num = value => Number(value);
const sum = (rows, key) => rows.reduce((total, row) => total + num(row[key] ?? 0), 0);
const quantile = (values, q) => {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return null;
  const index = (sorted.length - 1) * q;
  const lower = Math.floor(index);
  return sorted[lower] + (sorted[Math.ceil(index)] - sorted[lower]) * (index - lower);
};

export function validateReport(row) {
  const keys = ['revenue', 'hpp', 'gross_profit', 'operating_expenses_reported', 'other_income', 'other_expense', 'commission', 'delivery', 'other_operating_cost'];
  for (const key of keys) if (!Number.isFinite(num(row[key]))) throw new Error(`Data ${key} tidak valid`);
  if (num(row.revenue) <= 0) throw new Error('Pendapatan harus lebih dari nol');
  if (Math.abs(num(row.revenue) - num(row.hpp) - num(row.gross_profit)) > 2) throw new Error('Pendapatan − HPP tidak sama dengan laba kotor');
  const investor = row.investor_paid == null ? 0 : num(row.investor_paid);
  if (!Number.isFinite(investor) || investor < 0) throw new Error('Bagi hasil investor tidak valid');
  if (Math.abs(num(row.operating_expenses_reported) - investor - num(row.commission) - num(row.delivery) - num(row.other_operating_cost)) > 2) throw new Error('Rincian biaya tidak cocok dengan total biaya');
  const net = num(row.gross_profit) - num(row.operating_expenses_reported) + num(row.other_income) - num(row.other_expense);
  if (row.net_reported != null && Math.abs(net - num(row.net_reported)) > 2) throw new Error('Laba bersih tidak cocok dengan laporan');
  return { net, profitBeforeInvestor: net + investor, operatingProfitBeforeInvestor: num(row.gross_profit) - num(row.operating_expenses_reported) + investor };
}

export function calibrate(rows) {
  if (!Array.isArray(rows) || rows.length < 3) throw new Error('Sedikitnya tiga laporan bulanan diperlukan');
  rows.forEach(validateReport);
  const revenue = sum(rows, 'revenue');
  const hppRate = sum(rows, 'hpp') / revenue;
  const variableRate = (sum(rows, 'commission') + sum(rows, 'delivery')) / revenue;
  const monthly = rows.map(row => ({
    hppRate: row.hpp / row.revenue,
    variableRate: (row.commission + row.delivery) / row.revenue,
    fixedCost: row.other_operating_cost,
  }));
  const fixedCost = quantile(monthly.map(row => row.fixedCost), .5);
  const bounds = q => ({
    hppRate: quantile(monthly.map(row => row.hppRate), q),
    variableRate: quantile(monthly.map(row => row.variableRate), q),
    fixedCost: quantile(monthly.map(row => row.fixedCost), q),
  });
  return {
    months: rows.length, periodStart: rows[0].period, periodEnd: rows.at(-1).period,
    revenue, hppRate, variableRate, fixedCost,
    contributionRate: 1 - hppRate - variableRate,
    lowCost: bounds(.25), highCost: bounds(.75),
    reportedNet: rows.reduce((total, row) => total + validateReport(row).net, 0),
    profitBeforeInvestor: rows.reduce((total, row) => total + validateReport(row).profitBeforeInvestor, 0),
    investorPaidMonths: rows.filter(row => row.investor_paid != null).length,
    investorPaidTotal: rows.reduce((total, row) => total + (row.investor_paid ?? 0), 0),
  };
}

/** Leave-one-month-out check; measures historical error, not a confidence interval. */
export function backtest(rows) {
  if (!Array.isArray(rows) || rows.length < 4) throw new Error('Sedikitnya empat laporan diperlukan untuk uji historis');
  const errors = rows.map((row, index) => {
    const c = calibrate(rows.filter((_, i) => i !== index));
    const predicted = forecast({ ...c, revenue: Number(row.revenue), otherNet: 0, investorMode: 'unset' }).operatingProfit;
    const actual = validateReport(row).operatingProfitBeforeInvestor;
    return { period: row.period, predicted, actual, error: predicted - actual };
  });
  return { meanAbsoluteError: errors.reduce((total, item) => total + Math.abs(item.error), 0) / errors.length, errors };
}

export function forecast(input) {
  const revenue = num(input.revenue);
  const hppRate = num(input.hppRate);
  const variableRate = num(input.variableRate);
  const fixedCost = num(input.fixedCost);
  const otherNet = num(input.otherNet ?? 0);
  if (![revenue, hppRate, variableRate, fixedCost, otherNet].every(Number.isFinite) || revenue < 0 || fixedCost < 0 || hppRate < 0 || variableRate < 0) throw new Error('Input proyeksi tidak valid');
  const contributionRate = 1 - hppRate - variableRate;
  if (contributionRate <= 0) throw new Error('Margin kontribusi harus lebih dari nol');
  const hpp = revenue * hppRate;
  const variableCost = revenue * variableRate;
  const operatingProfit = revenue - hpp - variableCost - fixedCost + otherNet;
  let investorDistribution = null;
  if (input.investorMode === 'amount') {
    investorDistribution = num(input.investorValue);
    if (!Number.isFinite(investorDistribution) || investorDistribution < 0) throw new Error('Bagi hasil investor harus tidak negatif');
  } else if (input.investorMode === 'percentage') {
    const share = num(input.investorValue) / 100;
    if (!Number.isFinite(share) || share < 0 || share >= 1) throw new Error('Persentase investor harus 0 sampai kurang dari 100');
    investorDistribution = Math.max(0, operatingProfit) * share;
  } else if (input.investorMode !== 'unset') {
    throw new Error('Metode investor tidak dikenal');
  }
  return { revenue, hpp, variableCost, fixedCost, otherNet, contributionRate, operatingProfit, investorDistribution, ownerProfit: investorDistribution == null ? null : operatingProfit - investorDistribution };
}

export function requiredRevenue(input) {
  const target = num(input.targetProfit);
  if (!Number.isFinite(target) || target < 0) throw new Error('Target laba harus tidak negatif');
  const fixedCost = num(input.fixedCost);
  const otherNet = num(input.otherNet ?? 0);
  const hppRate = num(input.hppRate);
  const variableRate = num(input.variableRate);
  if (![fixedCost, otherNet, hppRate, variableRate].every(Number.isFinite) || fixedCost < 0 || hppRate < 0 || variableRate < 0) throw new Error('Asumsi biaya tidak valid');
  if (input.investorMode === 'amount' && (!Number.isFinite(num(input.investorValue)) || num(input.investorValue) < 0)) throw new Error('Bagi hasil investor harus tidak negatif');
  if (input.investorMode === 'percentage' && (!Number.isFinite(num(input.investorValue)) || num(input.investorValue) < 0 || num(input.investorValue) >= 100)) throw new Error('Persentase investor harus 0 sampai kurang dari 100');
  if (!['unset', 'amount', 'percentage'].includes(input.investorMode)) throw new Error('Metode investor tidak dikenal');
  let beforeInvestor = target;
  if (input.targetKind === 'owner') {
    if (input.investorMode === 'amount') beforeInvestor += num(input.investorValue);
    else if (input.investorMode === 'percentage') {
      const share = num(input.investorValue) / 100;
      if (!Number.isFinite(share) || share < 0 || share >= 1) throw new Error('Persentase investor harus 0 sampai kurang dari 100');
      beforeInvestor /= 1 - share;
    } else throw new Error('Isi aturan investor untuk target laba pemilik');
  }
  const contributionRate = 1 - hppRate - variableRate;
  if (!Number.isFinite(contributionRate) || contributionRate <= 0) throw new Error('Margin kontribusi harus lebih dari nol');
  const amount = (beforeInvestor + fixedCost - otherNet) / contributionRate;
  return Math.max(0, Math.ceil(amount));
}

export function allocateMarketing(totalRevenue, marketingSharePercent, people) {
  const share = num(marketingSharePercent) / 100;
  const count = num(people);
  if (!Number.isFinite(share) || share < 0 || share > 1 || !Number.isInteger(count) || count < 1) throw new Error('Porsi marketing atau jumlah anggota tidak valid');
  const marketingTarget = Math.round(totalRevenue * share);
  return { marketingTarget, walkInTarget: Math.round(totalRevenue) - marketingTarget, perPerson: Math.ceil(marketingTarget / count) };
}
