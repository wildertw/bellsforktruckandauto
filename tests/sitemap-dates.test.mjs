import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { computeInventoryDates, latest, formatLastmod } = require('../sitemap-dates');

const d = (iso) => new Date(iso);
const truck = { stockNumber: 'T1', price: 30000, status: 'available', dateAdded: '2026-09-16' };
const suv = { stockNumber: 'S1', price: 20000, status: 'available', dateAdded: '2026-09-16' };
const inv = (...vehicles) => ({ lastUpdated: '2026-09-16T00:00:00Z', vehicles });

describe('computeInventoryDates', () => {
  const now = d('2026-09-20T00:00:00Z');

  it('dates each vehicle by the commit that introduced its current record', () => {
    const current = inv(truck, suv);
    const history = [
      { date: d('2026-09-16T12:00:00Z'), data: inv(truck, suv) },
      { date: d('2026-09-10T12:00:00Z'), data: inv(truck, { ...suv, price: 22000 }) }, // price drop
      { date: d('2026-09-01T12:00:00Z'), data: inv(truck) }, // suv not yet listed
      { date: d('2026-08-20T12:00:00Z'), data: inv() },
    ];
    const { vehicles, listing } = computeInventoryDates(current, history, now);
    expect(vehicles.get('T1')).toEqual(d('2026-09-01T12:00:00Z'));
    expect(vehicles.get('S1')).toEqual(d('2026-09-16T12:00:00Z'));
    expect(listing).toEqual(d('2026-09-16T12:00:00Z'));
  });

  it('ignores dateAdded churn from the admin publish', () => {
    const current = inv(truck);
    const history = [
      { date: d('2026-09-16T12:00:00Z'), data: inv(truck) },
      { date: d('2026-09-15T12:00:00Z'), data: inv({ ...truck, dateAdded: '2026-09-15' }) },
      { date: d('2026-09-02T12:00:00Z'), data: inv({ ...truck, dateAdded: '2026-09-02' }) },
    ];
    const { vehicles, listing } = computeInventoryDates(current, history, now);
    expect(vehicles.get('T1')).toEqual(d('2026-09-02T12:00:00Z'));
    expect(listing).toEqual(d('2026-09-02T12:00:00Z'));
  });

  it('dates the listing by the last time a vehicle sold or was added', () => {
    const current = inv(truck);
    const history = [
      { date: d('2026-09-16T12:00:00Z'), data: inv(truck) },
      { date: d('2026-09-12T12:00:00Z'), data: inv(truck, suv) }, // suv sold after this
    ];
    const { vehicles, listing } = computeInventoryDates(current, history, now);
    expect(listing).toEqual(d('2026-09-16T12:00:00Z'));
    expect(vehicles.get('T1')).toEqual(d('2026-09-12T12:00:00Z'));
  });

  it('treats sold vehicles as leaving the listing', () => {
    const current = inv(truck, { ...suv, status: 'sold' });
    const history = [
      { date: d('2026-09-16T12:00:00Z'), data: inv(truck, { ...suv, status: 'sold' }) },
      { date: d('2026-09-12T12:00:00Z'), data: inv(truck, suv) },
    ];
    const { vehicles, listing } = computeInventoryDates(current, history, now);
    expect(listing).toEqual(d('2026-09-16T12:00:00Z'));
    expect(vehicles.has('S1')).toBe(false);
  });

  it('uses now for uncommitted local edits', () => {
    const current = inv({ ...truck, price: 1 });
    const history = [{ date: d('2026-09-16T12:00:00Z'), data: inv(truck) }];
    const { vehicles, listing } = computeInventoryDates(current, history, now);
    expect(vehicles.get('T1')).toEqual(now);
    expect(listing).toEqual(now);
  });

  it('stops at an unparseable snapshot', () => {
    const current = inv(truck);
    const history = [
      { date: d('2026-09-16T12:00:00Z'), data: inv(truck) },
      { date: d('2026-09-10T12:00:00Z'), data: null },
      { date: d('2026-09-01T12:00:00Z'), data: inv(truck) },
    ];
    expect(computeInventoryDates(current, history, now).vehicles.get('T1')).toEqual(
      d('2026-09-16T12:00:00Z')
    );
  });
});

describe('latest / formatLastmod', () => {
  it('picks the newest date and ignores nulls', () => {
    expect(latest(null, d('2026-01-02'), [d('2026-03-04'), null])).toEqual(d('2026-03-04'));
    expect(latest(null, [])).toBe(null);
  });

  it('formats a UTC day, or null', () => {
    expect(formatLastmod(d('2026-09-16T23:30:00Z'))).toBe('2026-09-16');
    expect(formatLastmod(null)).toBe(null);
  });
});
