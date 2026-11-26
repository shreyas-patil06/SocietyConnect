let cachedConfig = null;

export async function getSupabasePublicConfig() {
  if (cachedConfig) return cachedConfig;
  const res = await fetch('/api/config/public', { credentials: 'same-origin' });
  cachedConfig = await res.json();
  return cachedConfig;
}
