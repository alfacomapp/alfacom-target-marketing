import test from 'node:test';
import assert from 'node:assert/strict';
import { allocateMarketing, backtest, calibrate, forecast, requiredRevenue, validateReport } from '../shared/model.js';

const report = (period, revenue, hpp, operating, investor = null) => ({
  period, revenue, hpp, gross_profit: revenue - hpp,
  operating_expenses_reported: operating, investor_paid: investor,
  other_income: 0, other_expense: 0, net_reported: revenue - hpp - operating,
  commission: 2_000_000, delivery: 1_000_000,
  other_operating_cost: operating - (investor ?? 0) - 3_000_000,
});

test('reconciles paid and unpaid investor months without inventing a zero payment', () => {
  const paid = report('2026-01-01', 100_000_000, 60_000_000, 35_000_000, 4_000_000);
  const unpaid = report('2026-02-01', 100_000_000, 60_000_000, 31_000_000);
  assert.equal(validateReport(paid).net, 5_000_000);
  assert.equal(validateReport(paid).profitBeforeInvestor, 9_000_000);
  assert.equal(unpaid.investor_paid, null);
  assert.equal(validateReport(unpaid).profitBeforeInvestor, 9_000_000);
});

test('uses revenue weighted cost ratios and median other monthly cost', () => {
  const rows = [
    report('2026-01-01', 100_000_000, 60_000_000, 30_000_000),
    report('2026-02-01', 200_000_000, 100_000_000, 31_000_000),
    report('2026-03-01', 100_000_000, 70_000_000, 80_000_000),
  ];
  const c = calibrate(rows);
  assert.equal(c.hppRate, 230_000_000 / 400_000_000);
  assert.equal(c.variableRate, 9_000_000 / 400_000_000);
  assert.equal(c.fixedCost, 28_000_000);
});

test('solves a target profit through the same contribution model used by forecast', () => {
  const input = { targetProfit: 10_000_000, targetKind: 'operating', hppRate: .6, variableRate: .05, fixedCost: 25_000_000, otherNet: 0, investorMode: 'unset' };
  const revenue = requiredRevenue(input);
  const projection = forecast({ ...input, revenue });
  assert.equal(revenue, 100_000_000);
  assert.equal(projection.operatingProfit, 10_000_000);
  assert.equal(projection.ownerProfit, null);
});

test('owner target explicitly accounts for investor percentage', () => {
  const input = { targetProfit: 8_000_000, targetKind: 'owner', hppRate: .6, variableRate: 0, fixedCost: 20_000_000, otherNet: 0, investorMode: 'percentage', investorValue: 20 };
  const revenue = requiredRevenue(input);
  const projection = forecast({ ...input, revenue });
  assert.equal(revenue, 75_000_000);
  assert.equal(projection.operatingProfit, 10_000_000);
  assert.equal(projection.investorDistribution, 2_000_000);
  assert.equal(projection.ownerProfit, 8_000_000);
  assert.throws(() => requiredRevenue({ ...input, investorMode: 'unset' }), /aturan investor/);
});

test('marketing split preserves total revenue', () => {
  const split = allocateMarketing(101_000_000, 60, 3);
  assert.equal(split.marketingTarget + split.walkInTarget, 101_000_000);
  assert.equal(split.perPerson, 20_200_000);
});

test('bad financial identities are rejected', () => {
  assert.throws(() => validateReport({ ...report('2026-01-01', 100_000_000, 60_000_000, 30_000_000), gross_profit: 1 }), /HPP/);
  assert.throws(() => forecast({ revenue: 100, hppRate: .95, variableRate: .1, fixedCost: 0, investorMode: 'unset' }), /Margin kontribusi/);
});

test('historical holdout error excludes investor payout from operating profit', () => {
  const rows = [1, 2, 3, 4].map((month, i) => report(`2026-0${month}-01`, 100_000_000, 60_000_000, 30_000_000 + i * 1_000_000, i % 2 ? 2_000_000 : null));
  const checked = backtest(rows);
  assert.equal(checked.errors.length, 4);
  assert(checked.meanAbsoluteError > 0);
  assert.equal(checked.errors[1].actual, 11_000_000);
});
