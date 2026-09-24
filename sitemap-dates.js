// sitemap-dates.js — Real <lastmod> dates for generate-sitemap.js, derived from git history
//
// - Vehicle pages: date of the commit that last changed that vehicle's record in inventory.json.
// - Inventory-driven pages (/, /inventory, categories): date the available-vehicle list last changed.
// - Static pages: date of the last commit touching the page's source file(s).
//
// Dates are never invented: without git history, callers fall back to data in inventory.json or
// omit <lastmod>. In a shallow clone, a record unchanged across all fetched history gets the oldest
// fetched commit's date — possibly later than, but never earlier than, the real change.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const INVENTORY_FILE = 'inventory.json';
const MAX_INVENTORY_COMMITS = 300;

// Bookkeeping fields that change without the page content changing. The admin publish rewrites
// every vehicle's dateAdded to the publish date, so it must not count as a change.
const VOLATILE_FIELDS = ['dateAdded'];

function git(args) {
  try {
    return execFileSync('git', args, {
      cwd: __dirname,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

function toDate(value) {
  const d = value instanceof Date ? value : new Date(value || '');
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Latest of the given dates (nulls ignored), or null. */
function latest(...dates) {
  return dates.flat().reduce((max, d) => (d && (!max || d > max) ? d : max), null);
}

/** W3C date for <lastmod> (UTC day). */
function formatLastmod(date) {
  return date ? date.toISOString().slice(0, 10) : null;
}

/** Date of the last commit touching any of `files`, or null if git can't tell. */
function lastCommitDate(files) {
  const out = git(['log', '-1', '--format=%cI', '--', ...files]);
  return out ? toDate(out.trim()) : null;
}

function vehicleKey(v) {
  return String(v.stockNumber || v.vin || v.id || '');
}

function isAvailable(v) {
  return v && (v.status === 'available' || !v.status);
}

/** Stable content fingerprint of a vehicle record, ignoring VOLATILE_FIELDS. */
function vehicleContent(v) {
  const copy = { ...v };
  for (const f of VOLATILE_FIELDS) delete copy[f];
  return JSON.stringify(copy);
}

function availableListing(data) {
  return JSON.stringify(((data && data.vehicles) || []).filter(isAvailable).map(vehicleContent));
}

/**
 * Pure core: given the current inventory and its committed history (newest first), find when each
 * available vehicle's record, and the available listing as a whole, last changed.
 *
 * A value's date is that of the oldest commit in the unbroken run (from newest) where it equals the
 * current value — i.e. the commit that introduced it. If even the newest commit differs (uncommitted
 * local edit), the date is `now`.
 *
 * @param {object} current  parsed inventory.json being built
 * @param {Array<{date: Date, data: object|null}>} history  commits touching inventory.json, newest first
 * @param {Date} now
 */
function computeInventoryDates(current, history, now = new Date()) {
  const available = ((current && current.vehicles) || []).filter(isAvailable);
  const targets = new Map(available.map((v) => [vehicleKey(v), vehicleContent(v)]));
  const vehicles = new Map([...targets.keys()].map((k) => [k, now]));
  const open = new Set(targets.keys());
  const currentListing = availableListing(current);
  let listing = now;
  let listingOpen = true;

  for (const { date, data } of history) {
    if (!open.size && !listingOpen) break;
    const byKey = new Map(((data && data.vehicles) || []).map((v) => [vehicleKey(v), v]));
    for (const key of [...open]) {
      const past = byKey.get(key);
      if (past && vehicleContent(past) === targets.get(key)) vehicles.set(key, date);
      else open.delete(key);
    }
    if (listingOpen) {
      if (data && availableListing(data) === currentListing) listing = date;
      else listingOpen = false;
    }
  }
  return { vehicles, listing };
}

/** History of inventory.json from git (newest first), or null when git history is unavailable. */
function readInventoryHistory(limit = MAX_INVENTORY_COMMITS) {
  const log = git(['log', `-n${limit}`, '--format=%H %cI', '--', INVENTORY_FILE]);
  if (!log || !log.trim()) return null;
  return log
    .trim()
    .split('\n')
    .map((line) => {
      const [sha, iso] = line.split(' ');
      const raw = git(['show', `${sha}:${INVENTORY_FILE}`]);
      let data = null;
      try {
        data = raw ? JSON.parse(raw) : null;
      } catch {
        data = null; // unparseable snapshot counts as "different", ending the run
      }
      return { date: toDate(iso), data };
    });
}

/**
 * @returns {{ vehicle(v): Date|null, listing: Date|null, source: 'git'|'inventory.json' }}
 */
function loadInventoryDates() {
  const current = JSON.parse(fs.readFileSync(path.join(__dirname, INVENTORY_FILE), 'utf8'));
  const history = readInventoryHistory();
  if (history) {
    const { vehicles, listing } = computeInventoryDates(current, history);
    return { vehicle: (v) => vehicles.get(vehicleKey(v)) || null, listing, source: 'git' };
  }
  // No git history (e.g. tarball deploy). inventory.json's own dates only record the last publish:
  // lastUpdated is an upper bound for the listing; dateAdded is rewritten on every publish, so
  // vehicle pages get no <lastmod> rather than a misleading one.
  return { vehicle: () => null, listing: toDate(current.lastUpdated), source: 'inventory.json' };
}

module.exports = {
  computeInventoryDates,
  loadInventoryDates,
  lastCommitDate,
  latest,
  formatLastmod,
  toDate,
};
