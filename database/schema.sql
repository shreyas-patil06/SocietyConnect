-- ============================================================================
-- SocietyConnect: Smart Housing Society Management System
-- Complete PostgreSQL / Supabase Schema + Row Level Security (RLS) + Storage
-- ============================================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Societies
CREATE TABLE IF NOT EXISTS public.societies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  city TEXT NOT NULL DEFAULT '',
  upi_id TEXT DEFAULT '',
  upi_qr_url TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Flats
CREATE TABLE IF NOT EXISTS public.flats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id UUID NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  wing TEXT NOT NULL DEFAULT 'A',
  flat_number TEXT NOT NULL,
  floor INTEGER NOT NULL DEFAULT 1,
  area_sqft INTEGER DEFAULT 1200,
  occupancy_status TEXT NOT NULL DEFAULT 'Vacant' CHECK (occupancy_status IN ('Occupied', 'Vacant')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (society_id, wing, flat_number)
);

-- 3. Profiles (linked to auth.users in Supabase)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY,
  society_id UUID REFERENCES public.societies(id) ON DELETE SET NULL,
  flat_id UUID REFERENCES public.flats(id) ON DELETE SET NULL,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL CHECK (role IN ('resident', 'guard', 'staff', 'admin')),
  personal_qr_token TEXT UNIQUE,
  staff_specialty TEXT DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  password_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Visitors (master visitor registry)
CREATE TABLE IF NOT EXISTS public.visitors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id UUID NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  visitor_type TEXT NOT NULL DEFAULT 'Guest' CHECK (visitor_type IN ('Guest', 'Delivery', 'Cab', 'Service', 'Walk-in')),
  vehicle_number TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Visitor Passes (cryptographic QR passes created by Residents)
CREATE TABLE IF NOT EXISTS public.visitor_passes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id UUID NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  flat_id UUID NOT NULL REFERENCES public.flats(id) ON DELETE CASCADE,
  resident_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  visitor_id UUID NOT NULL REFERENCES public.visitors(id) ON DELETE CASCADE,
  qr_token TEXT NOT NULL UNIQUE,
  purpose TEXT NOT NULL DEFAULT 'Guest Visit',
  pass_type TEXT NOT NULL DEFAULT 'Single-Use' CHECK (pass_type IN ('Single-Use', 'Multi-Entry')),
  status TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Checked In', 'Checked Out', 'Expired', 'Revoked')),
  valid_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. Walk-in Requests (for unexpected visitors at the gate)
CREATE TABLE IF NOT EXISTS public.walkin_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id UUID NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  flat_id UUID NOT NULL REFERENCES public.flats(id) ON DELETE CASCADE,
  resident_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  guard_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  visitor_id UUID NOT NULL REFERENCES public.visitors(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL DEFAULT 'Walk-in Visit',
  approval_status TEXT NOT NULL DEFAULT 'Pending' CHECK (approval_status IN ('Pending', 'Approved', 'Rejected')),
  otp_verified BOOLEAN NOT NULL DEFAULT FALSE,
  entry_allowed BOOLEAN NOT NULL DEFAULT FALSE,
  resident_note TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  responded_at TIMESTAMPTZ
);

-- 7. OTP Verifications (for walk-in visitor identity verification)
CREATE TABLE IF NOT EXISTS public.otp_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  walkin_request_id UUID NOT NULL REFERENCES public.walkin_requests(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  otp_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. Visitor Logs (entry & exit timestamps)
CREATE TABLE IF NOT EXISTS public.visitor_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id UUID NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  flat_id UUID NOT NULL REFERENCES public.flats(id) ON DELETE CASCADE,
  visitor_id UUID REFERENCES public.visitors(id) ON DELETE SET NULL,
  resident_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  pass_id UUID REFERENCES public.visitor_passes(id) ON DELETE SET NULL,
  walkin_request_id UUID REFERENCES public.walkin_requests(id) ON DELETE SET NULL,
  guard_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  entry_method TEXT NOT NULL CHECK (entry_method IN ('Resident QR', 'Guest QR', 'Walk-in OTP')),
  visitor_name TEXT NOT NULL,
  visitor_phone TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Checked In' CHECK (status IN ('Checked In', 'Checked Out')),
  check_in_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  check_out_time TIMESTAMPTZ,
  notes TEXT DEFAULT ''
);

-- 9. Complaints
CREATE TABLE IF NOT EXISTS public.complaints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id UUID NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  flat_id UUID NOT NULL REFERENCES public.flats(id) ON DELETE CASCADE,
  resident_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('Plumbing', 'Electrical', 'Security', 'Cleaning', 'Lift', 'Parking', 'Other')),
  description TEXT NOT NULL,
  image_url TEXT DEFAULT '',
  priority TEXT NOT NULL DEFAULT 'Medium' CHECK (priority IN ('Low', 'Medium', 'High', 'Urgent')),
  status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Assigned', 'In Progress', 'Resolved', 'Rejected')),
  resolution_notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 10. Complaint Assignments
CREATE TABLE IF NOT EXISTS public.complaint_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  complaint_id UUID NOT NULL REFERENCES public.complaints(id) ON DELETE CASCADE,
  staff_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  assigned_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  staff_status TEXT NOT NULL DEFAULT 'Assigned' CHECK (staff_status IN ('Assigned', 'Accepted', 'In Progress', 'Resolved')),
  progress_notes TEXT DEFAULT '',
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 11. Maintenance Bills
CREATE TABLE IF NOT EXISTS public.maintenance_bills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id UUID NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  flat_id UUID NOT NULL REFERENCES public.flats(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  billing_period TEXT NOT NULL,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  due_date DATE NOT NULL,
  bill_document_url TEXT DEFAULT '',
  description TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Unpaid' CHECK (status IN ('Unpaid', 'Payment Submitted', 'Verified', 'Rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 12. Payment Receipts
CREATE TABLE IF NOT EXISTS public.payment_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id UUID NOT NULL REFERENCES public.maintenance_bills(id) ON DELETE CASCADE,
  society_id UUID NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  flat_id UUID NOT NULL REFERENCES public.flats(id) ON DELETE CASCADE,
  resident_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  transaction_ref TEXT NOT NULL,
  amount_paid NUMERIC(12, 2) NOT NULL CHECK (amount_paid > 0),
  receipt_image_url TEXT NOT NULL,
  verification_status TEXT NOT NULL DEFAULT 'Payment Submitted' CHECK (verification_status IN ('Payment Submitted', 'Verified', 'Rejected')),
  verified_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  admin_remarks TEXT DEFAULT '',
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  verified_at TIMESTAMPTZ
);

-- 13. Emergency Alerts
CREATE TABLE IF NOT EXISTS public.emergency_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id UUID NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  flat_id UUID NOT NULL REFERENCES public.flats(id) ON DELETE CASCADE,
  resident_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  emergency_type TEXT NOT NULL CHECK (emergency_type IN ('Medical', 'Fire', 'Security Threat', 'Lift Stuck', 'Gas Leak', 'Other')),
  severity TEXT NOT NULL DEFAULT 'Critical' CHECK (severity IN ('High', 'Critical')),
  details TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Acknowledged', 'Dispatched', 'Resolved')),
  acknowledged_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  response_notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  acknowledged_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ
);

-- 14. Notifications
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  society_id UUID REFERENCES public.societies(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'info' CHECK (type IN ('visitor', 'complaint', 'billing', 'emergency', 'system', 'info')),
  reference_id UUID,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles(role);
CREATE INDEX IF NOT EXISTS idx_profiles_society ON public.profiles(society_id);
CREATE INDEX IF NOT EXISTS idx_visitor_passes_qr ON public.visitor_passes(qr_token);
CREATE INDEX IF NOT EXISTS idx_visitor_logs_society_time ON public.visitor_logs(society_id, check_in_time DESC);
CREATE INDEX IF NOT EXISTS idx_complaints_resident ON public.complaints(resident_id);
CREATE INDEX IF NOT EXISTS idx_complaints_status ON public.complaints(status);
CREATE INDEX IF NOT EXISTS idx_bills_flat ON public.maintenance_bills(flat_id, status);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON public.notifications(user_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_emergency_society ON public.emergency_alerts(society_id, status, created_at DESC);

-- ============================================================================
-- Helper Function for RLS Role Lookups
-- ============================================================================
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS TEXT
LANGUAGE SQL
STABLE
SECURITY DEFINER
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.current_user_society()
RETURNS UUID
LANGUAGE SQL
STABLE
SECURITY DEFINER
AS $$
  SELECT society_id FROM public.profiles WHERE id = auth.uid();
$$;

-- ============================================================================
-- Enable Row Level Security (RLS) on all tables
-- ============================================================================
ALTER TABLE public.societies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visitor_passes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.walkin_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.otp_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visitor_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.complaints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.complaint_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maintenance_bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.emergency_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Societies & Flats: readable by authenticated users in society (and public registration lookup)
CREATE POLICY "societies_read_all" ON public.societies FOR SELECT USING (TRUE);
CREATE POLICY "societies_admin_write" ON public.societies FOR ALL USING (public.current_user_role() = 'admin');

CREATE POLICY "flats_read_all" ON public.flats FOR SELECT USING (TRUE);
CREATE POLICY "flats_admin_write" ON public.flats FOR ALL USING (public.current_user_role() = 'admin');

-- Profiles: users read/update own profile; admins & guards read society profiles
CREATE POLICY "profiles_read_own_or_staff" ON public.profiles FOR SELECT USING (
  id = auth.uid() OR public.current_user_role() IN ('admin', 'guard', 'staff')
);
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE USING (id = auth.uid());
CREATE POLICY "profiles_admin_all" ON public.profiles FOR ALL USING (public.current_user_role() = 'admin');

-- Visitor Passes: residents manage own flat passes; guards & admins read/update status
CREATE POLICY "passes_resident_own" ON public.visitor_passes FOR ALL USING (
  resident_id = auth.uid() OR public.current_user_role() IN ('admin', 'guard')
);

-- Walkin Requests: guards create/read; residents read/respond to own flat; admins read all
CREATE POLICY "walkin_access" ON public.walkin_requests FOR ALL USING (
  resident_id = auth.uid() OR guard_id = auth.uid() OR public.current_user_role() IN ('admin', 'guard')
);

-- OTP Verifications: backend service role only (never expose OTP hashes directly to clients)
CREATE POLICY "otp_service_only" ON public.otp_verifications FOR ALL USING (FALSE);

-- Visitor Logs: residents view own flat logs; guards & admins manage logs
CREATE POLICY "visitor_logs_access" ON public.visitor_logs FOR SELECT USING (
  resident_id = auth.uid() OR public.current_user_role() IN ('admin', 'guard')
);
CREATE POLICY "visitor_logs_guard_admin_write" ON public.visitor_logs FOR INSERT WITH CHECK (
  public.current_user_role() IN ('admin', 'guard')
);
CREATE POLICY "visitor_logs_guard_admin_update" ON public.visitor_logs FOR UPDATE USING (
  public.current_user_role() IN ('admin', 'guard')
);

-- Complaints: residents create & read own; admins manage all; staff read assigned
CREATE POLICY "complaints_select" ON public.complaints FOR SELECT USING (
  resident_id = auth.uid()
  OR public.current_user_role() = 'admin'
  OR EXISTS (SELECT 1 FROM public.complaint_assignments ca WHERE ca.complaint_id = id AND ca.staff_id = auth.uid())
);
CREATE POLICY "complaints_resident_insert" ON public.complaints FOR INSERT WITH CHECK (resident_id = auth.uid());
CREATE POLICY "complaints_admin_staff_update" ON public.complaints FOR UPDATE USING (
  public.current_user_role() = 'admin'
  OR EXISTS (SELECT 1 FROM public.complaint_assignments ca WHERE ca.complaint_id = id AND ca.staff_id = auth.uid())
);

CREATE POLICY "assignments_select" ON public.complaint_assignments FOR SELECT USING (
  staff_id = auth.uid() OR public.current_user_role() = 'admin'
);
CREATE POLICY "assignments_admin_insert" ON public.complaint_assignments FOR INSERT WITH CHECK (
  public.current_user_role() = 'admin'
);
CREATE POLICY "assignments_staff_update" ON public.complaint_assignments FOR UPDATE USING (
  staff_id = auth.uid() OR public.current_user_role() = 'admin'
);

-- Bills & Receipts
CREATE POLICY "bills_select" ON public.maintenance_bills FOR SELECT USING (
  public.current_user_role() = 'admin'
  OR flat_id = (SELECT flat_id FROM public.profiles WHERE id = auth.uid())
);
CREATE POLICY "bills_admin_write" ON public.maintenance_bills FOR ALL USING (
  public.current_user_role() = 'admin'
);

CREATE POLICY "receipts_select" ON public.payment_receipts FOR SELECT USING (
  resident_id = auth.uid() OR public.current_user_role() = 'admin'
);
CREATE POLICY "receipts_resident_insert" ON public.payment_receipts FOR INSERT WITH CHECK (
  resident_id = auth.uid()
);
CREATE POLICY "receipts_admin_update" ON public.payment_receipts FOR UPDATE USING (
  public.current_user_role() = 'admin'
);

-- Emergency Alerts: residents create & view own; guards & admins view & update all
CREATE POLICY "emergency_select" ON public.emergency_alerts FOR SELECT USING (
  resident_id = auth.uid() OR public.current_user_role() IN ('admin', 'guard')
);
CREATE POLICY "emergency_resident_insert" ON public.emergency_alerts FOR INSERT WITH CHECK (
  resident_id = auth.uid()
);
CREATE POLICY "emergency_guard_admin_update" ON public.emergency_alerts FOR UPDATE USING (
  public.current_user_role() IN ('admin', 'guard')
);

-- Notifications: strictly own notifications
CREATE POLICY "notifications_own" ON public.notifications FOR ALL USING (user_id = auth.uid());

-- ============================================================================
-- Supabase Storage Bucket & Policies (society-uploads)
-- ============================================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('society-uploads', 'society-uploads', TRUE)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "storage_public_read" ON storage.objects
FOR SELECT USING (bucket_id = 'society-uploads');

CREATE POLICY "storage_authenticated_upload" ON storage.objects
FOR INSERT WITH CHECK (bucket_id = 'society-uploads' AND auth.role() = 'authenticated');
