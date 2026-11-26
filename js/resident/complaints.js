import { initRolePage } from '../auth/role-access.js';
import {
  apiFetch,
  escHtml,
  formatDateTime,
  safeUrl,
  showInlineAlert,
  showToast,
  statusBadge,
} from '../common/helpers.js';
import { bindFilePreview } from '../common/upload.js';

async function loadComplaints() {
  const { complaints } = await apiFetch('/api/complaints');
  const tbody = document.getElementById('resident-complaints-tbody');
  tbody.innerHTML = complaints.length
    ? complaints
        .map((c) => {
          const imgLink = safeUrl(c.image_url)
            ? `<a href="${escHtml(safeUrl(c.image_url))}" target="_blank" rel="noopener"><img src="${escHtml(safeUrl(c.image_url))}" class="thumb-img" alt="Complaint photo" /></a>`
            : '<span style="color:#9CA3AF;">None</span>';
          return `
            <tr>
              <td>
                <strong>${escHtml(c.title)}</strong>
                <div style="font-size:12px;color:#6B7280;margin-top:2px;">${escHtml(c.description)}</div>
              </td>
              <td>${escHtml(c.category)}</td>
              <td>${statusBadge(c.priority)}</td>
              <td>${statusBadge(c.status)}</td>
              <td>${escHtml(c.assigned_staff_name || 'Unassigned')}${c.progress_notes ? `<br><small style="color:#6B7280;">${escHtml(c.progress_notes)}</small>` : ''}</td>
              <td>${imgLink}</td>
              <td>${formatDateTime(c.created_at)}</td>
            </tr>`;
        })
        .join('')
    : '<tr><td colspan="7" class="empty-state">You have not submitted any complaints yet.</td></tr>';
}

document.addEventListener('DOMContentLoaded', async () => {
  const user = await initRolePage('resident');
  if (!user) return;

  bindFilePreview('comp-image', 'comp-image-preview');
  await loadComplaints();

  document.getElementById('complaint-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    showInlineAlert('complaint-alert', '');
    const btn = document.getElementById('complaint-submit-btn');
    btn.disabled = true;
    btn.textContent = 'Submitting...';

    const fd = new FormData();
    fd.append('title', document.getElementById('comp-title').value.trim());
    fd.append('category', document.getElementById('comp-category').value);
    fd.append('priority', document.getElementById('comp-priority').value);
    fd.append('description', document.getElementById('comp-desc').value.trim());
    const file = document.getElementById('comp-image').files?.[0];
    if (file) fd.append('image', file);

    try {
      await apiFetch('/api/complaints', { method: 'POST', body: fd });
      e.target.reset();
      document.getElementById('comp-image-preview').innerHTML = '';
      showInlineAlert('complaint-alert', 'Complaint submitted successfully.', 'success');
      showToast('Complaint submitted', 'success');
      await loadComplaints();
    } catch (err) {
      showInlineAlert('complaint-alert', err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Submit Complaint';
    }
  });
});
