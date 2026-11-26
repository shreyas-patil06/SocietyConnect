# SocietyConnect — Smart Housing Society Management System

A full-stack housing society management platform built with **HTML5, CSS3, Vanilla JavaScript (ES6), Node.js, Express.js, and Supabase (PostgreSQL, Authentication, Storage)** — plus an automatic local SQLite persistence engine when Supabase environment variables are not yet configured.

## Key Features by Role

- **Resident**
  - Personal Gate QR Code (unique cryptographic token with regeneration)
  - Guest Pass QR Generator (`Single-Use` or `Multi-Entry` with expiration)
  - Walk-In Visitor Approval Requests (Approve / Reject gate requests)
  - Visitor Check-In / Check-Out History & Notifications
  - Photo-backed Maintenance Complaints & Status Tracking
  - Maintenance Bills, Society UPI Payment QR, and Payment Receipt Upload
  - Emergency SOS Alert Trigger & Live Status Tracker
- **Security Guard**
  - Live Camera & Uploaded Image QR Scanner (`jsQR`) + Manual Token Verification
  - Prevents reuse of expired, revoked, or already-used passes and duplicate check-ins/check-outs
  - Walk-In Visitor Verification: Sends Resident Approval Request + generates 6-digit OTP (10-min expiry, 3-attempt limit); entry is unlocked only after both Resident Approval and OTP Verification
  - Expected Visitors & Currently Inside Queue + Full Audit History
  - Real-Time Emergency Alert Response (Acknowledge, Dispatch, Resolve)
- **Maintenance Staff**
  - Assigned Complaints Dashboard
  - Ticket Details with Resident Photo Evidence
  - Accept Tickets, Log Progress Notes, and Mark Resolved
- **Admin**
  - Society Executive Dashboard (KPIs, Visitor Traffic Chart, Complaint Resolution Gauge)
  - Manage Flats, Residents, Security Guards, and Maintenance Staff
  - Assign Complaints & Update Priorities
  - Configure Society UPI Payment QR, Issue Single/Bulk Maintenance Bills, and Verify/Reject Resident Payment Receipts
  - Monitor Emergency Alerts and Export Financial CSV Reports

---

## Supabase Database & Storage Setup

1. Create a new project in [Supabase](https://supabase.com/).
2. Open the **SQL Editor** in your Supabase dashboard and run the complete script in `database/schema.sql`.
   - This creates all 14 relational tables (`societies`, `flats`, `profiles`, `visitors`, `visitor_passes`, `walkin_requests`, `otp_verifications`, `visitor_logs`, `complaints`, `complaint_assignments`, `maintenance_bills`, `payment_receipts`, `emergency_alerts`, `notifications`), indexes, Row Level Security (RLS) policies, and the `society-uploads` Storage bucket.
3. Optionally seed an initial society and flats in `societies` and `flats` via SQL Editor if starting on an empty Supabase database.
4. Copy `.env.example` to `.env` and fill in your credentials:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (keep strictly server-side; never expose in frontend JS)
   - `SUPABASE_STORAGE_BUCKET=society-uploads`

> **Note:** If `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are left empty, the server automatically runs with a persistent local SQLite database (`database/societyconnect.db`) and local disk storage (`images/uploads/`) so you can test every feature immediately.

---

## Running Locally on Windows PowerShell

```powershell
# 1. Navigate to the project folder
cd SocietyManagementSystem

# 2. Install dependencies
npm install

# 3. Copy environment template and add your keys (optional for local SQLite mode)
Copy-Item .env.example .env

# 4. Verify JavaScript syntax and required pages
npm run build

# 5. Start the Express server on port 3000
npm start
```

Open your browser to `http://localhost:3000`.

### First-Time Login Setup
1. Visit `/register.html?role=admin` (or click **Claim First-Run Admin Account** on `/login.html`) to create the initial Society Admin account.
2. From the Admin dashboard, you can add flats, register residents/guards/staff (or let users self-register on `/register.html`), configure the Society UPI QR, and issue maintenance bills.
