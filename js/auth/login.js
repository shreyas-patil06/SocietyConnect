import { apiFetch, showInlineAlert } from '../common/helpers.js';

async function checkInitialState() {
  try {
    const me = await apiFetch('/api/auth/me');
    if (me?.user?.role) {
      window.location.href = `/pages/${me.user.role}/dashboard.html`;
      return;
    }
  } catch {
    // not logged in
  }

  try {
    const status = await apiFetch('/api/auth/setup-status');
    const banner = document.getElementById('first-run-admin-banner');
    if (banner && !status.hasAdmin) {
      banner.style.display = 'block';
    }
  } catch {
    // ignore
  }
}

document.addEventListener('DOMContentLoaded', () => {
  checkInitialState();

  const form = document.getElementById('login-form');
  const submitBtn = document.getElementById('login-submit-btn');

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    showInlineAlert('login-alert', '');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Signing in...';

    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;

    try {
      const { user } = await apiFetch('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      window.location.href = `/pages/${user.role}/dashboard.html`;
    } catch (err) {
      showInlineAlert('login-alert', err.message, 'error');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Sign In';
    }
  });
});
