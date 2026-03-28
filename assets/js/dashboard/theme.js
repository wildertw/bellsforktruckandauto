/**
 * Dark / Light theme toggle.
 */
import { $, state } from './state.js';

var currentThemeMode = localStorage.getItem('bf_theme') || 'dark';

export function applyTheme(mode) {
  currentThemeMode = mode;
  if (mode === 'light') {
    document.body.setAttribute('data-theme', 'light');
    state.chartTextColor = 'rgba(15,23,42,0.6)';
    state.chartGridColor = 'rgba(15,23,42,0.08)';
  } else {
    document.body.removeAttribute('data-theme');
    state.chartTextColor = 'rgba(230,237,247,0.7)';
    state.chartGridColor = 'rgba(230,237,247,0.08)';
  }
  var toggleBtn = $('themeToggleBtn');
  if (toggleBtn) toggleBtn.innerHTML = mode === 'light' ? '&#9788;' : '&#9790;';
  localStorage.setItem('bf_theme', mode);
}

export function toggleTheme(onThemeChange) {
  applyTheme(currentThemeMode === 'dark' ? 'light' : 'dark');
  if (onThemeChange) onThemeChange();
}

// Apply theme immediately on import
applyTheme(currentThemeMode);
