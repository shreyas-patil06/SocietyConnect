import { initRolePage } from '../auth/role-access.js';
import {
  apiFetch,
  escHtml,
  showInlineAlert,
  showToast,
  statusBadge,
} from '../common/helpers.js';

async function initResidentsAndFlatsPage() {
  async function loadData() {
    const [dir, usersRes] = await Promise.all([
      apiFetch('/api/residents/directory'),
      apiFetch('/api/residents/users?role=resident'),
    ]);

    const flats = dir.flats || [];
    const flatSelect = document.getElementById('res-flat-select');
    flatSelect.innerHTML = flats
      .map((f) => `<option value="${escHtml(f.id)}">Wing ${escHtml(f.wing)}-${escHtml(f.flat_number)}</option>`)
      .join('');

    const flatsTbody = document.getElementById('admin-flats-tbody');
    flatsTbody.innerHTML = flats.length
      ? flats
          .map(
            (f) => `
          <tr>
            <td><strong>${escHtml(f.wing)}-${escHtml(f.flat_number)}</strong></td>
            <td>Floor ${escHtml(f.floor)}</td>
            <td>${escHtml(f.area_sqft)} sq.ft</td>
            <td>${statusBadge(f.occupancy_status)}</td>
            <td>${escHtml((f.residents || []).map((r) => r.full_name).join(', ') || 'Vacant')}</td>
          </tr>`
          )
          .join('')
      : '<tr><td colspan="5" class="empty-state">No flats added yet.</td></tr>';

    const residents = usersRes.users || [];
    const resTbody = document.getElementById('admin-residents-tbody');
    resTbody.innerHTML = residents.length
      ? residents
          .map(
            (u) => `
          <tr>
            <td><strong>${escHtml(u.full_name)}</strong><br><small style="color:#6B7280;">${escHtml(u.email)}</small></td>
            <td>${escHtml(u.phone || '—')}</td>
            <td>${escHtml(u.flat_label || 'Unassigned')}</td>
            <td>${u.is_active ? '<span class="badge badge-success">Active</span>' : '<span class="badge badge-danger">Inactive</span>'}</td>
            <td>
              <button class="btn btn-sm btn-outline" data-toggle-user="${escHtml(u.id)}" data-next-active="${!u.is_active}">
                ${u.is_active ? 'Deactivate' : 'Activate'}
              </button>
            </td>
          </tr>`
          )
          .join('')
      : '<tr><td colspan="5" class="empty-state">No residents registered yet.</td></tr>';

    resTbody.querySelectorAll('[data-toggle-user]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await apiFetch(`/api/residents/users/${encodeURIComponent(btn.getAttribute('data-toggle-user'))}`, {
            method: 'PATCH',
            body: JSON.stringify({ is_active: btn.getAttribute('data-next-active') === 'true' }),
          });
          showToast('Resident status updated', 'success');
          await loadData();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });
  }

  await loadData();

  document.getElementById('add-flat-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    showInlineAlert('flat-alert', '');
    try {
      await apiFetch('/api/residents/flats', {
        method: 'POST',
        body: JSON.stringify({
          wing: document.getElementById('flat-wing').value.trim(),
          flat_number: document.getElementById('flat-num').value.trim(),
          floor: Number(document.getElementById('flat-floor').value),
          area_sqft: Number(document.getElementById('flat-area').value),
        }),
      });
      e.target.reset();
      showToast('Flat added successfully', 'success');
      await loadData();
    } catch (err) {
      showInlineAlert('flat-alert', err.message, 'error');
    }
  });

  document.getElementById('add-resident-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    showInlineAlert('res-alert', '');
    try {
      await apiFetch('/api/residents/users', {
        method: 'POST',
        body: JSON.stringify({
          full_name: document.getElementById('res-name').value.trim(),
          email: document.getElementById('res-email').value.trim(),
          phone: document.getElementById('res-phone').value.trim(),
          password: document.getElementById('res-password').value,
          flat_id: document.getElementById('res-flat-select').value,
          role: 'resident',
        }),
      });
      e.target.reset();
      showToast('Resident account created', 'success');
      await loadData();
    } catch (err) {
      showInlineAlert('res-alert', err.message, 'error');
    }
  });
}

async function initStaffManagementPage() {
  async function loadStaffAndGuards() {
    const { users } = await apiFetch('/api/residents/users');
    const team = (users || []).filter((u) => ['guard', 'staff', 'admin'].includes(u.role));
    const tbody = document.getElementById('admin-team-tbody');
    tbody.innerHTML = team.length
      ? team
          .map(
            (u) => `
          <tr>
            <td><strong>${escHtml(u.full_name)}</strong><br><small style="color:#6B7280;">${escHtml(u.email)}</small></td>
            <td>${escHtml(u.phone || '—')}</td>
            <td><span class="badge badge-info" style="text-transform:capitalize;">${escHtml(u.role)}</span></td>
            <td>${escHtml(u.staff_specialty || '—')}</td>
            <td>${u.is_active ? '<span class="badge badge-success">Active</span>' : '<span class="badge badge-danger">Inactive</span>'}</td>
            <td>
              <button class="btn btn-sm btn-outline" data-toggle-team="${escHtml(u.id)}" data-next="${!u.is_active}">
                ${u.is_active ? 'Deactivate' : 'Activate'}
              </button>
            </td>
          </tr>`
          )
          .join('')
      : '<tr><td colspan="6" class="empty-state">No guards or maintenance staff added yet.</td></tr>';

    tbody.querySelectorAll('[data-toggle-team]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await apiFetch(`/api/residents/users/${encodeURIComponent(btn.getAttribute('data-toggle-team'))}`, {
            method: 'PATCH',
            body: JSON.stringify({ is_active: btn.getAttribute('data-next') === 'true' }),
          });
          showToast('Account status updated', 'success');
          await loadStaffAndGuards();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });
  }

  await loadStaffAndGuards();

  document.getElementById('add-team-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    showInlineAlert('team-alert', '');
    try {
      await apiFetch('/api/residents/users', {
        method: 'POST',
        body: JSON.stringify({
          full_name: document.getElementById('team-name').value.trim(),
          email: document.getElementById('team-email').value.trim(),
          phone: document.getElementById('team-phone').value.trim(),
          password: document.getElementById('team-password').value,
          role: document.getElementById('team-role').value,
          staff_specialty: document.getElementById('team-specialty').value.trim(),
        }),
      });
      e.target.reset();
      showToast('Staff/Guard account created', 'success');
      await loadStaffAndGuards();
    } catch (err) {
      showInlineAlert('team-alert', err.message, 'error');
    }
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  const user = await initRolePage('admin');
  if (!user) return;
  const page = document.body.getAttribute('data-page');
  if (page === 'admin-residents') await initResidentsAndFlatsPage();
  if (page === 'admin-staff') await initStaffManagementPage();
});
