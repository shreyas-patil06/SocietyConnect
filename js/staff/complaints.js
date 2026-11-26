import { initRolePage } from '../auth/role-access.js';
import {
  apiFetch,
  bindModalDismiss,
  closeModal,
  escHtml,
  formatDateTime,
  openModal,
  safeUrl,
  showInlineAlert,
  showToast,
  statusBadge,
} from '../common/helpers.js';

async function initAssignedComplaintsPage() {
  const filterEl = document.getElementById('staff-status-filter');
  bindModalDismiss('staff-update-modal');
  document.getElementById('close-staff-modal')?.addEventListener('click', () => closeModal('staff-update-modal'));

  async function renderList() {
    const { complaints } = await apiFetch('/api/complaints');
    const filterVal = filterEl?.value || 'all';
    const rows = filterVal === 'all' ? complaints : complaints.filter((c) => c.status === filterVal);

    const tbody = document.getElementById('staff-complaints-tbody');
    tbody.innerHTML = rows.length
      ? rows
          .map(
            (c) => `
          <tr>
            <td>
              <strong>${escHtml(c.title)}</strong>
              <div style="font-size:12px;color:#6B7280;">Flat ${escHtml(c.flat_label)} • ${escHtml(c.resident_name)}</div>
            </td>
            <td>${escHtml(c.category)}</td>
            <td>${statusBadge(c.priority)}</td>
            <td>${statusBadge(c.status)}</td>
            <td>${escHtml(c.progress_notes || '—')}</td>
            <td>${formatDateTime(c.updated_at)}</td>
            <td>
              <div style="display:flex;gap:6px;flex-wrap:wrap;">
                ${
                  c.status === 'Assigned'
                    ? `<button class="btn btn-sm btn-primary" data-accept-id="${escHtml(c.id)}">Accept</button>`
                    : ''
                }
                ${
                  c.status !== 'Resolved' && c.status !== 'Rejected'
                    ? `<button class="btn btn-sm btn-outline" data-update-id="${escHtml(c.id)}">Update</button>`
                    : ''
                }
                <a href="/pages/staff/complaint-details.html?id=${encodeURIComponent(c.id)}" class="btn btn-sm btn-outline">Details</a>
              </div>
            </td>
          </tr>`
          )
          .join('')
      : '<tr><td colspan="7" class="empty-state">No complaints found for this filter.</td></tr>';

    const compMap = new Map(complaints.map((c) => [c.id, c]));

    tbody.querySelectorAll('[data-accept-id]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await apiFetch(`/api/complaints/${encodeURIComponent(btn.getAttribute('data-accept-id'))}/status`, {
            method: 'PATCH',
            body: JSON.stringify({ status: 'Accepted', progress_notes: 'Accepted by maintenance staff' }),
          });
          showToast('Complaint accepted and moved to In Progress', 'success');
          await renderList();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });

    tbody.querySelectorAll('[data-update-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const c = compMap.get(btn.getAttribute('data-update-id'));
        if (!c) return;
        document.getElementById('upd-comp-id').value = c.id;
        document.getElementById('upd-comp-title').textContent = `${c.title} (Flat ${c.flat_label})`;
        document.getElementById('upd-status').value = c.status === 'Resolved' ? 'Resolved' : 'In Progress';
        document.getElementById('upd-notes').value = c.progress_notes || '';
        showInlineAlert('staff-modal-alert', '');
        openModal('staff-update-modal');
      });
    });
  }

  await renderList();
  filterEl?.addEventListener('change', renderList);

  document.getElementById('staff-update-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('upd-comp-id').value;
    try {
      await apiFetch(`/api/complaints/${encodeURIComponent(id)}/status`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: document.getElementById('upd-status').value,
          progress_notes: document.getElementById('upd-notes').value.trim(),
        }),
      });
      closeModal('staff-update-modal');
      showToast('Ticket progress updated!', 'success');
      await renderList();
    } catch (err) {
      showInlineAlert('staff-modal-alert', err.message, 'error');
    }
  });
}

async function initComplaintDetailsPage() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get('id');
  if (!id) {
    window.location.href = '/pages/staff/assigned-complaints.html';
    return;
  }

  async function loadDetail() {
    try {
      const { complaint: c } = await apiFetch(`/api/complaints/${encodeURIComponent(id)}`);
      document.getElementById('det-title').textContent = c.title;
      document.getElementById('det-desc').textContent = c.description;
      document.getElementById('det-flat').textContent = c.flat_label || '—';
      document.getElementById('det-resident').textContent = `${c.resident_name} (${c.resident_phone || 'No phone'})`;
      document.getElementById('det-category').textContent = c.category;
      document.getElementById('det-priority').innerHTML = statusBadge(c.priority);
      document.getElementById('det-status').innerHTML = statusBadge(c.status);
      document.getElementById('det-created').textContent = formatDateTime(c.created_at);
      document.getElementById('det-notes').value = c.progress_notes || '';
      document.getElementById('det-new-status').value = c.status === 'Resolved' ? 'Resolved' : 'In Progress';

      const photoBox = document.getElementById('det-photo-box');
      if (safeUrl(c.image_url)) {
        photoBox.innerHTML = `<img src="${escHtml(safeUrl(c.image_url))}" alt="Complaint evidence photo" />`;
      } else {
        photoBox.innerHTML = '<p style="color:#6B7280;font-size:13px;">No image uploaded by resident.</p>';
      }
    } catch (err) {
      showInlineAlert('det-alert', err.message, 'error');
    }
  }

  await loadDetail();

  document.getElementById('det-accept-btn')?.addEventListener('click', async () => {
    try {
      await apiFetch(`/api/complaints/${encodeURIComponent(id)}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'Accepted', progress_notes: 'Accepted ticket for inspection' }),
      });
      showToast('Ticket accepted!', 'success');
      await loadDetail();
    } catch (err) {
      showInlineAlert('det-alert', err.message, 'error');
    }
  });

  document.getElementById('det-update-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    showInlineAlert('det-alert', '');
    try {
      await apiFetch(`/api/complaints/${encodeURIComponent(id)}/status`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: document.getElementById('det-new-status').value,
          progress_notes: document.getElementById('det-notes').value.trim(),
        }),
      });
      showInlineAlert('det-alert', 'Complaint progress saved and resident notified.', 'success');
      showToast('Complaint updated', 'success');
      await loadDetail();
    } catch (err) {
      showInlineAlert('det-alert', err.message, 'error');
    }
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  const user = await initRolePage('staff');
  if (!user) return;
  const page = document.body.getAttribute('data-page');
  if (page === 'staff-assigned') await initAssignedComplaintsPage();
  if (page === 'staff-details') await initComplaintDetailsPage();
});
