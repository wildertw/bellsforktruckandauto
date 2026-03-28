/**
 * Shared utility functions for the admin dashboard.
 */
import { INVENTORY_KEY, state } from './state.js';

export async function sha256Hex(value) {
  const data = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function formatMoney(value) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(value) || 0);
}

export function slugify(text) {
  return String(text || '').toLowerCase().replace(/[^\w\s-]/g, '').replace(/[\s_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90);
}

export function showFeedback(el, msg, isError) {
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hide');
  if (isError) el.classList.add('error');
  else el.classList.remove('error');
}

export function hideFeedback(el) {
  if (el) el.classList.add('hide');
}

export function persistInventory() {
  localStorage.setItem(INVENTORY_KEY, JSON.stringify(state.inventory));
}

// Automotive-aware title case normalization
var DB_UPPER_WORDS = new Set([
  'BMW', 'GMC', 'RAM', 'AMG', 'GT', 'SRT', 'TRD',
  'XLE', 'XSE', 'SE', 'LE', 'LT', 'LTZ', 'AWD', 'FWD', 'RWD', 'SUV',
]);

export function normalizeVehicleText(str) {
  var s = String(str == null ? '' : str).trim().replace(/\s+/g, ' ');
  if (!s) return '';
  return s.toLowerCase().split(' ').filter(Boolean).map(function (word) {
    var bare = word.replace(/-/g, '').toUpperCase();
    if (DB_UPPER_WORDS.has(bare)) return bare;
    return word.split('-').map(function (seg) {
      if (!seg) return seg;
      return seg.charAt(0).toUpperCase() + seg.slice(1);
    }).join('-');
  }).join(' ');
}

// ─── Toast Notifications ──────────────────────────────────────────────────
export function showToast(message, type) {
  var toast = document.getElementById('autoSaveToast');
  if (!toast) return;
  toast.textContent = message;
  toast.className = 'auto-save-toast show';
  if (type) toast.classList.add(type);
}

export function hideToast() {
  var toast = document.getElementById('autoSaveToast');
  if (toast) toast.className = 'auto-save-toast';
}
