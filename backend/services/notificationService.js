import { insertRow, selectRows } from '../config/db.js';

export async function createNotification({
  userId,
  societyId = null,
  title,
  message,
  type = 'info',
  referenceId = null,
}) {
  if (!userId) return null;
  return insertRow('notifications', {
    user_id: userId,
    society_id: societyId,
    title,
    message,
    type,
    reference_id: referenceId,
    is_read: false,
    created_at: new Date().toISOString(),
  });
}

export async function notifyRole({
  societyId,
  role,
  title,
  message,
  type = 'info',
  referenceId = null,
}) {
  const filters = { role, is_active: true };
  if (societyId) filters.society_id = societyId;
  const users = await selectRows('profiles', { filters });
  const results = [];
  for (const user of users) {
    const n = await createNotification({
      userId: user.id,
      societyId: user.society_id || societyId,
      title,
      message,
      type,
      referenceId,
    });
    results.push(n);
  }
  return results;
}
