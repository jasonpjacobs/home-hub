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

test('magic-request in production never leaks previewLink, hides unknown emails, and enforces cooldown', async () => {
  const prevNodeEnv = process.env.NODE_ENV;
  const prevResend = process.env.RESEND_API_KEY;
  process.env.NODE_ENV = 'production';
  delete process.env.RESEND_API_KEY;

  try {
    const db = createMemoryDb();
    const handler = createApiHandler(db);

    // 1. Unknown email gets generic 200 (no account enumeration, no previewLink)
    const unknownRes = await callApi(handler, {
      method: 'POST',
      path: '/api/auth/magic-request',
      body: { email: 'stranger@unknown.example' },
    });
    assert.equal(unknownRes.status, 200);
    assert.equal(unknownRes.data.previewLink, undefined);

    // 2. Immediate repeat for same email is blocked by 2-minute cooldown
    const repeatRes = await callApi(handler, {
      method: 'POST',
      path: '/api/auth/magic-request',
      body: { email: 'stranger@unknown.example' },
    });
    assert.equal(repeatRes.status, 429);

    // 3. Existing member when email delivery is unavailable returns 503 and NEVER exposes previewLink or stores token
    const existingRes = await callApi(handler, {
      method: 'POST',
      path: '/api/auth/magic-request',
      body: { email: 'maya@maplestreet.home' },
    });
    assert.equal(existingRes.status, 503);
    assert.equal(existingRes.data.previewLink, undefined);
    const maya = db.cache.Members.find((m) => m.email === 'maya@maplestreet.home');
    assert.equal(maya.magicToken, '');
  } finally {
    if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNodeEnv;
    if (prevResend === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = prevResend;
  }
});

test('Site Admin endpoints enforce SITE_ADMIN_EMAILS, report analytics, and cleanly delete households', async () => {
  const prevAdmins = process.env.SITE_ADMIN_EMAILS;
  const prevNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  process.env.SITE_ADMIN_EMAILS = 'admin@site.home';

  try {
    const db = createMemoryDb();
    const events = [];
    const deletedPrivate = [];
    db.recordSiteEvent = async (kind, day) => {
      events.push({ kind, day });
    };
    db.getSiteAnalytics = async () => [
      {
        date: '2026-11-25',
        pageViews: events.filter((e) => e.kind === 'page_view').length,
        demoLaunches: events.filter((e) => e.kind === 'demo_launch').length,
      },
    ];
    db.deletePrivateScope = async (mid) => {
      deletedPrivate.push(mid);
    };

    const handler = createApiHandler(db);

    // Record visits
    await callApi(handler, { method: 'POST', path: '/api/analytics/visit', body: { kind: 'page_view' } });
    await callApi(handler, { method: 'POST', path: '/api/analytics/visit', body: { kind: 'demo_launch' } });

    // Create site admin household + second household
    const adminReg = await callApi(handler, {
      method: 'POST',
      path: '/api/auth/register',
      body: { householdName: 'Host Home', name: 'Jason', email: 'admin@site.home', password: 'password123' },
    });
    const adminCookie = String(adminReg.headers['Set-Cookie']).split(';')[0];

    const otherReg = await callApi(handler, {
      method: 'POST',
      path: '/api/auth/register',
      body: { householdName: 'Guest Family', name: 'Pat', email: 'pat@guest.home', password: 'password123' },
    });
    const otherCookie = String(otherReg.headers['Set-Cookie']).split(';')[0];
    const guestHhId = otherReg.data.household.id;

    // Non-admin is rejected with 403
    const forbidden = await callApi(handler, { path: '/api/admin/overview', cookie: otherCookie });
    assert.equal(forbidden.status, 403);

    // Site admin sees overview & analytics
    const overview = await callApi(handler, { path: '/api/admin/overview', cookie: adminCookie });
    assert.equal(overview.status, 200);
    assert.equal(overview.data.analytics.totalPageViews, 1);
    assert.equal(overview.data.analytics.totalDemoLaunches, 1);
    assert.ok(overview.data.households.some((h) => h.id === guestHhId));

    // Cannot delete own household
    const selfDel = await callApi(handler, {
      method: 'DELETE',
      path: `/api/admin/households/${adminReg.data.household.id}`,
      cookie: adminCookie,
    });
    assert.equal(selfDel.status, 400);

    // Can delete another household and cleans up its private scope
    const delRes = await callApi(handler, {
      method: 'DELETE',
      path: `/api/admin/households/${guestHhId}`,
      cookie: adminCookie,
    });
    assert.equal(delRes.status, 200);
    assert.equal(delRes.data.deletedHouseholdName, 'Guest Family');
    assert.equal(deletedPrivate.length, 1);
    assert.equal(
      db.cache.Households.some((h) => h.id === guestHhId),
      false,
    );
  } finally {
    if (prevAdmins === undefined) delete process.env.SITE_ADMIN_EMAILS;
    else process.env.SITE_ADMIN_EMAILS = prevAdmins;
    if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNodeEnv;
  }
});
