/**
 * Dashboard entry point — orchestrates all modules.
 *
 * Module structure:
 *   state.js   — Shared constants, mutable state, DOM references
 *   utils.js   — Formatting, hashing, toast notifications
 *   auth.js    — Login/logout, session management, blog API wrapper
 *   theme.js   — Dark/light theme toggle
 *   sales.js   — Sales tab charts, filters, KPIs
 *
 * The remaining dashboard functionality (inventory, blog, leads, analytics,
 * vehicle editor, publish pipeline) still lives in the original dashboard.js
 * and should be incrementally migrated into this module structure.
 */

// These modules are extracted and ready for use:
export { state, $, dom, initDomRefs } from './state.js';
export { sha256Hex, formatMoney, slugify, showFeedback, hideFeedback, persistInventory, normalizeVehicleText, showToast, hideToast } from './utils.js';
export { toggleAuth, handleLogin, handleLogout, blogAdminRequest } from './auth.js';
export { applyTheme, toggleTheme } from './theme.js';
export { filterSalesData, refreshSalesViews, initSalesTab } from './sales.js';
