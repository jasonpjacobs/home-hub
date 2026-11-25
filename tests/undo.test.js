import assert from 'node:assert/strict';
import test from 'node:test';
import { createApiHandler } from '../server/app.js';
import { buildSessionCookie } from '../server/auth.js';
import { createDemoPrivateSeedData, createDemoSeedData } from '../server/schema.js';

function createInMemoryDb() {
  const shared = createDemoSeedData();
  const privByMember = new Map([
    ['mem_maya', createDemoPrivateSeedData('mem_maya', 'hh_maple_home')],
  ]);

  const db = {
    cache: structuredClone(shared),
    privateCaches: new Map([
      ['mem_maya', { data: structuredClone(privByMember.get('mem_maya')), timestamp: Date.now() }],
    ]),
    async getAll() {
      return structuredClone(this.cache);
    },
    async getPrivate(member) {
      const cur = this.privateCaches.get(member.id)?.data || {
        Categories: [],
        Projects: [],
        Tasks: [],
        TaskInstances: [],
      };
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
      return { mode: 'memory', label: 'In-Memory Test', connected: false, tabs: [] };
    },
    getPrivateStatus() {
      return { mode: 'memory', label: 'In-Memory Test', connected: false, tabs: [] };
    },
  };
  return db;
}

async function callApi(handler, { method = 'GET', path, cookie, body } = {}) {
  const req = {
    method,
    url: path,
    headers: { host: 'localhost:3001', ...(cookie ? { cookie } : {}) },
    body,
  };
  let statusCode = 200;
  let rawBody = '';
  const res = {
    writeHead(code) {
      statusCode = code;
    },
    end(chunk = '') {
      rawBody += chunk;
    },
  };
  await handler(req, res);
  return { status: statusCode, data: rawBody ? JSON.parse(rawBody) : null };
}

test('Undo & Redo cleanly revert recurring completions and task deletions across shared & private sheets', async () => {
  const db = createInMemoryDb();
  const handler = createApiHandler(db);
  const maya = db.cache.Members.find((m) => m.id === 'mem_maya');
  const cookie = buildSessionCookie(maya).split(';')[0];

  const beforeInstCount = db.cache.TaskInstances.length;

  // 1. Complete a recurring shared task (which also creates a next-cycle pending instance)
  const completeRes = await callApi(handler, {
    method: 'POST',
    path: '/api/instances/inst_trash/complete',
    cookie,
    body: { completed: true },
  });
  assert.equal(completeRes.status, 200);
  assert.equal(completeRes.data.instance.status, 'completed');
  assert.ok(completeRes.data.nextInstance, 'should schedule next recurring instance');
  assert.equal(db.cache.TaskInstances.length, beforeInstCount + 1);

  // 2. Delete a private task
  const privCountBefore = db.privateCaches.get('mem_maya').data.Tasks.length;
  const delRes = await callApi(handler, {
    method: 'DELETE',
    path: '/api/tasks/tsk_priv_pt',
    cookie,
  });
  assert.equal(delRes.status, 200);
  assert.equal(db.privateCaches.get('mem_maya').data.Tasks.length, privCountBefore - 1);

  // 3. First Undo restores the deleted private task
  const undo1 = await callApi(handler, { method: 'POST', path: '/api/undo', cookie });
  assert.equal(undo1.status, 200);
  assert.match(undo1.data.restoredLabel, /Delete "Do shoulder PT exercises"/);
  assert.equal(db.privateCaches.get('mem_maya').data.Tasks.length, privCountBefore);
  assert.equal(undo1.data.undo.canUndo, true);
  assert.equal(undo1.data.undo.canRedo, true);

  // 4. Second Undo reverts the recurring completion AND removes the auto-scheduled next cycle
  const undo2 = await callApi(handler, { method: 'POST', path: '/api/undo', cookie });
  assert.equal(undo2.status, 200);
  assert.match(undo2.data.restoredLabel, /Complete "Take out trash/);
  assert.equal(db.cache.TaskInstances.length, beforeInstCount);
  assert.equal(
    db.cache.TaskInstances.find((i) => i.id === 'inst_trash').status,
    'pending',
  );
  assert.equal(undo2.data.undo.canUndo, false);

  // 5. Redo re-applies the recurring completion cleanly
  const redo1 = await callApi(handler, { method: 'POST', path: '/api/redo', cookie });
  assert.equal(redo1.status, 200);
  assert.equal(db.cache.TaskInstances.length, beforeInstCount + 1);
  assert.equal(
    db.cache.TaskInstances.find((i) => i.id === 'inst_trash').status,
    'completed',
  );
});
