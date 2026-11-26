import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');

function collectJsFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectJsFiles(full, out);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      out.push(full);
    }
  }
  return out;
}

const jsFiles = [
  ...collectJsFiles(path.join(ROOT_DIR, 'backend')),
  ...collectJsFiles(path.join(ROOT_DIR, 'js')),
];

for (const file of jsFiles) {
  execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
}

const requiredHtml = [
  'index.html',
  'login.html',
  'register.html',
  'pages/resident/dashboard.html',
  'pages/resident/profile.html',
  'pages/resident/visitors.html',
  'pages/resident/complaints.html',
  'pages/resident/maintenance-bills.html',
  'pages/resident/emergency.html',
  'pages/resident/notifications.html',
  'pages/guard/dashboard.html',
  'pages/guard/qr-scanner.html',
  'pages/guard/visitor-entry.html',
  'pages/guard/visitor-history.html',
  'pages/guard/walk-in-verification.html',
  'pages/guard/emergency-alerts.html',
  'pages/staff/dashboard.html',
  'pages/staff/assigned-complaints.html',
  'pages/staff/complaint-details.html',
  'pages/admin/dashboard.html',
  'pages/admin/residents.html',
  'pages/admin/visitors.html',
  'pages/admin/complaints.html',
  'pages/admin/staff-management.html',
  'pages/admin/maintenance-bills.html',
  'pages/admin/payments.html',
  'pages/admin/emergency-alerts.html',
  'pages/admin/reports.html',
];

const missing = requiredHtml.filter((rel) => !fs.existsSync(path.join(ROOT_DIR, rel)));
if (missing.length > 0) {
  console.error('Missing required HTML files:', missing);
  process.exit(1);
}

console.log(`Verified ${jsFiles.length} JavaScript modules and ${requiredHtml.length} HTML pages.`);
