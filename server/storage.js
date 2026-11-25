import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  PRIVATE_TAB_NAMES,
  SHEET_TABS,
  TAB_NAMES,
  createDemoPrivateSeedData,
  createDemoSeedData,
  objectToRow,
  rowToObject,
} from './schema.js';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const SHARED_LOCAL_FILE = path.join(DATA_DIR, 'home-hub-v2-shared.json');
const ANALYTICS_LOCAL_FILE = path.join(DATA_DIR, 'home-hub-site-analytics.json');

function base64UrlEncode(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function escapeCsvCell(value) {
  const s = value === undefined || value === null ? '' : String(value);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function tabsToCsvMap(data, tabNames) {
  const out = {};
  for (const tab of tabNames) {
    const headers = SHEET_TABS[tab];
    const rows = (data[tab] || []).map((obj) => objectToRow(tab, obj));
    out[tab] = [
      headers.map(escapeCsvCell).join(','),
      ...rows.map((r) => r.map(escapeCsvCell).join(',')),
    ].join('\n');
  }
  return out;
}

async function readAppsScriptUrl(scriptUrl, token, tabNames) {
  const url = new URL(scriptUrl);
  url.searchParams.set('action', 'readAll');
  if (token) url.searchParams.set('token', token);

  const res = await fetch(url.toString(), { method: 'GET', redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`Apps Script read failed (${res.status}): ${await res.text()}`);
  }
  const payload = await res.json();
  if (!payload.ok) {
    throw new Error(payload.error || 'Apps Script returned an error');
  }

  const result = {};
  for (const tab of tabNames) {
    const rawRows = payload.tabs?.[tab] || [];
    const dataRows =
      rawRows.length > 0 && rawRows[0][0] === SHEET_TABS[tab][0] ? rawRows.slice(1) : rawRows;
    result[tab] = dataRows
      .filter((r) => Array.isArray(r) && r.some((cell) => String(cell ?? '').trim() !== ''))
      .map((r) => rowToObject(tab, r));
  }
  return result;
}

async function writeAppsScriptUrl(scriptUrl, token, data, changedTabs) {
  const payloadTabs = {};
  for (const tab of changedTabs) {
    payloadTabs[tab] = [
      SHEET_TABS[tab],
      ...(data[tab] || []).map((obj) => objectToRow(tab, obj)),
    ];
  }

  const res = await fetch(scriptUrl, {
    method: 'POST',
    redirect: 'follow',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'writeTabs',
      token: token || '',
      tabs: payloadTabs,
    }),
  });
  if (!res.ok) {
    throw new Error(`Apps Script write failed (${res.status}): ${await res.text()}`);
  }
  const body = await res.json();
  if (!body.ok) {
    throw new Error(body.error || 'Apps Script write returned an error');
  }
}

export function isDemoEnabled(env = process.env) {
  if (env.ENABLE_DEMO !== undefined && env.ENABLE_DEMO !== '') {
    return String(env.ENABLE_DEMO).toLowerCase() === 'true' || env.ENABLE_DEMO === '1';
  }
  return env.NODE_ENV !== 'production';
}

export class SheetDatabase {
  constructor(env = process.env) {
    this.env = env;
    this.cache = null;
    this.cacheTimestamp = 0;
    this.cacheTtlMs = 15_000;
    this.accessToken = null;
    this.accessTokenExpiresAt = 0;
    this.lastSyncAt = null;
    this.lastError = null;
    this.writeQueue = Promise.resolve();
    this.pgPool = null;
    this.pgInitialized = false;

    // Per-member Personal Sheet caches & write queues for federated multi-sheet privacy
    this.privateCaches = new Map();
    this.privateQueues = new Map();
  }

  getMode() {
    if (this.env.DATABASE_URL) return 'postgres';
    if (this.env.GOOGLE_APPS_SCRIPT_URL) return 'apps_script';
    if (
      this.env.GOOGLE_SHEET_ID &&
      this.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
      this.env.GOOGLE_PRIVATE_KEY
    ) {
      return 'sheets_api';
    }
    return 'local';
  }

  getStatus() {
    const mode = this.getMode();
    return {
      mode,
      label:
        mode === 'postgres'
          ? 'PostgreSQL Database (Multi-Family)'
          : mode === 'apps_script'
            ? 'Shared Google Sheet (Apps Script)'
            : mode === 'sheets_api'
              ? 'Shared Google Sheet (API v4)'
              : 'Local Sheet Mirror (Demo Mode)',
      connected: mode !== 'local',
      sheetId: this.env.GOOGLE_SHEET_ID || null,
      sheetUrl: this.env.GOOGLE_SHEET_ID
        ? `https://docs.google.com/spreadsheets/d/${this.env.GOOGLE_SHEET_ID}/edit`
        : null,
      appsScriptConfigured: Boolean(this.env.GOOGLE_APPS_SCRIPT_URL),
      lastSyncAt: this.lastSyncAt,
      lastError: this.lastError,
      tabs: TAB_NAMES.map((name) => ({
        name,
        columns: SHEET_TABS[name],
        rowCount: this.cache?.[name]?.length ?? 0,
      })),
    };
  }

  getPrivateStatus(member) {
    const cacheEntry = this.privateCaches.get(member.id);
    const hasPersonalSheet = Boolean(member.privateSheetUrl);
    const isPostgres = this.getMode() === 'postgres';
    return {
      memberId: member.id,
      connected: hasPersonalSheet || isPostgres,
      mode: hasPersonalSheet ? 'apps_script' : isPostgres ? 'postgres_isolated' : 'local_isolated',
      label: hasPersonalSheet
        ? 'Personal Google Sheet Connected'
        : isPostgres
          ? 'PostgreSQL (Isolated Private Scope)'
          : 'Isolated Personal Sheet Mirror (Local)',
      lastSyncAt: cacheEntry?.lastSyncAt || null,
      lastError: cacheEntry?.lastError || null,
      tabs: PRIVATE_TAB_NAMES.map((name) => ({
        name,
        columns: SHEET_TABS[name],
        rowCount: cacheEntry?.data?.[name]?.length ?? 0,
      })),
    };
  }

  async getAll({ forceRefresh = false } = {}) {
    const mode = this.getMode();
    const now = Date.now();
    if (
      !forceRefresh &&
      mode !== 'postgres' &&
      this.cache &&
      now - this.cacheTimestamp < this.cacheTtlMs
    ) {
      return structuredClone(this.cache);
    }

    try {
      let data;
      if (mode === 'postgres') {
        data = await this.#readSharedFromPostgres();
      } else if (mode === 'apps_script') {
        data = await readAppsScriptUrl(
          this.env.GOOGLE_APPS_SCRIPT_URL,
          this.env.GOOGLE_APPS_SCRIPT_TOKEN,
          TAB_NAMES,
        );
      } else if (mode === 'sheets_api') {
        data = await this.#readFromSheetsApi();
      } else {
        data = await this.#readFromLocalShared();
      }
      this.cache = data;
      this.cacheTimestamp = Date.now();
      this.lastSyncAt = new Date().toISOString();
      this.lastError = null;
      return structuredClone(data);
    } catch (err) {
      this.lastError = err.message;
      throw err;
    }
  }

  async mutate(mutatorFn) {
    const task = this.writeQueue.then(async () => {
      const data = await this.getAll({ forceRefresh: false });
      const beforeSnapshots = {};
      for (const tab of TAB_NAMES) {
        beforeSnapshots[tab] = JSON.stringify(data[tab]);
      }

      const result = await mutatorFn(data);

      const changedTabs = TAB_NAMES.filter(
        (tab) => JSON.stringify(data[tab]) !== beforeSnapshots[tab],
      );

      if (changedTabs.length > 0) {
        await this.#writeSharedTabs(data, changedTabs);
      }

      this.cache = structuredClone(data);
      this.cacheTimestamp = Date.now();
      this.lastSyncAt = new Date().toISOString();
      this.lastError = null;
      return result;
    });

    this.writeQueue = task.catch(() => {});
    return task;
  }

  // ---------------------------------------------------------------------------
  // Federated Personal Sheet (Per-Member Isolated Storage)
  // ---------------------------------------------------------------------------
  #privateFilePath(memberId) {
    const safe = String(memberId).replace(/[^a-zA-Z0-9_-]/g, '');
    return path.join(DATA_DIR, `home-hub-v2-private-${safe}.json`);
  }

  async getPrivate(member, { forceRefresh = false } = {}) {
    if (!member) return { Categories: [], Projects: [], Tasks: [], TaskInstances: [] };
    const cached = this.privateCaches.get(member.id);
    if (
      !forceRefresh &&
      this.getMode() !== 'postgres' &&
      cached &&
      Date.now() - cached.timestamp < this.cacheTtlMs
    ) {
      return structuredClone(cached.data);
    }

    try {
      let data;
      if (member.privateSheetUrl) {
        data = await readAppsScriptUrl(
          member.privateSheetUrl,
          member.privateSheetToken || '',
          PRIVATE_TAB_NAMES,
        );
      } else if (this.getMode() === 'postgres') {
        data = await this.#readPrivateFromPostgres(member);
      } else {
        data = await this.#readLocalPrivate(member);
      }
      this.privateCaches.set(member.id, {
        data,
        timestamp: Date.now(),
        lastSyncAt: new Date().toISOString(),
        lastError: null,
      });
      return structuredClone(data);
    } catch (err) {
      this.privateCaches.set(member.id, {
        data: cached?.data || { Categories: [], Projects: [], Tasks: [], TaskInstances: [] },
        timestamp: Date.now(),
        lastSyncAt: cached?.lastSyncAt || null,
        lastError: err.message,
      });
      // Gracefully fall back if a member's external private sheet is temporarily unreachable
      return structuredClone(
        cached?.data || { Categories: [], Projects: [], Tasks: [], TaskInstances: [] },
      );
    }
  }

  async mutatePrivate(member, mutatorFn) {
    const prev = this.privateQueues.get(member.id) || Promise.resolve();
    const task = prev.then(async () => {
      const data = await this.getPrivate(member, { forceRefresh: false });
      const before = {};
      for (const tab of PRIVATE_TAB_NAMES) {
        before[tab] = JSON.stringify(data[tab]);
      }

      const result = await mutatorFn(data);

      const changedTabs = PRIVATE_TAB_NAMES.filter(
        (tab) => JSON.stringify(data[tab]) !== before[tab],
      );

      if (changedTabs.length > 0) {
        if (member.privateSheetUrl) {
          await writeAppsScriptUrl(
            member.privateSheetUrl,
            member.privateSheetToken || '',
            data,
            changedTabs,
          );
        } else if (this.getMode() === 'postgres') {
          await this.#writeToPostgres(`private:${member.id}`, data, changedTabs);
        } else {
          await this.#writeLocalPrivate(member.id, data);
        }
      }

      this.privateCaches.set(member.id, {
        data: structuredClone(data),
        timestamp: Date.now(),
        lastSyncAt: new Date().toISOString(),
        lastError: null,
      });
      return result;
    });

    this.privateQueues.set(member.id, task.catch(() => {}));
    return task;
  }

  async getFederated(member, { includePrivate = true, forceRefresh = false } = {}) {
    const [shared, priv] = await Promise.all([
      this.getAll({ forceRefresh }),
      includePrivate && member
        ? this.getPrivate(member, { forceRefresh })
        : Promise.resolve({ Categories: [], Projects: [], Tasks: [], TaskInstances: [] }),
    ]);

    const hhId = member.householdId;
    const sharedFilter = (row) =>
      row.householdId === hhId &&
      (row.visibility !== 'private' || (includePrivate && row.ownerId === member.id));

    const tagShared = (rows) =>
      rows.filter(sharedFilter).map((r) => ({ ...r, storageSource: 'shared_sheet' }));
    const tagPrivate = (rows) =>
      (rows || []).map((r) => ({
        ...r,
        visibility: 'private',
        ownerId: member.id,
        storageSource: 'personal_sheet',
      }));

    return {
      shared,
      priv,
      categories: [...tagShared(shared.Categories), ...tagPrivate(priv.Categories)],
      projects: [...tagShared(shared.Projects), ...tagPrivate(priv.Projects)],
      tasks: [...tagShared(shared.Tasks), ...tagPrivate(priv.Tasks)],
      instances: [...tagShared(shared.TaskInstances), ...tagPrivate(priv.TaskInstances)],
    };
  }

  async initializeSheet({ seedDemo = false } = {}) {
    const mode = this.getMode();
    if (mode === 'sheets_api') {
      await this.#ensureSheetsApiTabs();
    }
    const existing = await this.getAll({ forceRefresh: true });
    const isEmpty = existing.Households.length === 0 && existing.Members.length === 0;
    if (seedDemo && isEmpty) {
      const seed = createDemoSeedData();
      await this.#writeSharedTabs(seed, TAB_NAMES);
      this.cache = seed;
      this.cacheTimestamp = Date.now();
    } else if (mode === 'apps_script') {
      await this.#writeSharedTabs(existing, TAB_NAMES);
    }
    return this.getStatus();
  }

  async initializePrivateSheet(member) {
    const existing = await this.getPrivate(member, { forceRefresh: true });
    if (member.privateSheetUrl) {
      await writeAppsScriptUrl(
        member.privateSheetUrl,
        member.privateSheetToken || '',
        existing,
        PRIVATE_TAB_NAMES,
      );
    }
    return this.getPrivateStatus(member);
  }

  async exportTabsAsCsv({ scope = 'shared', member = null } = {}) {
    if (scope === 'private' && member) {
      const priv = await this.getPrivate(member);
      return tabsToCsvMap(priv, PRIVATE_TAB_NAMES);
    }
    const shared = await this.getAll();
    return tabsToCsvMap(shared, TAB_NAMES);
  }

  // ---------------------------------------------------------------------------
  // Local Mirrors
  // ---------------------------------------------------------------------------
  async #readFromLocalShared() {
    await fs.mkdir(DATA_DIR, { recursive: true });
    try {
      const raw = await fs.readFile(SHARED_LOCAL_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      const normalized = {};
      for (const tab of TAB_NAMES) {
        normalized[tab] = Array.isArray(parsed[tab]) ? parsed[tab] : [];
      }
      return normalized;
    } catch (err) {
      if (err.code === 'ENOENT') {
        const seed = createDemoSeedData();
        await this.#writeLocalShared(seed);
        return seed;
      }
      throw err;
    }
  }

  async #writeLocalShared(data) {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const tmp = `${SHARED_LOCAL_FILE}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
    await fs.rename(tmp, SHARED_LOCAL_FILE);
  }

  async #readLocalPrivate(member) {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const file = this.#privateFilePath(member.id);
    try {
      const raw = await fs.readFile(file, 'utf8');
      const parsed = JSON.parse(raw);
      const normalized = {};
      for (const tab of PRIVATE_TAB_NAMES) {
        normalized[tab] = Array.isArray(parsed[tab]) ? parsed[tab] : [];
      }
      return normalized;
    } catch (err) {
      if (err.code === 'ENOENT') {
        const seed = createDemoPrivateSeedData(member.id, member.householdId);
        await this.#writeLocalPrivate(member.id, seed);
        return seed;
      }
      throw err;
    }
  }

  async #writeLocalPrivate(memberId, data) {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const file = this.#privateFilePath(memberId);
    const tmp = `${file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
    await fs.rename(tmp, file);
  }

  // ---------------------------------------------------------------------------
  // Direct Google Sheets API v4 (Service Account JWT)
  // ---------------------------------------------------------------------------
  async #getSheetsAccessToken() {
    if (this.accessToken && Date.now() < this.accessTokenExpiresAt - 60_000) {
      return this.accessToken;
    }
    const nowSec = Math.floor(Date.now() / 1000);
    const header = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claimSet = base64UrlEncode(
      JSON.stringify({
        iss: this.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        scope: 'https://www.googleapis.com/auth/spreadsheets',
        aud: 'https://oauth2.googleapis.com/token',
        iat: nowSec,
        exp: nowSec + 3600,
      }),
    );
    const unsignedJwt = `${header}.${claimSet}`;
    const privateKey = this.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n');
    const signer = crypto.createSign('RSA-SHA256');
    signer.update(unsignedJwt);
    const signature = signer
      .sign(privateKey, 'base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: `${unsignedJwt}.${signature}`,
      }),
    });
    if (!res.ok) {
      throw new Error(`Google OAuth token exchange failed (${res.status}): ${await res.text()}`);
    }
    const json = await res.json();
    this.accessToken = json.access_token;
    this.accessTokenExpiresAt = Date.now() + (json.expires_in || 3600) * 1000;
    return this.accessToken;
  }

  async #ensureSheetsApiTabs() {
    const token = await this.#getSheetsAccessToken();
    const sheetId = this.env.GOOGLE_SHEET_ID;
    const metaRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties.title`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!metaRes.ok) {
      throw new Error(`Google Sheet lookup failed (${metaRes.status}): ${await metaRes.text()}`);
    }
    const meta = await metaRes.json();
    const existingTitles = new Set((meta.sheets || []).map((s) => s.properties.title));
    const missing = TAB_NAMES.filter((name) => !existingTitles.has(name));

    if (missing.length > 0) {
      const addRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requests: missing.map((title) => ({
              addSheet: { properties: { title, gridProperties: { frozenRowCount: 1 } } },
            })),
          }),
        },
      );
      if (!addRes.ok) {
        throw new Error(`Failed to create missing sheet tabs (${addRes.status}): ${await addRes.text()}`);
      }
      await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values:batchUpdate`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            valueInputOption: 'RAW',
            data: missing.map((tab) => ({ range: `${tab}!A1`, values: [SHEET_TABS[tab]] })),
          }),
        },
      );
    }
  }

  async #readFromSheetsApi() {
    await this.#ensureSheetsApiTabs();
    const token = await this.#getSheetsAccessToken();
    const sheetId = this.env.GOOGLE_SHEET_ID;
    const ranges = TAB_NAMES.map((t) => `ranges=${encodeURIComponent(`${t}!A:AF`)}`).join('&');
    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values:batchGet?${ranges}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) {
      throw new Error(`Google Sheets read failed (${res.status}): ${await res.text()}`);
    }
    const json = await res.json();
    const result = {};
    (json.valueRanges || []).forEach((vr, idx) => {
      const tab = TAB_NAMES[idx];
      const values = vr.values || [];
      const dataRows =
        values.length > 0 && values[0][0] === SHEET_TABS[tab][0] ? values.slice(1) : values;
      result[tab] = dataRows
        .filter((r) => r.some((cell) => String(cell ?? '').trim() !== ''))
        .map((r) => rowToObject(tab, r));
    });
    for (const tab of TAB_NAMES) {
      if (!result[tab]) result[tab] = [];
    }
    return result;
  }

  async #writeToSheetsApi(data, changedTabs) {
    await this.#ensureSheetsApiTabs();
    const token = await this.#getSheetsAccessToken();
    const sheetId = this.env.GOOGLE_SHEET_ID;
    const clearRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values:batchClear`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ranges: changedTabs.map((t) => `${t}!A:AF`) }),
      },
    );
    if (!clearRes.ok) {
      throw new Error(`Google Sheets clear failed (${clearRes.status}): ${await clearRes.text()}`);
    }
    const updateRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values:batchUpdate`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          valueInputOption: 'RAW',
          data: changedTabs.map((tab) => ({
            range: `${tab}!A1`,
            values: [SHEET_TABS[tab], ...(data[tab] || []).map((obj) => objectToRow(tab, obj))],
          })),
        }),
      },
    );
    if (!updateRes.ok) {
      throw new Error(`Google Sheets update failed (${updateRes.status}): ${await updateRes.text()}`);
    }
  }

  async #writeSharedTabs(data, changedTabs) {
    const mode = this.getMode();
    if (mode === 'postgres') {
      await this.#writeToPostgres('shared', data, changedTabs);
    } else if (mode === 'apps_script') {
      await writeAppsScriptUrl(
        this.env.GOOGLE_APPS_SCRIPT_URL,
        this.env.GOOGLE_APPS_SCRIPT_TOKEN,
        data,
        changedTabs,
      );
    } else if (mode === 'sheets_api') {
      await this.#writeToSheetsApi(data, changedTabs);
    } else {
      await this.#writeLocalShared(data);
    }
  }

  // ---------------------------------------------------------------------------
  // PostgreSQL Adapter (Multi-Family Hosting — Neon / Supabase / Render / Docker)
  // ---------------------------------------------------------------------------
  async #getPgPool() {
    if (!this.pgPool) {
      const pgMod = await import('pg');
      const Pool = pgMod.Pool || pgMod.default?.Pool;
      const connStr = this.env.DATABASE_URL;
      const isLocal =
        /localhost|127\.0\.0\.1|@postgres[:/]|@db[:/]/i.test(connStr) ||
        /sslmode=disable/i.test(connStr);
      this.pgPool = new Pool({
        connectionString: connStr,
        ...(isLocal ? {} : { ssl: { rejectUnauthorized: false } }),
      });
    }
    if (!this.pgInitialized) {
      await this.pgPool.query(`
        CREATE TABLE IF NOT EXISTS home_hub_records (
          scope TEXT NOT NULL,
          tab_name TEXT NOT NULL,
          record_id TEXT NOT NULL,
          household_id TEXT NOT NULL DEFAULT '',
          data JSONB NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (scope, tab_name, record_id)
        );
        CREATE INDEX IF NOT EXISTS idx_home_hub_scope_tab ON home_hub_records (scope, tab_name);
      `);
      this.pgInitialized = true;
    }
    return this.pgPool;
  }

  async #readScopeFromPostgres(scope, tabNames) {
    const pool = await this.#getPgPool();
    const res = await pool.query(
      'SELECT tab_name, data FROM home_hub_records WHERE scope = $1 ORDER BY updated_at ASC, record_id ASC',
      [scope],
    );
    const out = {};
    for (const tab of tabNames) out[tab] = [];
    for (const row of res.rows) {
      if (out[row.tab_name]) {
        out[row.tab_name].push(row.data);
      }
    }
    return out;
  }

  async #readSharedFromPostgres() {
    const data = await this.#readScopeFromPostgres('shared', TAB_NAMES);
    if (data.Households.length === 0 && data.Members.length === 0 && isDemoEnabled(this.env)) {
      const seed = createDemoSeedData();
      await this.#writeToPostgres('shared', seed, TAB_NAMES);
      return seed;
    }
    return data;
  }

  async #readPrivateFromPostgres(member) {
    const scope = `private:${member.id}`;
    const data = await this.#readScopeFromPostgres(scope, PRIVATE_TAB_NAMES);
    const isEmpty = PRIVATE_TAB_NAMES.every((t) => (data[t] || []).length === 0);
    if (isEmpty && member.id === 'mem_maya' && isDemoEnabled(this.env)) {
      const seed = createDemoPrivateSeedData(member.id, member.householdId);
      await this.#writeToPostgres(scope, seed, PRIVATE_TAB_NAMES);
      return seed;
    }
    return data;
  }

  async #writeToPostgres(scope, data, changedTabs) {
    const pool = await this.#getPgPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const tab of changedTabs) {
        await client.query('DELETE FROM home_hub_records WHERE scope = $1 AND tab_name = $2', [
          scope,
          tab,
        ]);
        const rows = data[tab] || [];
        for (let idx = 0; idx < rows.length; idx++) {
          const item = rows[idx];
          const recordId = String(item.id || item.code || `row_${idx}`);
          const householdId = String(item.householdId || '');
          await client.query(
            `INSERT INTO home_hub_records (scope, tab_name, record_id, household_id, data, updated_at)
             VALUES ($1, $2, $3, $4, $5::jsonb, NOW())
             ON CONFLICT (scope, tab_name, record_id)
             DO UPDATE SET data = EXCLUDED.data, household_id = EXCLUDED.household_id, updated_at = NOW()`,
            [scope, tab, recordId, householdId, JSON.stringify(item)],
          );
        }
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // ---------------------------------------------------------------------------
  // Site-Wide Admin Helpers (Analytics Counters & Private Scope Cleanup)
  // ---------------------------------------------------------------------------
  async recordSiteEvent(kind = 'page_view', dateStr) {
    const day =
      dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)
        ? dateStr
        : new Date().toISOString().slice(0, 10);
    const isDemo = kind === 'demo_launch';

    if (this.getMode() === 'postgres') {
      const pool = await this.#getPgPool();
      const pvInc = isDemo ? 0 : 1;
      const demoInc = isDemo ? 1 : 0;
      await pool.query(
        `INSERT INTO home_hub_records (scope, tab_name, record_id, household_id, data, updated_at)
         VALUES ('site_analytics', 'DailyStats', $1, '', jsonb_build_object('date', $1::text, 'pageViews', $2::int, 'demoLaunches', $3::int), NOW())
         ON CONFLICT (scope, tab_name, record_id)
         DO UPDATE SET data = jsonb_build_object(
           'date', $1::text,
           'pageViews', COALESCE((home_hub_records.data->>'pageViews')::int, 0) + $2::int,
           'demoLaunches', COALESCE((home_hub_records.data->>'demoLaunches')::int, 0) + $3::int
         ), updated_at = NOW()`,
        [day, pvInc, demoInc],
      );
      return;
    }

    // Local JSON mirror fallback
    try {
      await fs.mkdir(DATA_DIR, { recursive: true });
      let stats = {};
      try {
        stats = JSON.parse(await fs.readFile(ANALYTICS_LOCAL_FILE, 'utf8'));
      } catch {
        stats = {};
      }
      const cur = stats[day] || { date: day, pageViews: 0, demoLaunches: 0 };
      if (isDemo) cur.demoLaunches += 1;
      else cur.pageViews += 1;
      stats[day] = cur;
      await fs.writeFile(ANALYTICS_LOCAL_FILE, JSON.stringify(stats, null, 2), 'utf8');
    } catch {
      // Non-fatal on read-only FS
    }
  }

  async getSiteAnalytics() {
    if (this.getMode() === 'postgres') {
      const pool = await this.#getPgPool();
      const res = await pool.query(
        `SELECT data FROM home_hub_records
         WHERE scope = 'site_analytics' AND tab_name = 'DailyStats'
         ORDER BY record_id ASC`,
      );
      return res.rows.map((r) => ({
        date: String(r.data?.date || ''),
        pageViews: Number(r.data?.pageViews) || 0,
        demoLaunches: Number(r.data?.demoLaunches) || 0,
      }));
    }
    try {
      const stats = JSON.parse(await fs.readFile(ANALYTICS_LOCAL_FILE, 'utf8'));
      return Object.values(stats)
        .map((r) => ({
          date: String(r.date || ''),
          pageViews: Number(r.pageViews) || 0,
          demoLaunches: Number(r.demoLaunches) || 0,
        }))
        .sort((a, b) => a.date.localeCompare(b.date));
    } catch {
      return [];
    }
  }

  async deletePrivateScope(memberId) {
    if (!memberId) return;
    this.privateCaches.delete(memberId);
    if (this.getMode() === 'postgres') {
      const pool = await this.#getPgPool();
      await pool.query('DELETE FROM home_hub_records WHERE scope = $1', [`private:${memberId}`]);
      return;
    }
    try {
      await fs.unlink(this.#privateFilePath(memberId));
    } catch {
      // Ignore if file doesn't exist
    }
  }
}
