import { apiFetch, escHtml, showInlineAlert } from '../common/helpers.js';

let flatsList = [];

function toggleRoleFields() {
  const role = document.getElementById('reg-role').value;
  const flatWrap = document.getElementById('reg-flat-group');
  const staffWrap = document.getElementById('reg-staff-group');
  const flatSelect = document.getElementById('reg-flat');

  if (role === 'resident') {
    flatWrap.style.display = 'flex';
    flatSelect.required = true;
  } else {
    flatWrap.style.display = 'none';
    flatSelect.required = false;
  }

  staffWrap.style.display = role === 'staff' ? 'flex' : 'none';
}

function populateFlats(societyId) {
  const flatSelect = document.getElementById('reg-flat');
  const matching = flatsList.filter((f) => !societyId || f.society_id === societyId);
  if (matching.length === 0) {
    flatSelect.innerHTML = '<option value="">No flats available</option>';
    return;
  }
  flatSelect.innerHTML = matching
    .map(
      (f) =>
        `<option value="${escHtml(f.id)}">Wing ${escHtml(f.wing)} - Flat ${escHtml(f.flat_number)} (Floor ${escHtml(f.floor)})</option>`
    )
    .join('');
}

async function initRegisterPage() {
  try {
    const status = await apiFetch('/api/auth/setup-status');
    const societySelect = document.getElementById('reg-society');
    const roleSelect = document.getElementById('reg-role');
    const adminHint = document.getElementById('admin-claim-hint');

    flatsList = status.flats || [];
    const societies = status.societies || [];

    societySelect.innerHTML = societies
      .map((s) => `<option value="${escHtml(s.id)}">${escHtml(s.name)} (${escHtml(s.city)})</option>`)
      .join('');

    populateFlats(societySelect.value);
    societySelect.addEventListener('change', () => populateFlats(societySelect.value));

    if (!status.hasAdmin) {
      const opt = document.createElement('option');
      opt.value = 'admin';
      opt.textContent = 'Admin (First-Run Society Setup)';
      roleSelect.appendChild(opt);
      if (adminHint) adminHint.style.display = 'block';

      const params = new URLSearchParams(window.location.search);
      if (params.get('role') === 'admin') {
        roleSelect.value = 'admin';
      }
    }

    roleSelect.addEventListener('change', toggleRoleFields);
    toggleRoleFields();
  } catch (err) {
    showInlineAlert('register-alert', err.message, 'error');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initRegisterPage();

  const form = document.getElementById('register-form');
  const submitBtn = document.getElementById('register-submit-btn');

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    showInlineAlert('register-alert', '');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Creating account...';

    const payload = {
      full_name: document.getElementById('reg-name').value.trim(),
      email: document.getElementById('reg-email').value.trim(),
      phone: document.getElementById('reg-phone').value.trim(),
      password: document.getElementById('reg-password').value,
      role: document.getElementById('reg-role').value,
      society_id: document.getElementById('reg-society').value,
      flat_id: document.getElementById('reg-flat').value || null,
      staff_specialty: document.getElementById('reg-specialty').value.trim(),
    };

    try {
      const { user } = await apiFetch('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      window.location.href = `/pages/${user.role}/dashboard.html`;
    } catch (err) {
      showInlineAlert('register-alert', err.message, 'error');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Create Account';
    }
  });
});
