import { initRolePage } from '../auth/role-access.js';
import {
  apiFetch,
  escHtml,
  formatCurrency,
  formatDateTime,
  showToast,
  statusBadge,
} from '../common/helpers.js';

function renderGauge(pct) {
  const container = document.getElementById('resolution-gauge');
  if (!container) return;
  const totalTicks = 24;
  const filledTicks = Math.round((pct / 100) * totalTicks);
  const ticks = [];
  for (let i = 0; i < totalTicks; i++) {
    const angle = -180 + (i / (totalTicks - 1)) * 180;
    const rad = (angle * Math.PI) / 180;
    const x1 = 100 + Math.cos(rad) * 66;
    const y1 = 100 + Math.sin(rad) * 66;
    const x2 = 100 + Math.cos(rad) * 82;
    const y2 = 100 + Math.sin(rad) * 82;
    const color = i < filledTicks ? '#22C55E' : '#E5E7EB';
    ticks.push(`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${color}" stroke-width="5" stroke-linecap="round"/>`);
  }
  container.innerHTML = `
    <svg viewBox="0 0 200 112" width="210" height="118">
      ${ticks.join('')}
    </svg>
    <div class="gauge-pct">${pct}%</div>
    <div class="gauge-sub">Complaint resolution rate</div>
  `;
}

function renderBarChart(dayCounts) {
  const el = document.getElementById('visitor-bar-chart');
  if (!el) return;
  const max = Math.max(1, ...dayCounts.map((d) => d.count));
  el.innerHTML = dayCounts
    .map((d) => {
      const pct = Math.max(12, Math.round((d.count / max) * 100));
      const isPeak = d.count === max && d.count > 0;
      return `
        <div class="bar-col">
          <span class="bar-count">${d.count}</span>
          <div class="bar-pill ${isPeak ? 'peak' : ''}" style="height:${pct}%;"></div>
          <span class="bar-day">${escHtml(d.day)}</span>
        </div>`;
    })
    .join('');
}

async function initAdminDashboard() {
  try {
    const summary = await apiFetch('/api/residents/dashboard-summary');
    const k = summary.kpis || {};

    document.getElementById('kpi-residents').textContent = k.totalResidents ?? 0;
    document.getElementById('kpi-flats-sub').textContent = `${k.occupiedFlats ?? 0} of ${k.totalFlats ?? 0} flats occupied`;
    document.getElementById('kpi-visitors-inside').textContent = k.checkedInVisitors ?? 0;
    document.getElementById('kpi-visitors-total').textContent = `${k.totalVisitorLogs ?? 0} total gate entries`;
    document.getElementById('kpi-open-complaints').textContent = k.openComplaints ?? 0;
    document.getElementById('kpi-complaints-sub').textContent = `${k.totalComplaints ?? 0} total tickets logged`;
    document.getElementById('kpi-collected').textContent = formatCurrency(k.totalCollected ?? 0);
    document.getElementById('kpi-pending-receipts').textContent = `${k.pendingReceipts ?? 0} receipt(s) pending review`;

    document.getElementById('seg-collected').textContent = formatCurrency(k.totalCollected ?? 0);
    document.getElementById('seg-pending').textContent = formatCurrency(k.totalPending ?? 0);
    document.getElementById('seg-staff').textContent = `${(k.staffCount ?? 0) + (k.guardCount ?? 0)}`;

    const emergencyStrip = document.getElementById('admin-emergency-strip');
    if (emergencyStrip && (k.activeEmergencies || 0) > 0) {
      emergencyStrip.style.display = 'flex';
      document.getElementById('admin-emergency-text').textContent =
        `URGENT: ${k.activeEmergencies} active emergency alert(s) in society!`;
    }

    renderBarChart(summary.dayCounts || []);
    renderGauge(k.resolutionRate ?? 100);

    const tbody = document.getElementById('admin-recent-complaints-tbody');
    const comps = summary.recentComplaints || [];
    tbody.innerHTML = comps.length
      ? comps
          .map(
            (c) => `
          <tr>
            <td><strong>${escHtml(c.title)}</strong></td>
            <td>${escHtml(c.category)}</td>
            <td>${statusBadge(c.priority)}</td>
            <td>${statusBadge(c.status)}</td>
            <td>${formatDateTime(c.created_at)}</td>
          </tr>`
          )
          .join('')
      : '<tr><td colspan="5" class="empty-state">No complaints logged yet.</td></tr>';
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function initReportsPage() {
  try {
    const [summary, billsRes, logsRes, compRes] = await Promise.all([
      apiFetch('/api/residents/dashboard-summary'),
      apiFetch('/api/payments/bills'),
      apiFetch('/api/visitors/logs'),
      apiFetch('/api/complaints'),
    ]);

    const k = summary.kpis || {};
    document.getElementById('rep-collected').textContent = formatCurrency(k.totalCollected ?? 0);
    document.getElementById('rep-pending').textContent = formatCurrency(k.totalPending ?? 0);
    document.getElementById('rep-visitors').textContent = (logsRes.logs || []).length;
    document.getElementById('rep-complaints').textContent = `${(compRes.complaints || []).filter((c) => c.status === 'Resolved').length} / ${(compRes.complaints || []).length}`;

    const bills = billsRes.bills || [];
    const tbody = document.getElementById('reports-bills-tbody');
    tbody.innerHTML = bills.length
      ? bills
          .map(
            (b) => `
          <tr>
            <td>${escHtml(b.flat_label)}</td>
            <td>${escHtml(b.title)}</td>
            <td>${escHtml(b.billing_period)}</td>
            <td>${formatCurrency(b.amount)}</td>
            <td>${statusBadge(b.status)}</td>
          </tr>`
          )
          .join('')
      : '<tr><td colspan="5" class="empty-state">No billing records available.</td></tr>';

    document.getElementById('export-csv-btn')?.addEventListener('click', () => {
      const headers = ['Flat', 'Title', 'Period', 'Amount', 'Due Date', 'Status'];
      const rows = bills.map((b) => [b.flat_label, b.title, b.billing_period, b.amount, b.due_date, b.status]);
      const csv = [headers, ...rows]
        .map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))
        .join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'societyconnect-financial-report.csv';
      a.click();
      URL.revokeObjectURL(url);
    });
  } catch (err) {
    showToast(err.message, 'error');
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const user = await initRolePage('admin');
  if (!user) return;
  const page = document.body.getAttribute('data-page');
  if (page === 'admin-dashboard') await initAdminDashboard();
  if (page === 'admin-reports') await initReportsPage();
});
