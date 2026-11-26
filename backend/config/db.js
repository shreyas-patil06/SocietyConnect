import crypto from 'node:crypto';
import {
  isSupabaseConfigured,
  supabaseAdmin,
  getSqliteDb,
} from './supabaseAdmin.js';

const BOOL_COLS = new Set([
  'is_active',
  'otp_verified',
  'entry_allowed',
  'verified',
  'is_read',
]);

function normalizeRow(row) {
  if (!row) return null;
  const out = { ...row };
  for (const key of Object.keys(out)) {
    if (BOOL_COLS.has(key) && (out[key] === 0 || out[key] === 1)) {
      out[key] = Boolean(out[key]);
    }
  }
  return out;
}

function toSqliteVal(val) {
  if (typeof val === 'boolean') return val ? 1 : 0;
  if (val === undefined) return null;
  return val;
}

const VALID_TABLES = new Set([
  'societies',
  'flats',
  'profiles',
  'visitors',
  'visitor_passes',
  'walkin_requests',
  'otp_verifications',
  'visitor_logs',
  'complaints',
  'complaint_assignments',
  'maintenance_bills',
  'payment_receipts',
  'emergency_alerts',
  'notifications',
]);

function assertValidTable(table) {
  if (!VALID_TABLES.has(table)) {
    throw new Error(`Invalid table name: ${table}`);
  }
}

function assertValidCol(col) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(col)) {
    throw new Error(`Invalid column name: ${col}`);
  }
}

export async function selectRows(table, { filters = {}, orderBy = null, ascending = false, limit = null } = {}) {
  assertValidTable(table);

  if (isSupabaseConfigured()) {
    let query = supabaseAdmin.from(table).select('*');
    for (const [col, val] of Object.entries(filters)) {
      assertValidCol(col);
      if (val === null) {
        query = query.is(col, null);
      } else if (Array.isArray(val)) {
        query = query.in(col, val);
      } else {
        query = query.eq(col, val);
      }
    }
    if (orderBy) {
      assertValidCol(orderBy);
      query = query.order(orderBy, { ascending });
    }
    if (limit) {
      query = query.limit(limit);
    }
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return (data || []).map(normalizeRow);
  }

  const db = getSqliteDb();
  const whereClauses = [];
  const params = [];

  for (const [col, val] of Object.entries(filters)) {
    assertValidCol(col);
    if (val === null) {
      whereClauses.push(`${col} IS NULL`);
    } else if (Array.isArray(val)) {
      if (val.length === 0) return [];
      const placeholders = val.map(() => '?').join(', ');
      whereClauses.push(`${col} IN (${placeholders})`);
      for (const item of val) params.push(toSqliteVal(item));
    } else {
      whereClauses.push(`${col} = ?`);
      params.push(toSqliteVal(val));
    }
  }

  let sql = `SELECT * FROM ${table}`;
  if (whereClauses.length > 0) {
    sql += ` WHERE ${whereClauses.join(' AND ')}`;
  }
  if (orderBy) {
    assertValidCol(orderBy);
    sql += ` ORDER BY ${orderBy} ${ascending ? 'ASC' : 'DESC'}`;
  }
  if (limit) {
    sql += ` LIMIT ${Number(limit)}`;
  }

  const rows = db.prepare(sql).all(...params);
  return rows.map(normalizeRow);
}

export async function selectOne(table, filters = {}) {
  const rows = await selectRows(table, { filters, limit: 1 });
  return rows[0] || null;
}

export async function insertRow(table, payload) {
  assertValidTable(table);
  const now = new Date().toISOString();
  const record = {
    id: payload.id || crypto.randomUUID(),
    ...payload,
  };

  if (isSupabaseConfigured()) {
    const { data, error } = await supabaseAdmin.from(table).insert(record).select('*').single();
    if (error) throw new Error(error.message);
    return normalizeRow(data);
  }

  const db = getSqliteDb();
  const cols = Object.keys(record);
  for (const col of cols) assertValidCol(col);
  const placeholders = cols.map(() => '?').join(', ');
  const vals = cols.map((c) => toSqliteVal(record[c]));
  const sql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`;
  db.prepare(sql).run(...vals);
  return selectOne(table, { id: record.id });
}

export async function updateRows(table, filters, updates) {
  assertValidTable(table);
  const updateEntries = Object.entries(updates);
  if (updateEntries.length === 0) return [];

  if (isSupabaseConfigured()) {
    let query = supabaseAdmin.from(table).update(updates);
    for (const [col, val] of Object.entries(filters)) {
      assertValidCol(col);
      if (val === null) query = query.is(col, null);
      else query = query.eq(col, val);
    }
    const { data, error } = await query.select('*');
    if (error) throw new Error(error.message);
    return (data || []).map(normalizeRow);
  }

  const db = getSqliteDb();
  const setClauses = [];
  const params = [];
  for (const [col, val] of updateEntries) {
    assertValidCol(col);
    setClauses.push(`${col} = ?`);
    params.push(toSqliteVal(val));
  }

  const whereClauses = [];
  for (const [col, val] of Object.entries(filters)) {
    assertValidCol(col);
    if (val === null) {
      whereClauses.push(`${col} IS NULL`);
    } else {
      whereClauses.push(`${col} = ?`);
      params.push(toSqliteVal(val));
    }
  }

  if (whereClauses.length === 0) {
    throw new Error('updateRows requires at least one filter');
  }

  const sql = `UPDATE ${table} SET ${setClauses.join(', ')} WHERE ${whereClauses.join(' AND ')}`;
  db.prepare(sql).run(...params);
  return selectRows(table, { filters });
}

export async function deleteRows(table, filters) {
  assertValidTable(table);
  if (Object.keys(filters).length === 0) {
    throw new Error('deleteRows requires at least one filter');
  }

  if (isSupabaseConfigured()) {
    let query = supabaseAdmin.from(table).delete();
    for (const [col, val] of Object.entries(filters)) {
      assertValidCol(col);
      query = query.eq(col, val);
    }
    const { error } = await query;
    if (error) throw new Error(error.message);
    return true;
  }

  const db = getSqliteDb();
  const whereClauses = [];
  const params = [];
  for (const [col, val] of Object.entries(filters)) {
    assertValidCol(col);
    whereClauses.push(`${col} = ?`);
    params.push(toSqliteVal(val));
  }
  const sql = `DELETE FROM ${table} WHERE ${whereClauses.join(' AND ')}`;
  db.prepare(sql).run(...params);
  return true;
}

export async function countRows(table, filters = {}) {
  const rows = await selectRows(table, { filters });
  return rows.length;
}
