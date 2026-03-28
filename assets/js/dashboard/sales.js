/**
 * Sales Tab — charts, filters, KPIs, table rendering.
 */
import { $, state } from './state.js';
import { formatMoney } from './utils.js';

function getSoldFromInventory() {
  return state.inventory.filter(function (v) { return v.status === 'sold'; }).map(function (v) {
    return {
      vehicleId: v.sku,
      year: v.year || '', make: v.make || '', model: v.model || '', trim: v.trim || '',
      stockNumber: v.stockNumber || v.sku,
      category: v.category || '',
      salePrice: v.salePrice || v.price || 0,
      soldDate: v.soldDate || '',
      salesperson: v.salesperson || '',
      leadType: v.leadType || '',
      buyerName: v.buyerName || '',
    };
  });
}

function mergeSalesRecords(localSold, blobRecords) {
  var map = {};
  blobRecords.forEach(function (r) { map[r.vehicleId] = r; });
  localSold.forEach(function (r) { if (!map[r.vehicleId]) map[r.vehicleId] = r; });
  var list = Object.values(map);
  list.sort(function (a, b) {
    return (b.soldDate || '').localeCompare(a.soldDate || '');
  });
  return list;
}

function populateSalesFilterDropdowns(records) {
  var leadSelect = $('salesFilterLeadType');
  if (leadSelect) {
    var currentVal = leadSelect.value;
    var leads = {};
    records.forEach(function (r) { if (r.leadType) leads[r.leadType] = true; });
    leadSelect.innerHTML = '<option value="All">All</option>';
    Object.keys(leads).sort().forEach(function (lt) {
      var opt = document.createElement('option');
      opt.value = lt; opt.textContent = lt;
      leadSelect.appendChild(opt);
    });
    leadSelect.value = currentVal || 'All';
  }
  var spSelect = $('salesFilterSalesperson');
  if (spSelect) {
    var currentVal2 = spSelect.value;
    var people = {};
    records.forEach(function (r) { if (r.salesperson) people[r.salesperson] = true; });
    spSelect.innerHTML = '<option value="All">All</option>';
    Object.keys(people).sort().forEach(function (sp) {
      var opt = document.createElement('option');
      opt.value = sp; opt.textContent = sp;
      spSelect.appendChild(opt);
    });
    spSelect.value = currentVal2 || 'All';
  }
}

function filterSalesRecords(records) {
  var dateRange = ($('salesFilterDateRange') || {}).value || 'All';
  var leadFilter = ($('salesFilterLeadType') || {}).value || 'All';
  var spFilter = ($('salesFilterSalesperson') || {}).value || 'All';
  var typeFilter = ($('salesFilterType') || {}).value || 'All';

  var now = new Date();
  var todayStr = now.toISOString().split('T')[0];

  return records.filter(function (r) {
    if (dateRange !== 'All' && r.soldDate) {
      var sd = r.soldDate;
      if (dateRange === 'today' && sd !== todayStr) return false;
      if (dateRange === '7d') {
        var d7 = new Date(now.getTime() - 7 * 86400000).toISOString().split('T')[0];
        if (sd < d7) return false;
      }
      if (dateRange === '30d') {
        var d30 = new Date(now.getTime() - 30 * 86400000).toISOString().split('T')[0];
        if (sd < d30) return false;
      }
      if (dateRange === 'thisMonth') {
        var monthStart = todayStr.slice(0, 7);
        if (!sd.startsWith(monthStart)) return false;
      }
    }
    if (leadFilter !== 'All' && r.leadType !== leadFilter) return false;
    if (spFilter !== 'All' && r.salesperson !== spFilter) return false;
    if (typeFilter !== 'All' && r.category !== typeFilter) return false;
    return true;
  });
}

function buildSalesOverTimeData(records) {
  var months = {};
  records.forEach(function (r) {
    if (!r.soldDate) return;
    var m = r.soldDate.slice(0, 7);
    if (!months[m]) months[m] = 0;
    months[m] += Number(r.salePrice) || 0;
  });
  var keys = Object.keys(months).sort();
  return keys.map(function (k) {
    var parts = k.split('-');
    var label = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][parseInt(parts[1], 10) - 1] + ' ' + parts[0].slice(2);
    return { name: label, sales: months[k] };
  });
}

function buildSalesByTypeData(records) {
  var types = {};
  records.forEach(function (r) {
    var cat = r.category || 'Other';
    if (!types[cat]) types[cat] = 0;
    types[cat]++;
  });
  return Object.keys(types).map(function (k) { return { name: k, value: types[k] }; });
}

function buildSalesByLeadData(records) {
  var leads = {};
  records.forEach(function (r) {
    var lt = r.leadType || 'Unknown';
    if (!leads[lt]) leads[lt] = 0;
    leads[lt]++;
  });
  return Object.keys(leads).map(function (k) { return { name: k, value: leads[k] }; });
}

function renderSalesOverTimeChart(data) {
  var canvas = $('salesOverTimeChart');
  if (!canvas || typeof Chart === 'undefined') return;
  if (state.salesOverTimeInstance) { state.salesOverTimeInstance.destroy(); state.salesOverTimeInstance = null; }

  var labels = data.map(function (d) { return d.name; });
  var values = data.map(function (d) { return d.sales; });
  if (!labels.length) { labels = ['No data']; values = [0]; }

  state.salesOverTimeInstance = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Revenue (Area)', type: 'line', data: values,
          backgroundColor: 'rgba(103, 103, 247, 0.15)', borderColor: '#055C9D',
          fill: true, tension: 0.3, pointRadius: 0, order: 2,
        },
        {
          label: 'Revenue (Bar)', data: values,
          backgroundColor: 'rgba(103, 103, 247, 0.35)', borderRadius: 4,
          barPercentage: 0.5, order: 1,
        },
        {
          label: 'Trend', type: 'line', data: values,
          borderColor: '#FF8600', borderWidth: 2, pointRadius: 3,
          pointBackgroundColor: '#FF8600', fill: false, tension: 0.3, order: 0,
        },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: state.chartTextColor, font: { family: "'Space Grotesk'" } } },
        tooltip: { mode: 'index', intersect: false },
      },
      scales: {
        x: { ticks: { color: state.chartTextColor }, grid: { color: state.chartGridColor } },
        y: { ticks: { color: state.chartTextColor }, grid: { color: state.chartGridColor }, beginAtZero: true },
      },
    },
  });
}

function renderDoughnut(canvas, data, colors, setInstance) {
  var instance = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: data.map(function (d) { return d.name; }),
      datasets: [{
        data: data.map(function (d) { return d.value; }),
        backgroundColor: colors.slice(0, data.length),
        borderWidth: 2, borderColor: 'transparent',
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: state.chartTextColor, font: { family: "'Space Grotesk'" }, padding: 12, boxWidth: 12 },
        },
      },
    },
  });
  if (setInstance) setInstance(instance);
}

function renderSalesByTypeChart(data) {
  var canvas = $('salesByTypeChart');
  if (!canvas || typeof Chart === 'undefined') return;
  if (state.salesByTypeInstance) { state.salesByTypeInstance.destroy(); state.salesByTypeInstance = null; }

  var pieColors = ['#6767f7', '#37bc7b', '#f59e0b', '#f2555e', '#1d7cf2', '#e879f9', '#38bdf8', '#fb923c'];
  state.salesByTypeInstance = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: data.map(function (d) { return d.name; }),
      datasets: [{
        data: data.map(function (d) { return d.value; }),
        backgroundColor: pieColors.slice(0, data.length),
        borderWidth: 2, borderColor: 'transparent',
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: state.chartTextColor, font: { family: "'Space Grotesk'" }, padding: 16 },
        },
      },
    },
  });
}

function renderSalesByLeadChart(data) {
  var canvas = $('salesByLeadChart');
  if (!canvas || typeof Chart === 'undefined') return;
  if (state.salesByLeadInstance) { state.salesByLeadInstance.destroy(); state.salesByLeadInstance = null; }
  var pieColors = ['#37bc7b', '#6767f7', '#f59e0b', '#f2555e', '#1d7cf2', '#e879f9', '#38bdf8', '#fb923c', '#a78bfa', '#34d399', '#fbbf24', '#f87171', '#60a5fa', '#c084fc', '#22d3ee', '#fb7185', '#a3e635', '#facc15'];
  renderDoughnut(canvas, data, pieColors, function (instance) { state.salesByLeadInstance = instance; });
}

function renderSalesTable(data) {
  var tbody = $('salesTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';
  if (!data.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="muted" style="text-align:center;padding:24px;">No sales records yet. Mark a vehicle as sold from the Inventory tab.</td></tr>';
    return;
  }
  data.forEach(function (sale) {
    var ymm = [sale.year, sale.make, sale.model].filter(Boolean).join(' ') || sale.vehicleId || '-';
    var tr = document.createElement('tr');
    tr.innerHTML =
      '<td>' + ymm + '</td>' +
      '<td>' + (sale.stockNumber || '-') + '</td>' +
      '<td>' + formatMoney(sale.salePrice || 0) + '</td>' +
      '<td>' + (sale.soldDate || '-') + '</td>' +
      '<td>' + (sale.salesperson || '-') + '</td>' +
      '<td>' + (sale.leadType || '-') + '</td>' +
      '<td>' + (sale.buyerName || '-') + '</td>';
    tbody.appendChild(tr);
  });
}

function updateSalesKpis(records) {
  var total = records.reduce(function (sum, s) { return sum + (Number(s.salePrice) || 0); }, 0);
  var avg = records.length ? Math.round(total / records.length) : 0;
  var el;
  el = $('salesKpiTotal'); if (el) el.textContent = formatMoney(total);
  el = $('salesKpiAvg'); if (el) el.textContent = formatMoney(avg);
  el = $('salesKpiUnits'); if (el) el.textContent = records.length;
}

export function filterSalesData() {
  var filtered = filterSalesRecords(state.allSalesRecords);
  renderSalesTable(filtered);
  updateSalesKpis(filtered);
  renderSalesOverTimeChart(buildSalesOverTimeData(filtered));
  renderSalesByTypeChart(buildSalesByTypeData(filtered));
  renderSalesByLeadChart(buildSalesByLeadData(filtered));
}

export async function refreshSalesViews(readSalesBlob) {
  var localSold = getSoldFromInventory();
  var blobRecords = [];
  try { blobRecords = await readSalesBlob(); } catch (e) { /* local only */ }
  state.allSalesRecords = mergeSalesRecords(localSold, blobRecords);
  populateSalesFilterDropdowns(state.allSalesRecords);
  filterSalesData();
}

var salesTabInitialized = false;
export function initSalesTab(readSalesBlob) {
  if (salesTabInitialized) return;
  salesTabInitialized = true;
  refreshSalesViews(readSalesBlob);
}
