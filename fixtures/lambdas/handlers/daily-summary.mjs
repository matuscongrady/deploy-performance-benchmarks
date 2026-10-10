import Decimal from 'decimal.js';
import { DateTime } from 'luxon';
import { input, order, amount } from '../data.mjs';
import { revision } from './daily-summary.revision.mjs';
export async function handler(event = {}) {
  const { date = '2025-01-15' } = input(event);
  const selected = [order].filter(o => DateTime.fromISO(o.placedAt).toISODate() === date);
  const revenue = selected.reduce((sum, o) => sum.plus(amount(o.lines)), new Decimal(0));
  return { revision, date, orders: selected.length, revenue: revenue.toFixed(2) };
}
