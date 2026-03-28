/**
 * Shared state and constants for the admin dashboard.
 * All modules import from here to access shared mutable state.
 */

// ─── API Endpoints ────────────────────────────────────────────────────────────
export const INVENTORY_KEY = 'dashboardInventory';
export const BLOG_API = '/.netlify/functions/blog';
export const BLOG_AUTH = '/.netlify/functions/blog-auth';
export const STAGE_API = '/.netlify/functions/inventory-stage';
export const PUBLISH_API = '/.netlify/functions/inventory-publish';
export const NHTSA_API = 'https://vpic.nhtsa.dot.gov/api/vehicles/decodevinvalues';
export const STATS_API = '/.netlify/functions/dashboard-stats';
export const VISION_API = '/.netlify/functions/vehicle-vision';
export const SETTINGS_API = '/.netlify/functions/admin-settings';
export const SALES_API = '/.netlify/functions/sales-data';
export const LEADS_API = '/.netlify/functions/leads';
export const OEM_DETECT_API = '/.netlify/functions/oem-label-detect';
export const DESCRIBE_API = '/.netlify/functions/ai-describe';
export const MPG_LOOKUP_API = '/.netlify/functions/ai-mpg-lookup';

// ─── Mutable State ────────────────────────────────────────────────────────────
// Wrapped in an object so modules can mutate shared state via reference.
export const state = {
  blogToken: '',
  blogUser: '',
  authPasswordHash: '',
  blogPosts: [],
  blogComments: [],
  quillEditor: null,
  currentBlogSlug: '',
  parsedPublishInventory: null,
  currentPeriod: 'week',
  statsCache: { data: null, time: 0, period: '' },
  leadsData: [],
  leadsSummary: {},

  inventory: [],

  currentPage: 1,
  pageSize: 6,
  currentFilter: '',
  editingItem: null,
  filteredInventory: [],
  vinDecodeData: null,
  editVinDecodeData: null,
  editPhotoFiles: [],
  addPhotoFiles: [],
  editKeptImages: [],
  addPreviewIndex: 0,
  editPreviewName: null,
  editFormSnapshot: null,
  selectedSkus: new Set(),

  // Chart.js instances
  trafficChartInstance: null,
  leadSourceChartInstance: null,
  leadTrendChartInstance: null,
  categoryViewsChartInstance: null,
  salesOverTimeInstance: null,
  salesByTypeInstance: null,
  salesByLeadInstance: null,
  chartTextColor: '',
  chartGridColor: '',

  allSalesRecords: [],
};

// ─── DOM References ───────────────────────────────────────────────────────────
export const $ = (id) => document.getElementById(id);
export const dom = {};

export function initDomRefs() {
  dom.authPanel = $('authPanel');
  dom.dashboard = $('dashboard');
  dom.loginForm = $('loginForm');
  dom.loginFeedback = $('loginFeedback');
  dom.currentUser = $('currentUser');
  dom.logoutBtn = $('logoutBtn');
  dom.tabs = document.querySelectorAll('.tab');
  dom.panels = document.querySelectorAll('.tab-panel');
  dom.addForm = $('addInventoryForm');
  dom.addFeedback = $('addFeedback');
  dom.inventoryTableBody = document.querySelector('#inventoryTable tbody');
  dom.editFeedback = $('editFeedback');
  dom.bulkFeedback = $('bulkFeedback');
  dom.bulkProgress = $('bulkProgress');
  dom.exportFilter = $('exportFilter');
  dom.editModal = $('editModal');
  dom.previewModal = $('previewModal');
  dom.previewContent = $('previewContent');
  dom.previewTitle = $('previewTitle');
}
