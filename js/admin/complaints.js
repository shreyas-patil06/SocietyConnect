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

let staffList = [];

async function loadStaffOptions() {
  const { users } = await apiFetch('/api/residents/users?role=staff');
  staffList = (users || []).filter((u) => u.is_active);
  const sel = document.getElementById('assign-staff-select');
  sel.innerHTML = staffList.length
    ? staffList
        .map(
          (s) =>
            `<option value="${escHtml(s.id)}">${escHtml(s.full_name)} (${escHtml(s.staff_specialty || 'Maintenance')})</option>`
        )
        .join('')
    : '<option value="">No active maintenance staff available</option>';
}

async function loadComplaints() {
  const { complaints } = await apiFetch('/api/complaints');
  const statusFilter = document.getElementById('admin-comp-status-filter')?.value || 'all';
  const rows = statusFilter === 'all' ? complaints : complaints.filter((c) => c.status === statusFilter);

  const tbody = document.getElementById('admin-complaints-tbody');
  tbody.innerHTML = rows.length
    ? rows
        .map((c) => {
          const photo = safeUrl(c.image_url)
            ? `<a href="${escHtml(safeUrl(c.image_url))}" target="_blank" rel="noopener" class="btn btn-sm btn-outline">Photo</a>`
            : '—';
          return `
            <tr>
              <td>
                <strong>${escHtml(c.title)}</strong>
                <div style="font-size:12px;color:#6B7280;">Flat ${escHtml(c.flat_label)} • ${escHtml(c.resident_name)}</div>
                <div style="font-size:12px;color:#4B5563;margin-top:2px;">${escHtml(c.description)}</div>
              </td>
              <td>${escHtml(c.category)}</td>
              <td>${statusBadge(c.priority)}</td>
              <td>${statusBadge(c.status)}</td>
              <td>${escHtml(c.assigned_staff_name || 'Unassigned')}</td>
              <td>${photo}</td>
              <td>${formatDateTime(c.created_at)}</td>
              <td>
                <div style="display:flex;gap:6px;flex-wrap:wrap;">
                  <button class="btn btn-sm btn-primary" data-assign-comp="${escHtml(c.id)}">Assign / Priority</button>
                  ${
                    c.status !== 'Resolved' && c.status !== 'Rejected'
                      ? `<button class="btn btn-sm btn-soft-danger" data-reject-comp="${escHtml(c.id)}">Reject</button>`
                      : ''
                  }
                </div>
              </td>
            </tr>`;
        })
        .join('')
    : '<tr><td colspan="8" class="empty-state">No complaints match this filter.</td></tr>';

  const compMap = new Map(complaints.map((c) => [c.id, c]));

  tbody.querySelectorAll('[data-assign-comp]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const c = compMap.get(btn.getAttribute('data-assign-comp'));
      if (!c) return;
      document.getElementById('assign-comp-id').value = c.id;
      document.getElementById('assign-comp-title').textContent = `${c.title} (Flat ${c.flat_label})`;
      document.getElementById('assign-priority').value = c.priority || 'Medium';
      if (c.assigned_staff_id) {
        document.getElementById('assign-staff-select').value = c.assigned_staff_id;
      }
      document.getElementById('assign-notes').value = c.progress_notes || '';
      showInlineAlert('assign-modal-alert', '');
      openModal('assign-complaint-modal');
    });
  });

  tbody.querySelectorAll('[data-reject-comp]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await apiFetch(`/api/complaints/${encodeURIComponent(btn.getAttribute('data-reject-comp'))}/status`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'Rejected', resolution_notes: 'Rejected by Admin' }),
        });
        showToast('Complaint marked Rejected', 'success');
        await loadComplaints();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  const user = await initRolePage('admin');
  if (!user) return;

  bindModalDismiss('assign-complaint-modal');
  document.getElementById('close-assign-modal')?.addEventListener('click', () => closeModal('assign-complaint-modal'));

  await Promise.all([loadStaffOptions(), loadComplaints()]);

  document.getElementById('admin-comp-status-filter')?.addEventListener('change', loadComplaints);

  document.getElementById('assign-complaint-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('assign-comp-id').value;
    const staffId = document.getElementById('assign-staff-select').value;
    if (!staffId) {
      showInlineAlert('assign-modal-alert', 'Create a Maintenance Staff account first under Staff & Guards.', 'error');
      return;
    }

    try {
      await apiFetch(`/api/complaints/${encodeURIComponent(id)}/assign`, {
        method: 'PATCH',
        body: JSON.stringify({
          staff_id: staffId,
          priority: document.getElementById('assign-priority').value,
          progress_notes: document.getElementById('assign-notes').value.trim(),
        }),
      });
      closeModal('assign-complaint-modal');
      showToast('Complaint assigned to maintenance staff!', 'success');
      await loadComplaints();
    } catch (err) {
      showInlineAlert('assign-modal-alert', err.message, 'error');
    }
  });
});
