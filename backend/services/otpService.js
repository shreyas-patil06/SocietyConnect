import crypto from 'node:crypto';
import { SERVER_SECRET } from '../config/supabaseAdmin.js';
import { insertRow, selectOne, updateRows } from '../config/db.js';

const OTP_EXPIRY_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 3;

function hashOtp(otp) {
  return crypto.createHmac('sha256', SERVER_SECRET).update(String(otp)).digest('hex');
}

export async function generateWalkinOtp({ walkinRequestId, phone }) {
  const otp = String(crypto.randomInt(100000, 999999));
  const otpHash = hashOtp(otp);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + OTP_EXPIRY_MINUTES * 60 * 1000).toISOString();

  await insertRow('otp_verifications', {
    walkin_request_id: walkinRequestId,
    phone: String(phone || '').trim(),
    otp_hash: otpHash,
    attempts: 0,
    max_attempts: OTP_MAX_ATTEMPTS,
    verified: false,
    expires_at: expiresAt,
    created_at: now.toISOString(),
  });

  return {
    otp,
    expiresAt,
    maxAttempts: OTP_MAX_ATTEMPTS,
  };
}

export async function verifyWalkinOtp({ walkinRequestId, otp }) {
  const submitted = String(otp || '').trim();
  if (!/^\d{6}$/.test(submitted)) {
    return { valid: false, status: 400, message: 'OTP must be a 6-digit code' };
  }

  const record = await selectOne('otp_verifications', { walkin_request_id: walkinRequestId });
  if (!record) {
    return { valid: false, status: 404, message: 'OTP record not found for this walk-in request' };
  }

  if (record.verified) {
    return { valid: true, status: 200, message: 'OTP already verified' };
  }

  if (new Date() > new Date(record.expires_at)) {
    return { valid: false, status: 400, message: 'OTP has expired. Please generate a new walk-in request.' };
  }

  if (record.attempts >= record.max_attempts) {
    return { valid: false, status: 429, message: 'Maximum OTP verification attempts exceeded.' };
  }

  const candidateHash = hashOtp(submitted);
  const storedBuf = Buffer.from(record.otp_hash, 'hex');
  const candidateBuf = Buffer.from(candidateHash, 'hex');
  const matches =
    storedBuf.length === candidateBuf.length && crypto.timingSafeEqual(storedBuf, candidateBuf);

  if (!matches) {
    const nextAttempts = record.attempts + 1;
    await updateRows('otp_verifications', { id: record.id }, { attempts: nextAttempts });
    const remaining = Math.max(0, record.max_attempts - nextAttempts);
    return {
      valid: false,
      status: 400,
      message:
        remaining > 0
          ? `Invalid OTP. ${remaining} attempt(s) remaining.`
          : 'Invalid OTP. Maximum attempts reached.',
    };
  }

  await updateRows('otp_verifications', { id: record.id }, { verified: true });
  await updateRows('walkin_requests', { id: walkinRequestId }, { otp_verified: true });

  return { valid: true, status: 200, message: 'OTP verified successfully' };
}
