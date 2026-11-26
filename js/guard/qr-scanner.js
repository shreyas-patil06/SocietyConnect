import { initRolePage } from '../auth/role-access.js';
import {
  apiFetch,
  escHtml,
  formatDateTime,
  showInlineAlert,
  showToast,
  statusBadge,
} from '../common/helpers.js';

let mediaStream = null;
let scanRaf = null;
let lastScannedToken = '';

function stopCamera() {
  if (scanRaf) {
    cancelAnimationFrame(scanRaf);
    scanRaf = null;
  }
  if (mediaStream) {
    mediaStream.getTracks().forEach((t) => t.stop());
    mediaStream = null;
  }
  const video = document.getElementById('qr-video');
  if (video) video.srcObject = null;
  const placeholder = document.getElementById('scanner-placeholder');
  if (placeholder) placeholder.style.display = 'block';
}

async function verifyQrToken(token) {
  const clean = String(token || '').trim();
  if (!clean) return;
  document.getElementById('manual-qr-input').value = clean;
  showInlineAlert('qr-scan-alert', '');

  const panel = document.getElementById('qr-result-panel');
  panel.innerHTML = '<div style="color:#6B7280;">Verifying QR pass...</div>';

  try {
    const res = await apiFetch('/api/visitors/verify-qr', {
      method: 'POST',
      body: JSON.stringify({ qr_token: clean }),
    });

    const d = res.details || {};
    const isResident = res.kind === 'resident';
    const actionBtn =
      res.recommendedAction === 'check-out'
        ? `<button id="qr-action-checkout" class="btn btn-danger" style="width:100%;margin-top:12px;">Record Gate Check-Out</button>`
        : `<button id="qr-action-checkin" class="btn btn-success" style="width:100%;margin-top:12px;">Verify &amp; Record Check-In</button>`;

    panel.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
        <span class="badge badge-success">Valid ${isResident ? 'Resident QR' : 'Guest Pass'}</span>
        ${d.status ? statusBadge(d.status) : ''}
      </div>
      <div style="font-size:17px;font-weight:700;color:#111827;">${escHtml(d.full_name)}</div>
      <div style="font-size:13px;color:#6B7280;margin-top:4px;">
        Flat: <strong>${escHtml(d.flat_label)}</strong> • Phone: ${escHtml(d.phone || '—')}
      </div>
      ${
        !isResident
          ? `<div style="font-size:13px;color:#374151;margin-top:8px;">
              Host: ${escHtml(d.resident_name)}<br/>
              Purpose: ${escHtml(d.purpose)} (${escHtml(d.pass_type)})<br/>
              Expires: ${formatDateTime(d.expires_at)}
            </div>`
          : ''
      }
      ${actionBtn}
    `;

    document.getElementById('qr-action-checkin')?.addEventListener('click', async () => {
      try {
        await apiFetch('/api/visitors/check-in', {
          method: 'POST',
          body: JSON.stringify({
            qr_token: clean,
            pass_id: d.pass_id || null,
          }),
        });
        showToast('Check-in recorded & resident notified!', 'success');
        await verifyQrToken(clean);
      } catch (err) {
        showInlineAlert('qr-scan-alert', err.message, 'error');
      }
    });

    document.getElementById('qr-action-checkout')?.addEventListener('click', async () => {
      try {
        await apiFetch('/api/visitors/check-out', {
          method: 'POST',
          body: JSON.stringify({
            log_id: res.openLog?.id || null,
            qr_token: clean,
          }),
        });
        showToast('Check-out recorded & resident notified!', 'success');
        panel.innerHTML = '<div class="alert-box alert-success">Check-out recorded successfully. Ready for next scan.</div>';
      } catch (err) {
        showInlineAlert('qr-scan-alert', err.message, 'error');
      }
    });
  } catch (err) {
    panel.innerHTML = `<div class="alert-box alert-error">${escHtml(err.message)}</div>`;
  }
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    showInlineAlert('qr-scan-alert', 'Camera API unavailable in this browser. Upload a QR image or enter token manually.', 'info');
    return;
  }

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    const video = document.getElementById('qr-video');
    const canvas = document.getElementById('qr-canvas');
    const placeholder = document.getElementById('scanner-placeholder');
    if (placeholder) placeholder.style.display = 'none';

    video.srcObject = mediaStream;
    await video.play();

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const tick = () => {
      if (!mediaStream) return;
      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        if (window.jsQR) {
          const code = window.jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: 'dontInvert',
          });
          if (code?.data && code.data !== lastScannedToken) {
            lastScannedToken = code.data;
            stopCamera();
            verifyQrToken(code.data);
            return;
          }
        }
      }
      scanRaf = requestAnimationFrame(tick);
    };
    scanRaf = requestAnimationFrame(tick);
  } catch (err) {
    showInlineAlert('qr-scan-alert', `Camera access denied or unavailable (${err.message}). Use QR Image Upload or Manual Token below.`, 'info');
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const user = await initRolePage('guard');
  if (!user) return;

  document.getElementById('start-camera-btn')?.addEventListener('click', () => {
    lastScannedToken = '';
    startCamera();
  });
  document.getElementById('stop-camera-btn')?.addEventListener('click', stopCamera);

  document.getElementById('manual-qr-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    verifyQrToken(document.getElementById('manual-qr-input').value);
  });

  // Upload QR PNG/JPG to decode with jsQR
  document.getElementById('qr-file-input')?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.getElementById('qr-canvas');
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = window.jsQR ? window.jsQR(imageData.data, imageData.width, imageData.height) : null;
        if (code?.data) {
          verifyQrToken(code.data);
        } else {
          showInlineAlert('qr-scan-alert', 'Could not detect a valid QR code in the selected image.', 'error');
        }
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
});
