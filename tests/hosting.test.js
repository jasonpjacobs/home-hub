import assert from 'node:assert/strict';
import test from 'node:test';
import { createApiHandler } from '../server/app.js';
import { createDemoSeedData } from '../server/schema.js';

function createMemoryDb() {
  const shared = createDemoSeedData();
  const privByMember = new Map();
  return {
    cache: structuredClone(shared),
    privateCaches: new Map(),
    async getAll() {
      return structuredClone(this.cache);
    },
    async getPrivate(member) {
      const cur = privByMember.get(member.id) || {
        Categories: [],
        Projects: [],
        Tasks: [],
        TaskInstances: [],
      };
      this.privateCaches.set(member.id, { data: structuredClone(cur), timestamp: Date.now() });
      return structuredClone(cur);
    },
    async mutate(fn) {
      const data = structuredClone(this.cache);
      const res = await fn(data);
      this.cache = structuredClone(data);
      return res;
    },
    async mutatePrivate(member, fn) {
      const data = await this.getPrivate(member);
      const res = await fn(data);
      privByMember.set(member.id, structuredClone(data));
      this.privateCaches.set(member.id, { data: structuredClone(data), timestamp: Date.now() });
      return res;
    },
    async getFederated(member, { includePrivate = true } = {}) {
      const s = await this.getAll();
      const p = includePrivate
        ? await this.getPrivate(member)
        : { Categories: [], Projects: [], Tasks: [], TaskInstances: [] };
      const hhId = member.householdId;
      const filterShared = (rows) =>
        rows
          .filter((r) => r.householdId === hhId && r.visibility !== 'private')
          .map((r) => ({ ...r, storageSource: 'shared_sheet' }));
      const tagPriv = (rows) =>
        (rows || []).map((r) => ({
          ...r,
          visibility: 'private',
          ownerId: member.id,
          storageSource: 'personal_sheet',
        }));
      return {
        shared: s,
        priv: p,
        categories: [...filterShared(s.Categories), ...tagPriv(p.Categories)],
        projects: [...filterShared(s.Projects), ...tagPriv(p.Projects)],
        tasks: [...filterShared(s.Tasks), ...tagPriv(p.Tasks)],
        instances: [...filterShared(s.TaskInstances), ...tagPriv(p.TaskInstances)],
      };
    },
    getStatus() {
      return { mode: 'postgres', label: 'PostgreSQL Database (Multi-Family)', connected: true, tabs: [] };
    },
    getPrivateStatus() {
      return { mode: 'postgres_isolated', label: 'PostgreSQL (Isolated Private Scope)', connected: true, tabs: [] };
    },
  };
}

async function callApi(handler, { method = 'GET', path, cookie, body } = {}) {
  const req = {
    method,
    url: path,
    headers: { host: 'localhost:3001', ...(cookie ? { cookie } : {}) },
    body,
  };
  let statusCode = 200;
  let headersOut = {};
  let rawBody = '';
  const res = {
    writeHead(code, hdrs = {}) {
      statusCode = code;
      headersOut = hdrs;
    },
    end(chunk = '') {
      rawBody += chunk;
    },
  };
  await handler(req, res);
  return { status: statusCode, headers: headersOut, data: rawBody ? JSON.parse(rawBody) : null };
}

test('REGISTRATION_CODE gates new household signup, ENABLE_DEMO=false disables demo login, and starter pack seeds a new home', async () => {
  const prevDemo = process.env.ENABLE_DEMO;
  const prevReg = process.env.REGISTRATION_CODE;
  process.env.ENABLE_DEMO = 'false';
  process.env.REGISTRATION_CODE = 'FAM-SECRET';

  try {
    const db = createMemoryDb();
    const handler = createApiHandler(db);

    // 1. /api/auth/me reports demo disabled & registration code required
    const me = await callApi(handler, { path: '/api/auth/me' });
    assert.equal(me.status, 200);
    assert.equal(me.data.demoEnabled, false);
    assert.equal(me.data.demoMembers.length, 0);
    assert.equal(me.data.registrationCodeRequired, true);

    // 2. Demo login is blocked
    const demoAttempt = await callApi(handler, { method: 'POST', path: '/api/auth/demo', body: {} });
    assert.equal(demoAttempt.status, 403);

    // 3. Register without valid code fails
    const badReg = await callApi(handler, {
      method: 'POST',
      path: '/api/auth/register',
      body: {
        householdName: 'Oak House',
        name: 'Taylor',
        email: 'taylor@oak.home',
        password: 'password123',
        registrationCode: 'WRONG',
      },
    });
    assert.equal(badReg.status, 403);

    // 4. Register with valid code succeeds (case-insensitive)
    const okReg = await callApi(handler, {
      method: 'POST',
      path: '/api/auth/register',
      body: {
        householdName: 'Oak House',
        name: 'Taylor',
        email: 'taylor@oak.home',
        password: 'password123',
        registrationCode: 'fam-secret',
      },
    });
    assert.equal(okReg.status, 201);
    const cookie = String(okReg.headers['Set-Cookie'] || '').split(';')[0];
    assert.ok(cookie.startsWith('homehub_session='));

    // 5. Starter pack installs cleanly and is idempotent
    const pack1 = await callApi(handler, {
      method: 'POST',
      path: '/api/onboarding/starter-pack',
      cookie,
      body: {},
    });
    assert.equal(pack1.status, 201);
    assert.equal(pack1.data.createdCount, 5);

    const pack2 = await callApi(handler, {
      method: 'POST',
      path: '/api/onboarding/starter-pack',
      cookie,
      body: {},
    });
    assert.equal(pack2.status, 201);
    assert.equal(pack2.data.createdCount, 0);

    // 6. Password change works
    const pwRes = await callApi(handler, {
      method: 'PATCH',
      path: '/api/profile/password',
      cookie,
      body: { currentPassword: 'password123', newPassword: 'newpassword456' },
    });
    assert.equal(pwRes.status, 200);
  } finally {
    if (prevDemo === undefined) delete process.env.ENABLE_DEMO;
    else process.env.ENABLE_DEMO = prevDemo;
    if (prevReg === undefined) delete process.env.REGISTRATION_CODE;
    else process.env.REGISTRATION_CODE = prevReg;
  }
});
