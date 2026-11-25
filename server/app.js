import crypto from 'node:crypto';
import {
  buildClearSessionCookie,
  buildSessionCookie,
  getSessionFromRequest,
  sanitizeMember,
} from './auth.js';
import { buildOpenApiSpec } from './openapi.js';
import {
  buildDailyDigestNotifications,
  buildOverdueAlertNotifications,
  deliverExternalNotification,
} from './reminders.js';
import { hashApiKey, hashPassword, makeId, verifyPassword } from './schema.js';
import { SheetDatabase, isDemoEnabled } from './storage.js';
import {
  addDays,
  buildCategoryPathMap,
  buildInstanceFromTask,
  computeHabitStats,
  computeMemberLoads,
  computeNextDueDate,
  computeRebalancePlan,
  diffDays,
  generateUpcomingSchedule,
  getTodayStr,
  isMemberEligibleForInstance,
  isOpenStatus,
  reconcileOverdueInstances,
} from './taskEngine.js';
import {
  WEATHER_SIMULATION_PRESETS,
  WEATHER_TRIGGERS,
  evaluateWeatherAlerts,
  getTenDayForecast,
} from './weather.js';

const AVATAR_PALETTE = [
  '#2D6A4F',
  '#C86D51',
  '#3B6E8C',
  '#8B5E83',
  '#B07D2B',
  '#4A7C59',
  '#9C4A5B',
  '#4F5D75',
];

function sendJson(res, status, data, extraHeaders = {}) {
  if (typeof res._finalizeUndo === 'function') {
    try {
      res._finalizeUndo(status, data);
    } catch {
      // Never block response if undo tracking fails
    }
    res._finalizeUndo = null;
  }
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(body);
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw Object.assign(new Error('Invalid JSON payload'), { status: 400 });
  }
}

function getAppUrl(req) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, '');
  const proto = req.headers['x-forwarded-proto'] || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3001';
  return `${proto}://${host}`;
}

function isSecureRequest(req) {
  return (
    req.headers['x-forwarded-proto'] === 'https' ||
    (process.env.APP_URL || '').startsWith('https://')
  );
}

function makeInviteCode(householdName = 'HOME') {
  const prefix =
    householdName
      .replace(/[^A-Za-z]/g, '')
      .toUpperCase()
      .slice(0, 5) || 'HOME';
  const rand = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `${prefix}-${rand}`;
}

function sanitizeSafeMember(m) {
  const safe = sanitizeMember(m);
  if (!safe) return null;
  const { privateSheetToken, ...rest } = safe;
  return {
    ...rest,
    privateSheetConnected: Boolean(m.privateSheetUrl),
  };
}

const DATA_TABS = ['Categories', 'Projects', 'Tasks', 'TaskInstances'];
const MAX_UNDO_HISTORY = 25;

function isUndoableRoute(method, normalizedPath) {
  if (!['POST', 'PATCH', 'DELETE'].includes(method)) return false;
  if (normalizedPath === '/api/undo' || normalizedPath === '/api/redo') return false;
  if (normalizedPath === '/api/distribution/preview') return false;
  return (
    normalizedPath === '/api/tasks' ||
    normalizedPath.startsWith('/api/tasks/') ||
    normalizedPath === '/api/instances' ||
    normalizedPath.startsWith('/api/instances/') ||
    normalizedPath === '/api/projects' ||
    normalizedPath.startsWith('/api/projects/') ||
    normalizedPath === '/api/categories' ||
    normalizedPath.startsWith('/api/categories/') ||
    normalizedPath === '/api/schedule/generate' ||
    normalizedPath === '/api/distribution/apply'
  );
}

function findEntityTitleInSnapshot(snap, tab, id) {
  for (const scope of [snap.shared, snap.priv]) {
    const found = (scope?.[tab] || []).find((r) => r.id === id);
    if (found) return found.taskTitle || found.title || found.name || '';
  }
  return '';
}

function describeUndoAction(method, normalizedPath, responseData, beforeSnap) {
  const quote = (s) => (s ? ` "${String(s).slice(0, 42)}"` : '');
  const instTitle = responseData?.instance?.taskTitle || '';
  const taskTitle = responseData?.task?.title || '';
  const projTitle = responseData?.project?.title || '';
  const catName = responseData?.category?.name || '';

  if (method === 'POST' && /^\/api\/instances\/[^/]+\/complete$/.test(normalizedPath)) {
    return responseData?.instance?.status === 'completed'
      ? `Complete${quote(instTitle)}`
      : `Re-open${quote(instTitle)}`;
  }
  if (method === 'POST' && /^\/api\/instances\/[^/]+\/skip$/.test(normalizedPath)) {
    return `Skip${quote(instTitle)}`;
  }
  if (method === 'POST' && /^\/api\/instances\/[^/]+\/defer$/.test(normalizedPath)) {
    return `Defer${quote(instTitle)}`;
  }
  if (method === 'POST' && /^\/api\/instances\/[^/]+\/claim$/.test(normalizedPath)) {
    return responseData?.instance?.assigneeId ? `Claim${quote(instTitle)}` : `Unclaim${quote(instTitle)}`;
  }
  if (method === 'POST' && normalizedPath === '/api/instances/ad-hoc') {
    return `Log${quote(instTitle)}`;
  }
  if (method === 'PATCH' && normalizedPath.startsWith('/api/instances/')) {
    return `Update${quote(instTitle)}`;
  }
  if (method === 'DELETE' && normalizedPath.startsWith('/api/instances/')) {
    const id = normalizedPath.slice('/api/instances/'.length);
    return `Delete${quote(findEntityTitleInSnapshot(beforeSnap, 'TaskInstances', id)) || ' occurrence'}`;
  }
  if (method === 'POST' && /^\/api\/tasks\/[^/]+\/quick-complete$/.test(normalizedPath)) {
    return `Complete${quote(instTitle)}`;
  }
  if (method === 'POST' && normalizedPath === '/api/tasks/quick-log') {
    return `Quick-log${quote(taskTitle || instTitle)}`;
  }
  if (method === 'POST' && normalizedPath === '/api/tasks/reorder') {
    return 'Reorder tasks';
  }
  if (method === 'POST' && normalizedPath === '/api/tasks/bulk') {
    return `Add ${responseData?.createdCount || ''} tasks`.trim();
  }
  if (method === 'POST' && normalizedPath === '/api/tasks') {
    return `Create${quote(taskTitle)}`;
  }
  if (method === 'PATCH' && normalizedPath.startsWith('/api/tasks/')) {
    return `Edit${quote(taskTitle)}`;
  }
  if (method === 'DELETE' && normalizedPath.startsWith('/api/tasks/')) {
    const id = normalizedPath.slice('/api/tasks/'.length);
    return `Delete${quote(findEntityTitleInSnapshot(beforeSnap, 'Tasks', id)) || ' task'}`;
  }
  if (method === 'POST' && /^\/api\/projects\/[^/]+\/steps$/.test(normalizedPath)) {
    return 'Add project task';
  }
  if (method === 'POST' && normalizedPath === '/api/projects') {
    return `Create project${quote(projTitle)}`;
  }
  if (method === 'PATCH' && normalizedPath.startsWith('/api/projects/')) {
    return `Update project${quote(projTitle)}`;
  }
  if (method === 'DELETE' && normalizedPath.startsWith('/api/projects/')) {
    const id = normalizedPath.slice('/api/projects/'.length);
    return `Delete project${quote(findEntityTitleInSnapshot(beforeSnap, 'Projects', id))}`;
  }
  if (method === 'POST' && normalizedPath === '/api/categories') {
    return `Create category${quote(catName)}`;
  }
  if (method === 'PATCH' && normalizedPath.startsWith('/api/categories/')) {
    return `Edit category${quote(catName)}`;
  }
  if (method === 'DELETE' && normalizedPath.startsWith('/api/categories/')) {
    const id = normalizedPath.slice('/api/categories/'.length);
    return `Delete category${quote(findEntityTitleInSnapshot(beforeSnap, 'Categories', id))}`;
  }
  if (method === 'POST' && normalizedPath === '/api/schedule/generate') {
    return 'Generate upcoming schedule';
  }
  if (method === 'POST' && normalizedPath === '/api/distribution/apply') {
    return 'Rebalance household workload';
  }
  return 'Last change';
}

function isSiteAdminMember(member, env = process.env) {
  if (!member?.email) return false;
  const configured = String(env.SITE_ADMIN_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (configured.length > 0) {
    return configured.includes(member.email.toLowerCase());
  }
  // In local non-production dev only, let household admins preview the Site Admin tab
  return env.NODE_ENV !== 'production' && member.role === 'admin';
}

export function createApiHandler(db = new SheetDatabase()) {
  const historyByMember = new Map();
  const authHitsByIp = new Map();
  const magicCooldownByEmail = new Map();

  function checkAuthRateLimit(req) {
    const ip =
      String(req.headers['x-forwarded-for'] || '')
        .split(',')[0]
        .trim() ||
      req.socket?.remoteAddress ||
      'local';
    const now = Date.now();
    const windowMs = 15 * 60 * 1000;
    const prev = (authHitsByIp.get(ip) || []).filter((ts) => now - ts < windowMs);
    if (prev.length >= 25) {
      throw Object.assign(
        new Error('Too many authentication attempts. Please wait a few minutes and try again.'),
        { status: 429 },
      );
    }
    prev.push(now);
    authHitsByIp.set(ip, prev);
  }

  function getHistory(memberId) {
    let entry = historyByMember.get(memberId);
    if (!entry) {
      entry = { undo: [], redo: [] };
      historyByMember.set(memberId, entry);
    }
    return entry;
  }

  function getUndoSummary(memberId) {
    const h = getHistory(memberId);
    const lastUndo = h.undo[h.undo.length - 1];
    const lastRedo = h.redo[h.redo.length - 1];
    return {
      canUndo: h.undo.length > 0,
      canRedo: h.redo.length > 0,
      undoCount: h.undo.length,
      redoCount: h.redo.length,
      lastActionLabel: lastUndo?.label || null,
      redoActionLabel: lastRedo?.label || null,
    };
  }

  function sliceDataTabs(store, hhId = null) {
    const out = {};
    for (const tab of DATA_TABS) {
      const rows = store?.[tab] || [];
      out[tab] = structuredClone(hhId ? rows.filter((r) => r.householdId === hhId) : rows);
    }
    return out;
  }

  async function captureDataSnapshot(member, hhId, includePrivate) {
    const shared = await db.getAll();
    const priv = includePrivate ? await db.getPrivate(member) : null;
    return {
      shared: sliceDataTabs(shared, hhId),
      priv: includePrivate ? sliceDataTabs(priv, null) : null,
    };
  }

  function captureCachedSnapshot(member, hhId, includePrivate) {
    const shared = db.cache || {};
    const priv = includePrivate ? db.privateCaches.get(member.id)?.data || {} : null;
    return {
      shared: sliceDataTabs(shared, hhId),
      priv: includePrivate ? sliceDataTabs(priv, null) : null,
    };
  }

  async function restoreDataSnapshot(member, hhId, includePrivate, snap) {
    const current = await captureDataSnapshot(member, hhId, includePrivate);
    if (JSON.stringify(current.shared) !== JSON.stringify(snap.shared)) {
      await db.mutate((d) => {
        for (const tab of DATA_TABS) {
          const others = (d[tab] || []).filter((r) => r.householdId !== hhId);
          d[tab] = [...others, ...structuredClone(snap.shared[tab] || [])];
        }
      });
    }
    if (includePrivate && snap.priv && JSON.stringify(current.priv) !== JSON.stringify(snap.priv)) {
      await db.mutatePrivate(member, (p) => {
        for (const tab of DATA_TABS) {
          p[tab] = structuredClone(snap.priv[tab] || []);
        }
      });
    }
  }
  /**
   * Authenticate either via session cookie OR scoped Bearer API key (`Authorization: Bearer hh_live_...`).
   */
  async function authenticate(req, requiredScope = null) {
    const authHeader = req.headers.authorization || '';
    if (authHeader.startsWith('Bearer ')) {
      const rawKey = authHeader.slice(7).trim();
      const hashed = hashApiKey(rawKey);
      const data = await db.getAll();
      const keyRow = data.ApiKeys.find((k) => k.keyHash === hashed);
      if (!keyRow) {
        throw Object.assign(new Error('Invalid or revoked API key'), { status: 401 });
      }
      const scopes = String(keyRow.scopes || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (requiredScope && !scopes.includes('*') && !scopes.includes(requiredScope)) {
        throw Object.assign(new Error(`API key lacks required scope: ${requiredScope}`), {
          status: 403,
        });
      }
      const member = data.Members.find(
        (m) => m.id === keyRow.memberId && m.householdId === keyRow.householdId,
      );
      const household = data.Households.find((h) => h.id === keyRow.householdId);
      if (!member || !household) {
        throw Object.assign(new Error('API key owner not found'), { status: 401 });
      }
      // Touch lastUsedAt asynchronously
      db.mutate((d) => {
        const k = d.ApiKeys.find((x) => x.id === keyRow.id);
        if (k) k.lastUsedAt = new Date().toISOString();
      }).catch(() => {});
      return {
        member,
        household,
        includePrivate: Boolean(keyRow.allowPrivate),
        authType: 'api_key',
      };
    }

    const session = getSessionFromRequest(req);
    if (!session) {
      throw Object.assign(new Error('Please sign in to continue'), { status: 401 });
    }
    const data = await db.getAll();
    const member = data.Members.find(
      (m) => m.id === session.memberId && m.householdId === session.householdId,
    );
    const household = data.Households.find((h) => h.id === session.householdId);
    if (!member || !household) {
      throw Object.assign(new Error('Session expired or member not found'), { status: 401 });
    }
    return { member, household, includePrivate: true, authType: 'session' };
  }

  /**
   * Reconcile overdue policies & evaluate weather triggers so the Cockpit is always live and accurate.
   */
  async function syncDynamicState({ member, household, includePrivate }) {
    const todayStr = getTodayStr(household.timezone);
    const fed = await db.getFederated(member, { includePrivate });
    const hhMembers = fed.shared.Members.filter((m) => m.householdId === household.id);

    // 1. Reconcile overdue policies (auto_skip / roll_forward)
    const sharedInsts = fed.shared.TaskInstances.filter((i) => i.householdId === household.id);
    const sharedChanged = reconcileOverdueInstances(sharedInsts, todayStr);
    if (sharedChanged) {
      await db.mutate((d) => {
        reconcileOverdueInstances(
          d.TaskInstances.filter((i) => i.householdId === household.id),
          todayStr,
        );
      });
    }
    if (includePrivate) {
      const privChanged = reconcileOverdueInstances(fed.priv.TaskInstances || [], todayStr);
      if (privChanged) {
        await db.mutatePrivate(member, (p) => {
          reconcileOverdueInstances(p.TaskInstances || [], todayStr);
        });
      }
    }

    // 2. Evaluate 10-day weather forecast (two-tier: 4-10d heads_up, 1-3d urgent)
    const forecast = await getTenDayForecast(household, todayStr);
    const refreshedFed = sharedChanged
      ? await db.getFederated(member, { includePrivate })
      : fed;

    const weatherAlerts = evaluateWeatherAlerts(
      forecast.days,
      refreshedFed.tasks,
      refreshedFed.instances,
      todayStr,
    );

    // Materialize or update urgency on active weather-triggered instances
    const catPathMap = buildCategoryPathMap(refreshedFed.categories);
    const sharedWeatherToCreate = [];
    const sharedWeatherUrgencyUpdates = [];
    const privWeatherToCreate = [];
    const privWeatherUrgencyUpdates = [];

    for (const alert of weatherAlerts) {
      const task = refreshedFed.tasks.find((t) => t.id === alert.taskId);
      if (!task) continue;
      const isPriv = task.visibility === 'private';
      if (alert.existingInstanceId) {
        const existing = refreshedFed.instances.find((i) => i.id === alert.existingInstanceId);
        if (
          existing &&
          (existing.weatherUrgency !== alert.urgency || existing.weatherSummary !== alert.summary)
        ) {
          const upd = {
            id: existing.id,
            urgency: alert.urgency,
            summary: alert.summary,
            dueDate: alert.matchedDate,
          };
          if (isPriv) privWeatherUrgencyUpdates.push(upd);
          else sharedWeatherUrgencyUpdates.push(upd);
        }
      } else {
        const inst = buildInstanceFromTask({
          task,
          household,
          members: hhMembers,
          instances: refreshedFed.instances,
          categoryPathMap: catPathMap,
          todayStr,
          anchorDateStr: alert.matchedDate,
          triggerSource: 'weather',
          weatherUrgency: alert.urgency,
          weatherSummary: alert.summary,
        });
        if (isPriv) privWeatherToCreate.push(inst);
        else sharedWeatherToCreate.push(inst);
      }
    }

    if (sharedWeatherToCreate.length > 0 || sharedWeatherUrgencyUpdates.length > 0) {
      await db.mutate((d) => {
        for (const u of sharedWeatherUrgencyUpdates) {
          const row = d.TaskInstances.find((x) => x.id === u.id);
          if (row) {
            row.weatherUrgency = u.urgency;
            row.weatherSummary = u.summary;
            row.dueDate = u.dueDate;
            row.windowEndDate = u.dueDate;
            row.reason = u.summary;
          }
        }
        for (const inst of sharedWeatherToCreate) {
          if (!d.TaskInstances.some((x) => x.taskId === inst.taskId && x.status === 'pending')) {
            d.TaskInstances.push(inst);
          }
        }
      });
    }

    if (includePrivate && (privWeatherToCreate.length > 0 || privWeatherUrgencyUpdates.length > 0)) {
      await db.mutatePrivate(member, (p) => {
        for (const u of privWeatherUrgencyUpdates) {
          const row = p.TaskInstances.find((x) => x.id === u.id);
          if (row) {
            row.weatherUrgency = u.urgency;
            row.weatherSummary = u.summary;
            row.dueDate = u.dueDate;
            row.windowEndDate = u.dueDate;
            row.reason = u.summary;
          }
        }
        for (const inst of privWeatherToCreate) {
          if (!p.TaskInstances.some((x) => x.taskId === inst.taskId && x.status === 'pending')) {
            p.TaskInstances.push(inst);
          }
        }
      });
    }

    const finalFed =
      sharedWeatherToCreate.length ||
      sharedWeatherUrgencyUpdates.length ||
      privWeatherToCreate.length ||
      privWeatherUrgencyUpdates.length
        ? await db.getFederated(member, { includePrivate })
        : refreshedFed;

    return { todayStr, fed: finalFed, forecast, weatherAlerts };
  }

  /**
   * Shared helper: create a task (in Shared OR Personal Private Sheet) + optional initial instance.
   */
  async function createTaskRecord({ member, household, body, todayStr }) {
    const title = String(body.title || '').trim();
    if (!title) throw Object.assign(new Error('Task title is required.'), { status: 400 });

    const visibility = body.visibility === 'private' ? 'private' : 'household';
    const isHabit = Boolean(body.isHabit);
    const routineCue = ['morning', 'afternoon', 'evening', 'anytime'].includes(body.routineCue)
      ? body.routineCue
      : isHabit
        ? 'anytime'
        : '';
    const fed = await db.getFederated(member, { includePrivate: true });
    const hhMembers = fed.shared.Members.filter((m) => m.householdId === household.id);
    const now = new Date().toISOString();

    let resolvedCategoryId = String(body.categoryId || '');
    let autoCreatedCategory = null;
    if (isHabit && !resolvedCategoryId) {
      const existingHabitCat = fed.categories.find(
        (c) =>
          (visibility === 'private' ? c.visibility === 'private' : c.visibility !== 'private') &&
          /habit/i.test(c.name || ''),
      );
      if (existingHabitCat) {
        resolvedCategoryId = existingHabitCat.id;
      } else {
        autoCreatedCategory = {
          id: makeId('cat'),
          householdId: household.id,
          name: 'Habit Building',
          parentCategoryId: '',
          visibility,
          ownerId: visibility === 'private' ? member.id : '',
          sortOrder: 10,
          createdAt: now,
        };
        resolvedCategoryId = autoCreatedCategory.id;
      }
    }

    const catPathMap = buildCategoryPathMap(
      autoCreatedCategory ? [...fed.categories, autoCreatedCategory] : fed.categories,
    );

    const eligibleIds =
      visibility === 'private'
        ? member.id
        : Array.isArray(body.eligibleMemberIds)
          ? body.eligibleMemberIds.join(',')
          : String(body.eligibleMemberIds || '');

    const task = {
      id: makeId('tsk'),
      householdId: household.id,
      categoryId: resolvedCategoryId,
      projectId: String(body.projectId || ''),
      stepOrder: Number(body.stepOrder) || 0,
      parentTaskId: String(body.parentTaskId || ''),
      title,
      description: String(body.description || '').trim(),
      visibility,
      ownerId: member.id,
      isFavorite: Boolean(body.isFavorite),
      needsDetails: Boolean(body.needsDetails),
      isHabit,
      routineCue,
      effort: Math.min(5, Math.max(1, Number(body.effort) || (isHabit ? 1 : 2))),
      cadenceMode: String(
        body.cadenceMode ||
          (body.weatherTrigger && body.weatherTrigger !== 'none'
            ? 'weather_triggered'
            : 'strict_date'),
      ),
      recurrenceType: String(
        body.recurrenceType || (body.projectId ? 'once' : isHabit ? 'daily' : 'weekly'),
      ),
      recurrenceInterval: Math.max(1, Number(body.recurrenceInterval) || 1),
      recurrenceDays: Array.isArray(body.recurrenceDays)
        ? body.recurrenceDays.join(',')
        : String(body.recurrenceDays || ''),
      targetSeason: String(body.targetSeason || ''),
      weatherTrigger: String(body.weatherTrigger || 'none'),
      weatherCooldownDays: Math.max(1, Number(body.weatherCooldownDays) || 5),
      overduePolicy: String(body.overduePolicy || (isHabit ? 'auto_skip' : 'carry_over')),
      assignmentMode:
        visibility === 'private'
          ? 'fixed'
          : String(body.assignmentMode || (body.fixedMemberId ? 'fixed' : 'open_pool')),
      eligibleMemberIds: eligibleIds,
      fixedMemberId:
        visibility === 'private'
          ? member.id
          : String(body.fixedMemberId || ''),
      lastAssignedMemberId: '',
      active: body.active !== false,
      createdAt: now,
    };

    let createdInstance = null;
    const shouldSchedule =
      body.scheduleFirst !== false && task.cadenceMode !== 'weather_triggered';

    if (shouldSchedule) {
      const anchor =
        body.firstDueDate && /^\d{4}-\d{2}-\d{2}$/.test(body.firstDueDate)
          ? body.firstDueDate
          : task.cadenceMode === 'flexible_window'
            ? todayStr
            : computeNextDueDate(task, todayStr, { inclusive: true }) || todayStr;

      createdInstance = buildInstanceFromTask({
        task,
        household,
        members: hhMembers,
        instances: fed.instances,
        categoryPathMap: catPathMap,
        todayStr,
        anchorDateStr: anchor,
        triggerSource: task.projectId ? 'project' : 'schedule',
      });
      if (body.firstDueDate && /^\d{4}-\d{2}-\d{2}$/.test(body.firstDueDate)) {
        createdInstance.dueDate = body.firstDueDate;
        if (body.windowEndDate && /^\d{4}-\d{2}-\d{2}$/.test(body.windowEndDate)) {
          createdInstance.windowEndDate =
            body.windowEndDate >= body.firstDueDate ? body.windowEndDate : body.firstDueDate;
        } else if (task.cadenceMode !== 'flexible_window' || createdInstance.windowEndDate < body.firstDueDate) {
          createdInstance.windowEndDate = body.firstDueDate;
        }
      } else if (body.windowEndDate && /^\d{4}-\d{2}-\d{2}$/.test(body.windowEndDate)) {
        createdInstance.windowEndDate =
          body.windowEndDate >= createdInstance.dueDate ? body.windowEndDate : createdInstance.dueDate;
      }
      if (createdInstance.assigneeId) {
        task.lastAssignedMemberId = createdInstance.assigneeId;
      }
    }

    if (visibility === 'private') {
      await db.mutatePrivate(member, (p) => {
        if (autoCreatedCategory) p.Categories.push(autoCreatedCategory);
        p.Tasks.push(task);
        if (createdInstance) p.TaskInstances.push(createdInstance);
      });
    } else {
      await db.mutate((d) => {
        if (autoCreatedCategory) d.Categories.push(autoCreatedCategory);
        d.Tasks.push(task);
        if (createdInstance) d.TaskInstances.push(createdInstance);
      });
    }

    return { task, instance: createdInstance };
  }

  async function completeInstanceById({ member, household, instanceId, body, todayStr }) {
    const fed = await db.getFederated(member, { includePrivate: true });
    const found = fed.instances.find((i) => i.id === instanceId);
    if (!found) throw Object.assign(new Error('Task instance not found'), { status: 404 });

    const isPriv = found.storageSource === 'personal_sheet' || found.visibility === 'private';
    const hhMembers = fed.shared.Members.filter((m) => m.householdId === household.id);
    const catPathMap = buildCategoryPathMap(fed.categories);

    const applyComplete = (store) => {
      const inst = store.TaskInstances.find((x) => x.id === instanceId);
      if (!inst) throw Object.assign(new Error('Task instance not found'), { status: 404 });

      const targetCompleted =
        body.completed !== undefined ? Boolean(body.completed) : inst.status !== 'completed';
      let nextInstance = null;

      if (targetCompleted) {
        inst.status = 'completed';
        inst.completedAt = new Date().toISOString();
        inst.completedBy = member.name;
        if (!inst.assigneeId) {
          inst.assigneeId = member.id;
          inst.assigneeName = member.name;
          inst.claimedBy = member.name;
        }
        if (body.notes !== undefined) inst.notes = String(body.notes);

        const task = store.Tasks.find((t) => t.id === inst.taskId && t.active !== false);
        if (
          task &&
          !task.projectId &&
          task.cadenceMode !== 'weather_triggered' &&
          task.recurrenceType !== 'once'
        ) {
          task.lastAssignedMemberId = inst.assigneeId || member.id;
          const baseDate = inst.dueDate >= todayStr ? inst.dueDate : todayStr;
          const nextDue = computeNextDueDate(task, baseDate, { inclusive: false });
          const alreadyScheduled = store.TaskInstances.some(
            (x) => x.taskId === task.id && x.status === 'pending' && x.dueDate >= nextDue,
          );
          if (nextDue && !alreadyScheduled) {
            nextInstance = buildInstanceFromTask({
              task,
              household,
              members: hhMembers,
              instances: store.TaskInstances,
              categoryPathMap: catPathMap,
              todayStr,
              anchorDateStr: nextDue,
              triggerSource: 'schedule',
            });
            if (nextInstance.assigneeId) {
              task.lastAssignedMemberId = nextInstance.assigneeId;
            }
            store.TaskInstances.push(nextInstance);
          }
        }
      } else {
        inst.status = 'pending';
        inst.completedAt = '';
        inst.completedBy = '';
      }
      return { instance: inst, nextInstance };
    };

    return isPriv
      ? db.mutatePrivate(member, applyComplete)
      : db.mutate(applyComplete);
  }

  async function claimInstanceById({ member, instanceId, unclaim = false }) {
    const fed = await db.getFederated(member, { includePrivate: true });
    const found = fed.instances.find((i) => i.id === instanceId);
    if (!found) throw Object.assign(new Error('Task instance not found'), { status: 404 });
    const isPriv = found.storageSource === 'personal_sheet' || found.visibility === 'private';

    const updater = (store) => {
      const inst = store.TaskInstances.find((x) => x.id === instanceId);
      if (!inst) throw Object.assign(new Error('Task instance not found'), { status: 404 });
      if (unclaim) {
        inst.assigneeId = '';
        inst.assigneeName = '';
        inst.claimedBy = '';
        inst.reason = 'Set to Anyone';
      } else {
        inst.assigneeId = member.id;
        inst.assigneeName = member.name;
        inst.claimedBy = member.name;
        inst.reason = `Claimed by ${member.name.split(' ')[0]}`;
      }
      return { instance: inst };
    };
    return isPriv ? db.mutatePrivate(member, updater) : db.mutate(updater);
  }

  async function skipInstanceById({ member, instanceId }) {
    const fed = await db.getFederated(member, { includePrivate: true });
    const found = fed.instances.find((i) => i.id === instanceId);
    if (!found) throw Object.assign(new Error('Task instance not found'), { status: 404 });
    const isPriv = found.storageSource === 'personal_sheet' || found.visibility === 'private';

    const updater = (store) => {
      const inst = store.TaskInstances.find((x) => x.id === instanceId);
      if (!inst) throw Object.assign(new Error('Task instance not found'), { status: 404 });
      inst.status = 'skipped';
      inst.reason = `Skipped by ${member.name.split(' ')[0]}`;
      return { instance: inst };
    };
    return isPriv ? db.mutatePrivate(member, updater) : db.mutate(updater);
  }

  async function deferInstanceById({ member, instanceId, body, todayStr }) {
    const fed = await db.getFederated(member, { includePrivate: true });
    const found = fed.instances.find((i) => i.id === instanceId);
    if (!found) throw Object.assign(new Error('Task instance not found'), { status: 404 });
    const isPriv = found.storageSource === 'personal_sheet' || found.visibility === 'private';

    let targetDate = '';
    if (body.untilDate && /^\d{4}-\d{2}-\d{2}$/.test(body.untilDate)) {
      targetDate = body.untilDate;
    } else {
      const days = Math.min(365, Math.max(1, Number(body.days) || 1));
      const base = found.dueDate && found.dueDate > todayStr ? found.dueDate : todayStr;
      targetDate = addDays(base, days);
    }

    const updater = (store) => {
      const inst = store.TaskInstances.find((x) => x.id === instanceId);
      if (!inst) throw Object.assign(new Error('Task instance not found'), { status: 404 });
      const prevSpan =
        inst.windowEndDate && inst.dueDate && inst.windowEndDate > inst.dueDate
          ? Math.max(0, diffDays(inst.windowEndDate, inst.dueDate))
          : 0;
      inst.status = 'pending';
      inst.dueDate = targetDate;
      inst.windowEndDate = prevSpan > 0 ? addDays(targetDate, prevSpan) : targetDate;
      inst.reason = body.reason
        ? `Deferred to ${targetDate} (${String(body.reason).trim()})`
        : `Deferred to ${targetDate} by ${member.name.split(' ')[0]}`;
      return { instance: inst };
    };
    return isPriv ? db.mutatePrivate(member, updater) : db.mutate(updater);
  }

  async function handleQuickLog({ member, household, body, todayStr }) {
    const text = String(body.text || '').trim();
    if (!text) throw Object.assign(new Error('Please enter what you did or need to do.'), { status: 400 });

    const mode = body.mode === 'add_inbox' ? 'add_inbox' : 'complete_now';
    const visibility = body.visibility === 'private' ? 'private' : 'household';
    const now = new Date().toISOString();

    const task = {
      id: makeId('tsk'),
      householdId: household.id,
      categoryId: String(body.categoryId || ''),
      projectId: '',
      stepOrder: 0,
      parentTaskId: '',
      title: text,
      description: '',
      visibility,
      ownerId: member.id,
      isFavorite: false,
      needsDetails: true,
      effort: 1,
      cadenceMode: 'strict_date',
      recurrenceType: 'once',
      recurrenceInterval: 1,
      recurrenceDays: '',
      targetSeason: '',
      weatherTrigger: 'none',
      weatherCooldownDays: 5,
      overduePolicy: 'roll_forward',
      assignmentMode: visibility === 'private' ? 'fixed' : mode === 'complete_now' ? 'fixed' : 'open_pool',
      eligibleMemberIds: visibility === 'private' ? member.id : '',
      fixedMemberId: visibility === 'private' || mode === 'complete_now' ? member.id : '',
      lastAssignedMemberId: member.id,
      active: true,
      createdAt: now,
    };

    const instance = {
      id: makeId('inst'),
      householdId: household.id,
      taskId: task.id,
      projectId: '',
      taskTitle: text,
      categoryPath: visibility === 'private' ? 'Personal Inbox (Needs Details)' : 'Inbox (Needs Details)',
      visibility,
      ownerId: member.id,
      effort: 1,
      windowType: 'daily',
      dueDate: todayStr,
      windowEndDate: todayStr,
      triggerSource: 'quick_log',
      weatherUrgency: '',
      weatherSummary: '',
      assignmentMode: task.assignmentMode,
      eligibleMemberIds: task.eligibleMemberIds,
      assigneeId: mode === 'complete_now' || visibility === 'private' ? member.id : '',
      assigneeName: mode === 'complete_now' || visibility === 'private' ? member.name : '',
      claimedBy: mode === 'complete_now' ? member.name : '',
      status: mode === 'complete_now' ? 'completed' : 'pending',
      overduePolicy: 'roll_forward',
      reason: mode === 'complete_now' ? 'Quick-logged from Daily Cockpit' : 'Captured in Inbox — fill details later',
      completedAt: mode === 'complete_now' ? now : '',
      completedBy: mode === 'complete_now' ? member.name : '',
      notes: '',
      createdAt: now,
    };

    if (visibility === 'private') {
      await db.mutatePrivate(member, (p) => {
        p.Tasks.unshift(task);
        p.TaskInstances.unshift(instance);
      });
    } else {
      await db.mutate((d) => {
        d.Tasks.unshift(task);
        d.TaskInstances.unshift(instance);
      });
    }

    return { task, instance };
  }

  return async function handleApi(req, res) {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;
    const method = (req.method || 'GET').toUpperCase();

    try {
      // -----------------------------------------------------------------------
      // Public Endpoints (Health, OpenAPI 3.1 Spec, Auth)
      // -----------------------------------------------------------------------
      if (method === 'GET' && pathname === '/api/health') {
        await db.getAll();
        return sendJson(res, 200, { ok: true, version: '2.0.0', storage: db.getStatus() });
      }

      if (method === 'GET' && pathname === '/api/v1/openapi.json') {
        return sendJson(res, 200, buildOpenApiSpec(getAppUrl(req)));
      }

      // Lightweight privacy-friendly page view & demo launch beacon
      if (method === 'POST' && pathname === '/api/analytics/visit') {
        const body = await readJsonBody(req);
        const kind = body.kind === 'demo_launch' ? 'demo_launch' : 'page_view';
        if (typeof db.recordSiteEvent === 'function') {
          await db.recordSiteEvent(kind, getTodayStr('America/Los_Angeles')).catch(() => {});
        }
        return sendJson(res, 200, { ok: true });
      }

      if (method === 'GET' && pathname === '/api/auth/me') {
        const data = await db.getAll();
        const session = getSessionFromRequest(req);
        const demoEnabled = isDemoEnabled(process.env);
        const registrationCodeRequired = Boolean((process.env.REGISTRATION_CODE || '').trim());
        const demoHousehold = demoEnabled
          ? data.Households.find((h) => h.id === 'hh_maple_home')
          : null;
        const demoMembers = demoHousehold
          ? data.Members.filter((m) => m.householdId === demoHousehold.id).map((m) => ({
              id: m.id,
              name: m.name,
              email: m.email,
              role: m.role,
              memberGroup: m.memberGroup || 'partner',
              avatarColor: m.avatarColor,
            }))
          : [];

        if (!session) {
          return sendJson(res, 200, {
            user: null,
            household: null,
            demoMembers,
            demoEnabled,
            registrationCodeRequired,
            storage: db.getStatus(),
          });
        }

        const member = data.Members.find(
          (m) => m.id === session.memberId && m.householdId === session.householdId,
        );
        const household = data.Households.find((h) => h.id === session.householdId);
        if (!member || !household) {
          return sendJson(
            res,
            200,
            {
              user: null,
              household: null,
              demoMembers,
              demoEnabled,
              registrationCodeRequired,
              storage: db.getStatus(),
            },
            { 'Set-Cookie': buildClearSessionCookie() },
          );
        }

        return sendJson(res, 200, {
          user: sanitizeSafeMember(member),
          isSiteAdmin: isSiteAdminMember(member),
          household,
          demoMembers,
          demoEnabled,
          registrationCodeRequired,
          storage: db.getStatus(),
        });
      }

      if (method === 'POST' && pathname === '/api/auth/register') {
        checkAuthRateLimit(req);
        const body = await readJsonBody(req);
        const expectedRegCode = (process.env.REGISTRATION_CODE || '').trim();
        if (expectedRegCode) {
          const supplied = String(body.registrationCode || '').trim();
          if (supplied.toUpperCase() !== expectedRegCode.toUpperCase()) {
            return sendJson(res, 403, {
              error: 'Invalid Friends & Family access code. Ask the host for the household signup code.',
            });
          }
        }
        const householdName = String(body.householdName || '').trim();
        const name = String(body.name || '').trim();
        const email = String(body.email || '').trim().toLowerCase();
        const password = String(body.password || '');
        const timezone = String(body.timezone || 'America/Los_Angeles').trim();

        if (!householdName || !name || !email || password.length < 6) {
          return sendJson(res, 400, {
            error: 'Household name, your name, email, and a password (6+ chars) are required.',
          });
        }

        const created = await db.mutate((data) => {
          if (data.Members.some((m) => m.email.toLowerCase() === email)) {
            throw Object.assign(new Error('An account with that email already exists.'), { status: 409 });
          }
          const now = new Date().toISOString();
          const householdId = makeId('hh');
          const memberId = makeId('mem');

          const household = {
            id: householdId,
            name: householdName,
            timezone,
            locationName: '',
            latitude: null,
            longitude: null,
            digestTime: '08:00',
            rotationMode: 'auto_balanced',
            simulatedWeather: '',
            createdAt: now,
          };

          const member = {
            id: memberId,
            householdId,
            name,
            email,
            passwordHash: hashPassword(password),
            role: 'admin',
            memberGroup: 'partner',
            avatarColor: AVATAR_PALETTE[0],
            weeklyCapacity: 1.0,
            showEffortAndFairness: false,
            active: true,
            notifyEmail: true,
            privateSheetUrl: '',
            privateSheetToken: '',
            magicToken: '',
            magicTokenExpiresAt: '',
            createdAt: now,
          };

          const rootHome = {
            id: makeId('cat'),
            householdId,
            name: 'Home',
            parentCategoryId: '',
            visibility: 'household',
            ownerId: '',
            sortOrder: 1,
            createdAt: now,
          };

          data.Households.push(household);
          data.Members.push(member);
          data.Categories.push(rootHome);
          data.Invites.push({
            code: makeInviteCode(householdName),
            householdId,
            email: '',
            role: 'member',
            createdBy: memberId,
            expiresAt: new Date(Date.now() + 86400000 * 30).toISOString(),
            usedBy: '',
            createdAt: now,
          });
          return { household, member };
        });

        return sendJson(
          res,
          201,
          { user: sanitizeSafeMember(created.member), household: created.household },
          { 'Set-Cookie': buildSessionCookie(created.member, { secure: isSecureRequest(req) }) },
        );
      }

      if (method === 'POST' && pathname === '/api/auth/login') {
        checkAuthRateLimit(req);
        const body = await readJsonBody(req);
        const email = String(body.email || '').trim().toLowerCase();
        const password = String(body.password || '');
        const data = await db.getAll();
        const member = data.Members.find((m) => m.email.toLowerCase() === email);
        if (!member || !verifyPassword(password, member.passwordHash)) {
          return sendJson(res, 401, { error: 'Invalid email or password.' });
        }
        const household = data.Households.find((h) => h.id === member.householdId);
        return sendJson(
          res,
          200,
          { user: sanitizeSafeMember(member), household },
          { 'Set-Cookie': buildSessionCookie(member, { secure: isSecureRequest(req) }) },
        );
      }

      if (method === 'POST' && pathname === '/api/auth/demo') {
        if (!isDemoEnabled(process.env)) {
          return sendJson(res, 403, { error: 'Demo mode is disabled on this server.' });
        }
        const body = await readJsonBody(req);
        const data = await db.getAll();
        const member =
          (body.memberId && data.Members.find((m) => m.id === body.memberId)) ||
          data.Members.find((m) => m.householdId === 'hh_maple_home') ||
          data.Members[0];
        if (!member) {
          return sendJson(res, 404, { error: 'No demo household available.' });
        }
        const household = data.Households.find((h) => h.id === member.householdId);
        return sendJson(
          res,
          200,
          { user: sanitizeSafeMember(member), household },
          { 'Set-Cookie': buildSessionCookie(member, { secure: isSecureRequest(req) }) },
        );
      }

      if (method === 'POST' && pathname === '/api/auth/magic-request') {
        checkAuthRateLimit(req);
        const body = await readJsonBody(req);
        const email = String(body.email || '').trim().toLowerCase();
        if (!email) return sendJson(res, 400, { error: 'Please enter your email address.' });
        const isProd = process.env.NODE_ENV === 'production';

        // Per-email 2-minute cooldown prevents inbox flooding / Resend quota abuse
        const lastSentAt = magicCooldownByEmail.get(email) || 0;
        if (Date.now() - lastSentAt < 2 * 60 * 1000) {
          return sendJson(res, 429, {
            error: 'A sign-in link was recently requested for this email. Please check your inbox or wait 2 minutes.',
          });
        }

        const appUrl = getAppUrl(req);
        const result = await db.mutate(async (data) => {
          const member = data.Members.find((m) => m.email.toLowerCase() === email);
          if (!member) {
            if (isProd) {
              return { found: false, emailed: true, magicUrl: '' };
            }
            throw Object.assign(
              new Error('No household member found with that email. Ask an admin for an invite link.'),
              { status: 404 },
            );
          }
          const token = crypto.randomBytes(24).toString('hex');
          member.magicToken = token;
          member.magicTokenExpiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
          const magicUrl = `${appUrl}/?magic=${encodeURIComponent(token)}`;
          const emailPayload = {
            id: makeId('ntf'),
            householdId: member.householdId,
            memberId: member.id,
            memberEmail: member.email,
            type: 'magic_login',
            subject: 'Your Home Hub Magic Sign-In Link',
            body: `Sign in to Home Hub (expires in 30 minutes): ${magicUrl}`,
            channel: 'in_app',
            deliveryStatus: 'sent',
            readAt: '',
            createdAt: new Date().toISOString(),
          };
          const delivery = await deliverExternalNotification(emailPayload);
          if (isProd && delivery.channel !== 'email') {
            member.magicToken = '';
            member.magicTokenExpiresAt = '';
            throw Object.assign(
              new Error('Email delivery is temporarily unavailable. Please sign in with your password or try again shortly.'),
              { status: 503 },
            );
          }
          // Never persist the raw magic sign-in URL/token into the shared Notifications table
          data.Notifications.unshift({
            ...emailPayload,
            body: 'A magic sign-in link was requested for your account (expires in 30 minutes).',
            channel: delivery.channel,
            deliveryStatus: delivery.deliveryStatus,
          });
          return { found: true, magicUrl, emailed: delivery.channel === 'email' };
        });

        magicCooldownByEmail.set(email, Date.now());

        if (isProd) {
          return sendJson(res, 200, {
            ok: true,
            emailed: true,
            message: 'If an account exists for that email, a sign-in link has been sent.',
          });
        }
        return sendJson(res, 200, {
          ok: true,
          emailed: result.emailed,
          previewLink: result.emailed ? undefined : result.magicUrl,
          message: result.emailed
            ? 'Magic sign-in link emailed! Check your inbox.'
            : 'Email not configured — use the instant magic link below to sign in.',
        });
      }

      if (method === 'POST' && pathname === '/api/auth/magic-verify') {
        const body = await readJsonBody(req);
        const token = String(body.token || '').trim();
        if (!token) return sendJson(res, 400, { error: 'Missing magic token.' });
        const result = await db.mutate((data) => {
          const member = data.Members.find((m) => m.magicToken === token);
          if (!member) throw Object.assign(new Error('Invalid or used magic link.'), { status: 400 });
          if (member.magicTokenExpiresAt && new Date(member.magicTokenExpiresAt).getTime() < Date.now()) {
            throw Object.assign(new Error('Magic link expired.'), { status: 400 });
          }
          member.magicToken = '';
          member.magicTokenExpiresAt = '';
          return {
            member,
            household: data.Households.find((h) => h.id === member.householdId),
          };
        });
        return sendJson(
          res,
          200,
          { user: sanitizeSafeMember(result.member), household: result.household },
          { 'Set-Cookie': buildSessionCookie(result.member, { secure: isSecureRequest(req) }) },
        );
      }

      if (method === 'GET' && pathname.startsWith('/api/invites/')) {
        const code = decodeURIComponent(pathname.slice('/api/invites/'.length)).trim().toUpperCase();
        const data = await db.getAll();
        const invite = data.Invites.find((i) => i.code.toUpperCase() === code);
        if (!invite) return sendJson(res, 404, { error: 'Invite code not found.' });
        if (invite.expiresAt && new Date(invite.expiresAt).getTime() < Date.now()) {
          return sendJson(res, 410, { error: 'This invite link has expired.' });
        }
        const household = data.Households.find((h) => h.id === invite.householdId);
        return sendJson(res, 200, {
          code: invite.code,
          email: invite.email,
          role: invite.role,
          householdName: household?.name || 'Household',
        });
      }

      if (method === 'POST' && pathname === '/api/auth/join') {
        checkAuthRateLimit(req);
        const body = await readJsonBody(req);
        const code = String(body.code || '').trim().toUpperCase();
        const name = String(body.name || '').trim();
        const email = String(body.email || '').trim().toLowerCase();
        const password = String(body.password || '');
        if (!code || !name || !email || password.length < 6) {
          return sendJson(res, 400, {
            error: 'Invite code, name, email, and a password (6+ chars) are required.',
          });
        }
        const joined = await db.mutate((data) => {
          const invite = data.Invites.find((i) => i.code.toUpperCase() === code);
          if (!invite) throw Object.assign(new Error('Invalid invite code.'), { status: 404 });
          if (invite.email && invite.email.toLowerCase() !== email) {
            throw Object.assign(new Error(`Invite reserved for ${invite.email}.`), { status: 403 });
          }
          if (data.Members.some((m) => m.email.toLowerCase() === email)) {
            throw Object.assign(new Error('That email is already registered.'), { status: 409 });
          }
          const count = data.Members.filter((m) => m.householdId === invite.householdId).length;
          const member = {
            id: makeId('mem'),
            householdId: invite.householdId,
            name,
            email,
            passwordHash: hashPassword(password),
            role: invite.role || 'member',
            memberGroup: String(body.memberGroup || 'roommate'),
            avatarColor: AVATAR_PALETTE[count % AVATAR_PALETTE.length],
            weeklyCapacity: 1.0,
            showEffortAndFairness: false,
            active: true,
            notifyEmail: true,
            privateSheetUrl: '',
            privateSheetToken: '',
            magicToken: '',
            magicTokenExpiresAt: '',
            createdAt: new Date().toISOString(),
          };
          data.Members.push(member);
          if (invite.email) invite.usedBy = member.id;
          return {
            member,
            household: data.Households.find((h) => h.id === invite.householdId),
          };
        });
        return sendJson(
          res,
          201,
          { user: sanitizeSafeMember(joined.member), household: joined.household },
          { 'Set-Cookie': buildSessionCookie(joined.member, { secure: isSecureRequest(req) }) },
        );
      }

      if (method === 'POST' && pathname === '/api/auth/logout') {
        return sendJson(res, 200, { ok: true }, { 'Set-Cookie': buildClearSessionCookie() });
      }

      // -----------------------------------------------------------------------
      // Cron Reminders Endpoint
      // -----------------------------------------------------------------------
      if ((method === 'GET' || method === 'POST') && pathname === '/api/cron/reminders') {
        const expectedSecret = process.env.CRON_SECRET;
        if (expectedSecret) {
          const authHeader = req.headers.authorization || '';
          const querySecret = url.searchParams.get('secret') || '';
          if (authHeader !== `Bearer ${expectedSecret}` && querySecret !== expectedSecret) {
            return sendJson(res, 401, { error: 'Unauthorized cron request' });
          }
        }
        const appUrl = getAppUrl(req);
        const summary = await db.mutate(async (data) => {
          let totalSent = 0;
          for (const household of data.Households) {
            const todayStr = getTodayStr(household.timezone);
            const hhMembers = data.Members.filter((m) => m.householdId === household.id);
            const hhTasks = data.Tasks.filter((t) => t.householdId === household.id);
            const hhInstances = data.TaskInstances.filter((i) => i.householdId === household.id);
            const hhNotifications = data.Notifications.filter((n) => n.householdId === household.id);

            reconcileOverdueInstances(hhInstances, todayStr);
            const forecast = await getTenDayForecast(household, todayStr);
            const weatherAlerts = evaluateWeatherAlerts(forecast.days, hhTasks, hhInstances, todayStr);

            const digests = buildDailyDigestNotifications({
              household,
              members: hhMembers,
              instances: hhInstances,
              weatherAlerts,
              todayStr,
              appUrl,
            });
            const overdues = buildOverdueAlertNotifications({
              household,
              members: hhMembers,
              instances: hhInstances,
              existingNotifications: hhNotifications,
              todayStr,
              appUrl,
            });
            for (const n of [...digests, ...overdues]) {
              const priority = n._priority || 'default';
              delete n._priority;
              const delivery = await deliverExternalNotification(n, process.env, { priority });
              n.channel = delivery.channel;
              n.deliveryStatus = delivery.deliveryStatus;
              data.Notifications.unshift(n);
              totalSent++;
            }
          }
          return { totalSent };
        });
        return sendJson(res, 200, { ok: true, ...summary });
      }

      // -----------------------------------------------------------------------
      // Authenticated Routes (Web UI /api/* AND Scoped Agent API /api/v1/*)
      // -----------------------------------------------------------------------
      const isV1 = pathname.startsWith('/api/v1/');
      const normalizedPath = isV1 ? pathname.replace('/api/v1/', '/api/') : pathname;

      const requiredScope = !isV1
        ? null
        : method === 'GET'
          ? normalizedPath === '/api/weather'
            ? 'weather:read'
            : 'tasks:read'
          : normalizedPath.startsWith('/api/projects')
            ? 'projects:write'
            : normalizedPath.startsWith('/api/instances') || normalizedPath === '/api/tasks/quick-log'
              ? 'cockpit:act'
              : 'tasks:write';

      const { member, household, includePrivate } = await authenticate(req, requiredScope);
      const hhId = household.id;

      // Multi-step Undo / Redo endpoints (restores Categories, Projects, Tasks, TaskInstances)
      if (method === 'POST' && normalizedPath === '/api/undo') {
        const h = getHistory(member.id);
        if (h.undo.length === 0) {
          return sendJson(res, 400, { error: 'Nothing to undo.' });
        }
        const entry = h.undo.pop();
        const currentSnap = await captureDataSnapshot(member, hhId, includePrivate);
        await restoreDataSnapshot(member, hhId, includePrivate, entry.before);
        h.redo.push({
          id: makeId('redo'),
          label: entry.label,
          before: currentSnap,
          createdAt: new Date().toISOString(),
        });
        if (h.redo.length > MAX_UNDO_HISTORY) h.redo.shift();
        return sendJson(res, 200, {
          ok: true,
          restoredLabel: entry.label,
          undo: getUndoSummary(member.id),
        });
      }

      if (method === 'POST' && normalizedPath === '/api/redo') {
        const h = getHistory(member.id);
        if (h.redo.length === 0) {
          return sendJson(res, 400, { error: 'Nothing to redo.' });
        }
        const entry = h.redo.pop();
        const currentSnap = await captureDataSnapshot(member, hhId, includePrivate);
        await restoreDataSnapshot(member, hhId, includePrivate, entry.before);
        h.undo.push({
          id: makeId('undo'),
          label: entry.label,
          before: currentSnap,
          createdAt: new Date().toISOString(),
        });
        if (h.undo.length > MAX_UNDO_HISTORY) h.undo.shift();
        return sendJson(res, 200, {
          ok: true,
          restoredLabel: entry.label,
          undo: getUndoSummary(member.id),
        });
      }

      // Automatically capture pre-mutation snapshot for undoable task/project/category actions
      if (isUndoableRoute(method, normalizedPath)) {
        const beforeSnap = await captureDataSnapshot(member, hhId, includePrivate);
        const beforeSerialized = JSON.stringify(beforeSnap);
        res._finalizeUndo = (status, responseData) => {
          if (status < 200 || status >= 300) return;
          const afterSnap = captureCachedSnapshot(member, hhId, includePrivate);
          if (JSON.stringify(afterSnap) === beforeSerialized) return;
          const h = getHistory(member.id);
          h.undo.push({
            id: makeId('undo'),
            label: describeUndoAction(method, normalizedPath, responseData, beforeSnap),
            before: beforeSnap,
            createdAt: new Date().toISOString(),
          });
          if (h.undo.length > MAX_UNDO_HISTORY) h.undo.shift();
          h.redo = [];
        };
      }

      // Dashboard / Cockpit
      if (method === 'GET' && (normalizedPath === '/api/dashboard' || normalizedPath === '/api/cockpit')) {
        const { todayStr, fed, forecast, weatherAlerts } = await syncDynamicState({
          member,
          household,
          includePrivate,
        });
        const hhMembers = fed.shared.Members.filter((m) => m.householdId === hhId);
        const hhInvites = fed.shared.Invites.filter((i) => i.householdId === hhId);
        const hhNotifications = fed.shared.Notifications.filter((n) => n.householdId === hhId).sort(
          (a, b) => String(b.createdAt).localeCompare(String(a.createdAt)),
        );
        const hhApiKeys = fed.shared.ApiKeys.filter((k) => k.householdId === hhId).map(
          ({ keyHash, ...safe }) => safe,
        );

        const instancesSorted = [...fed.instances].sort((a, b) =>
          (a.dueDate || '').localeCompare(b.dueDate || ''),
        );
        const loads = computeMemberLoads(hhMembers, instancesSorted, todayStr, 14);
        const habitStats = computeHabitStats(fed.tasks, instancesSorted, todayStr);

        if (normalizedPath === '/api/cockpit') {
          const pending = instancesSorted.filter((i) => i.status === 'pending');
          return sendJson(res, 200, {
            household: { id: household.id, name: household.name, timezone: household.timezone },
            member: sanitizeSafeMember(member),
            todayStr,
            weather: {
              source: forecast.source,
              locationName: forecast.locationName,
              alerts: weatherAlerts,
              nextThreeDays: forecast.days.slice(0, 3),
            },
            overdue: pending.filter((i) => (i.windowEndDate || i.dueDate) < todayStr),
            dueToday: pending.filter(
              (i) => i.dueDate <= todayStr && (i.windowEndDate || i.dueDate) >= todayStr && i.assigneeId === member.id,
            ),
            openRadar: pending.filter(
              (i) => !i.assigneeId && i.assignmentMode === 'open_pool' && isMemberEligibleForInstance(i, member.id),
            ),
            favorites: fed.tasks.filter((t) => t.isFavorite && t.active !== false),
            habits: fed.tasks.filter((t) => t.isHabit && t.active !== false),
            habitStats,
            needsDetails: fed.tasks.filter((t) => t.needsDetails),
            activeProjects: fed.projects.filter((p) => p.status === 'active'),
          });
        }

        return sendJson(res, 200, {
          user: sanitizeSafeMember(member),
          isSiteAdmin: isSiteAdminMember(member),
          household,
          todayStr,
          members: hhMembers.map(sanitizeSafeMember),
          categories: fed.categories,
          projects: fed.projects,
          tasks: fed.tasks,
          instances: instancesSorted,
          habitStats,
          undo: getUndoSummary(member.id),
          loads,
          invites: hhInvites,
          apiKeys: hhApiKeys,
          notifications: hhNotifications.slice(0, 60),
          weather: {
            source: forecast.source,
            preset: forecast.preset,
            locationName: forecast.locationName,
            days: forecast.days,
            error: forecast.error,
            alerts: weatherAlerts,
            triggers: WEATHER_TRIGGERS,
            presets: WEATHER_SIMULATION_PRESETS,
          },
          storage: {
            shared: db.getStatus(),
            personal: db.getPrivateStatus(member),
          },
          reminderChannels: {
            emailConfigured: Boolean(process.env.RESEND_API_KEY),
            ntfyConfigured: Boolean(process.env.NTFY_TOPIC_URL),
            webhookConfigured: Boolean(process.env.REMINDER_WEBHOOK_URL),
          },
        });
      }

      if (method === 'GET' && normalizedPath === '/api/weather') {
        const { todayStr, forecast, weatherAlerts } = await syncDynamicState({
          member,
          household,
          includePrivate,
        });
        return sendJson(res, 200, { todayStr, forecast, alerts: weatherAlerts });
      }

      // Household settings
      if (method === 'PATCH' && normalizedPath === '/api/household') {
        const body = await readJsonBody(req);
        const updated = await db.mutate((d) => {
          const hh = d.Households.find((h) => h.id === hhId);
          if (!hh) throw Object.assign(new Error('Household not found'), { status: 404 });
          if (body.name !== undefined && String(body.name).trim()) hh.name = String(body.name).trim();
          if (body.timezone !== undefined && String(body.timezone).trim()) hh.timezone = String(body.timezone).trim();
          if (body.locationName !== undefined) hh.locationName = String(body.locationName).trim();
          if (body.latitude !== undefined) hh.latitude = body.latitude === '' || body.latitude === null ? null : Number(body.latitude);
          if (body.longitude !== undefined) hh.longitude = body.longitude === '' || body.longitude === null ? null : Number(body.longitude);
          if (body.digestTime !== undefined) hh.digestTime = String(body.digestTime).trim();
          if (body.simulatedWeather !== undefined) hh.simulatedWeather = String(body.simulatedWeather);
          if (body.rotationMode === 'auto_balanced' || body.rotationMode === 'round_robin') {
            hh.rotationMode = body.rotationMode;
          }
          return hh;
        });
        return sendJson(res, 200, { household: updated });
      }

      // Household Members CRUD (Add directly, Edit profile/role/group/away/color, Remove)
      if (method === 'POST' && normalizedPath === '/api/members') {
        if (member.role !== 'admin') {
          return sendJson(res, 403, { error: 'Only household admins can add members directly.' });
        }
        const body = await readJsonBody(req);
        const name = String(body.name || '').trim();
        if (!name) return sendJson(res, 400, { error: 'Member name is required.' });
        const rawEmail = String(body.email || '').trim().toLowerCase();
        const password = String(body.password || '');

        const created = await db.mutate((d) => {
          const email =
            rawEmail ||
            `${name.toLowerCase().replace(/[^a-z0-9]+/g, '.')}.${crypto.randomBytes(2).toString('hex')}@home.local`;
          if (d.Members.some((m) => m.email.toLowerCase() === email)) {
            throw Object.assign(new Error('A member with that email already exists.'), { status: 409 });
          }
          const hhCount = d.Members.filter((m) => m.householdId === hhId).length;
          const newMember = {
            id: makeId('mem'),
            householdId: hhId,
            name,
            email,
            passwordHash: hashPassword(password.length >= 6 ? password : crypto.randomBytes(12).toString('hex')),
            role: body.role === 'admin' ? 'admin' : 'member',
            memberGroup: ['partner', 'roommate', 'kid'].includes(body.memberGroup)
              ? body.memberGroup
              : 'partner',
            avatarColor:
              body.avatarColor && /^#[0-9a-fA-F]{6}$/.test(body.avatarColor)
                ? body.avatarColor
                : AVATAR_PALETTE[hhCount % AVATAR_PALETTE.length],
            weeklyCapacity: Math.min(2.0, Math.max(0.25, Number(body.weeklyCapacity) || (body.memberGroup === 'kid' ? 0.5 : 1.0))),
            showEffortAndFairness: false,
            active: true,
            notifyEmail: Boolean(rawEmail),
            privateSheetUrl: '',
            privateSheetToken: '',
            magicToken: '',
            magicTokenExpiresAt: '',
            createdAt: new Date().toISOString(),
          };
          d.Members.push(newMember);
          return sanitizeSafeMember(newMember);
        });
        return sendJson(res, 201, { member: created });
      }

      if (method === 'PATCH' && normalizedPath.startsWith('/api/members/')) {
        const targetId = normalizedPath.slice('/api/members/'.length);
        const body = await readJsonBody(req);
        const updated = await db.mutate((d) => {
          const target = d.Members.find((m) => m.id === targetId && m.householdId === hhId);
          if (!target) throw Object.assign(new Error('Member not found'), { status: 404 });
          if (member.role !== 'admin' && member.id !== targetId) {
            throw Object.assign(new Error('Only admins can edit other household members.'), { status: 403 });
          }
          if (body.name !== undefined && String(body.name).trim()) {
            const oldName = target.name;
            target.name = String(body.name).trim();
            if (oldName !== target.name) {
              for (const inst of d.TaskInstances) {
                if (inst.assigneeId === target.id) inst.assigneeName = target.name;
              }
            }
          }
          if (body.email !== undefined && String(body.email).trim()) {
            const nextEmail = String(body.email).trim().toLowerCase();
            if (
              nextEmail !== target.email.toLowerCase() &&
              d.Members.some((m) => m.id !== target.id && m.email.toLowerCase() === nextEmail)
            ) {
              throw Object.assign(new Error('Another member already uses that email.'), { status: 409 });
            }
            target.email = nextEmail;
          }
          if (body.avatarColor !== undefined && /^#[0-9a-fA-F]{6}$/.test(body.avatarColor)) {
            target.avatarColor = body.avatarColor;
          }
          if (body.showEffortAndFairness !== undefined) {
            target.showEffortAndFairness = Boolean(body.showEffortAndFairness);
          }
          if (body.memberGroup !== undefined && ['partner', 'roommate', 'kid'].includes(body.memberGroup)) {
            target.memberGroup = body.memberGroup;
          }
          if (body.weeklyCapacity !== undefined) {
            const cap = Number(body.weeklyCapacity);
            if (Number.isFinite(cap) && cap >= 0.25 && cap <= 2.0) target.weeklyCapacity = cap;
          }
          if (body.active !== undefined && member.role === 'admin') target.active = Boolean(body.active);
          if (body.role !== undefined && member.role === 'admin' && ['admin', 'member'].includes(body.role)) {
            target.role = body.role;
          }
          if (body.notifyEmail !== undefined) target.notifyEmail = Boolean(body.notifyEmail);
          return sanitizeSafeMember(target);
        });
        return sendJson(res, 200, { member: updated });
      }

      if (method === 'DELETE' && normalizedPath.startsWith('/api/members/')) {
        const targetId = normalizedPath.slice('/api/members/'.length);
        if (member.role !== 'admin') {
          return sendJson(res, 403, { error: 'Only household admins can remove members.' });
        }
        if (targetId === member.id) {
          return sendJson(res, 400, { error: 'You cannot remove your own signed-in account.' });
        }
        await db.mutate((d) => {
          d.Members = d.Members.filter((m) => !(m.householdId === hhId && m.id === targetId));
          for (const inst of d.TaskInstances) {
            if (inst.householdId === hhId && inst.assigneeId === targetId && inst.status !== 'completed') {
              inst.assigneeId = '';
              inst.assigneeName = '';
              inst.assignmentMode = 'open_pool';
              inst.reason = 'Anyone (previous assignee removed)';
            }
          }
          for (const t of d.Tasks) {
            if (t.householdId === hhId && t.fixedMemberId === targetId) {
              t.fixedMemberId = '';
              t.assignmentMode = 'open_pool';
            }
          }
          for (const p of d.Projects) {
            if (p.householdId === hhId && p.leadMemberId === targetId) {
              p.leadMemberId = '';
            }
          }
        });
        return sendJson(res, 200, { ok: true });
      }

      if (method === 'PATCH' && normalizedPath === '/api/profile/password') {
        const body = await readJsonBody(req);
        const currentPassword = String(body.currentPassword || '');
        const newPassword = String(body.newPassword || '');
        if (newPassword.length < 6) {
          return sendJson(res, 400, { error: 'New password must be at least 6 characters.' });
        }
        await db.mutate((d) => {
          const m = d.Members.find((x) => x.id === member.id && x.householdId === hhId);
          if (!m) throw Object.assign(new Error('Member not found'), { status: 404 });
          if (currentPassword && !verifyPassword(currentPassword, m.passwordHash)) {
            throw Object.assign(new Error('Current password is incorrect.'), { status: 401 });
          }
          m.passwordHash = hashPassword(newPassword);
        });
        return sendJson(res, 200, { ok: true });
      }

      if (method === 'POST' && normalizedPath === '/api/onboarding/starter-pack') {
        const todayStr = getTodayStr(household.timezone);
        const fed = await db.getFederated(member, { includePrivate: true });
        const now = new Date().toISOString();

        const findOrCreateCat = async (name, parentCategoryId, visibility) => {
          const existing = fed.categories.find(
            (c) =>
              c.name.toLowerCase() === name.toLowerCase() &&
              (visibility === 'private' ? c.visibility === 'private' : c.visibility !== 'private'),
          );
          if (existing) return existing.id;
          const cat = {
            id: makeId('cat'),
            householdId: hhId,
            name,
            parentCategoryId: parentCategoryId || '',
            visibility,
            ownerId: visibility === 'private' ? member.id : '',
            sortOrder: 5,
            createdAt: now,
          };
          if (visibility === 'private') {
            await db.mutatePrivate(member, (p) => p.Categories.push(cat));
          } else {
            await db.mutate((d) => d.Categories.push(cat));
          }
          fed.categories.push(cat);
          return cat.id;
        };

        const homeId = await findOrCreateCat('Home', '', 'household');
        const kitchenId = await findOrCreateCat('Kitchen', homeId, 'household');
        const livingId = await findOrCreateCat('Living Areas', homeId, 'household');
        const exteriorId = await findOrCreateCat('Exterior & Yard', homeId, 'household');
        const financeId = await findOrCreateCat('Finance & Admin', '', 'household');
        const habitsId = await findOrCreateCat('Habit Building', '', 'private');

        const existingTitles = new Set(fed.tasks.map((t) => t.title.toLowerCase()));
        const starterTasks = [
          {
            title: 'Wash dinner dishes & wipe counters',
            categoryId: kitchenId,
            visibility: 'household',
            isFavorite: true,
            cadenceMode: 'strict_date',
            recurrenceType: 'daily',
            overduePolicy: 'roll_forward',
            assignmentMode: 'open_pool',
          },
          {
            title: 'Take out trash & recycling',
            categoryId: exteriorId,
            visibility: 'household',
            isFavorite: true,
            cadenceMode: 'strict_date',
            recurrenceType: 'weekly',
            recurrenceDays: 'Tue,Fri',
            overduePolicy: 'carry_over',
            assignmentMode: 'open_pool',
          },
          {
            title: 'Vacuum living room & hallways',
            categoryId: livingId,
            visibility: 'household',
            cadenceMode: 'flexible_window',
            recurrenceType: 'weekly',
            overduePolicy: 'roll_forward',
            assignmentMode: 'open_pool',
          },
          {
            title: 'Review & pay monthly bills',
            categoryId: financeId,
            visibility: 'household',
            cadenceMode: 'flexible_window',
            recurrenceType: 'monthly',
            overduePolicy: 'carry_over',
            assignmentMode: 'open_pool',
          },
          {
            title: 'Evening wind-down / skincare routine',
            categoryId: habitsId,
            visibility: 'private',
            isHabit: true,
            routineCue: 'evening',
            cadenceMode: 'strict_date',
            recurrenceType: 'daily',
            overduePolicy: 'auto_skip',
          },
        ];

        let createdCount = 0;
        for (const item of starterTasks) {
          if (existingTitles.has(item.title.toLowerCase())) continue;
          await createTaskRecord({ member, household, body: item, todayStr });
          createdCount++;
        }
        return sendJson(res, 201, { ok: true, createdCount });
      }

      if (method === 'PATCH' && normalizedPath === '/api/profile/private-sheet') {
        const body = await readJsonBody(req);
        const privateSheetUrl = String(body.privateSheetUrl || '').trim();
        const privateSheetToken = String(body.privateSheetToken || '').trim();

        const updatedMember = await db.mutate((d) => {
          const m = d.Members.find((x) => x.id === member.id && x.householdId === hhId);
          if (!m) throw Object.assign(new Error('Member not found'), { status: 404 });
          m.privateSheetUrl = privateSheetUrl;
          m.privateSheetToken = privateSheetToken;
          return m;
        });

        let personalStatus;
        if (privateSheetUrl) {
          personalStatus = await db.initializePrivateSheet(updatedMember);
        } else {
          db.privateCaches.delete(member.id);
          await db.getPrivate(updatedMember, { forceRefresh: true });
          personalStatus = db.getPrivateStatus(updatedMember);
        }
        return sendJson(res, 200, {
          member: sanitizeSafeMember(updatedMember),
          personalStorage: personalStatus,
        });
      }

      // Invites
      if (method === 'POST' && normalizedPath === '/api/invites') {
        const body = await readJsonBody(req);
        const invite = await db.mutate((d) => {
          const created = {
            code: makeInviteCode(household.name),
            householdId: hhId,
            email: String(body.email || '').trim().toLowerCase(),
            role: body.role === 'admin' ? 'admin' : 'member',
            createdBy: member.id,
            expiresAt: new Date(Date.now() + 86400000 * 14).toISOString(),
            usedBy: '',
            createdAt: new Date().toISOString(),
          };
          d.Invites.unshift(created);
          return created;
        });
        return sendJson(res, 201, {
          invite,
          inviteUrl: `${getAppUrl(req)}/?invite=${encodeURIComponent(invite.code)}`,
        });
      }

      if (method === 'DELETE' && normalizedPath.startsWith('/api/invites/')) {
        const code = decodeURIComponent(normalizedPath.slice('/api/invites/'.length));
        await db.mutate((d) => {
          d.Invites = d.Invites.filter((i) => !(i.householdId === hhId && i.code === code));
        });
        return sendJson(res, 200, { ok: true });
      }

      // Scoped API Keys (for AI Agents & External Services)
      if (method === 'GET' && normalizedPath === '/api/api-keys') {
        const data = await db.getAll();
        const keys = data.ApiKeys.filter((k) => k.householdId === hhId).map(
          ({ keyHash, ...safe }) => safe,
        );
        return sendJson(res, 200, { apiKeys: keys });
      }

      if (method === 'POST' && normalizedPath === '/api/api-keys') {
        const body = await readJsonBody(req);
        const name = String(body.name || 'AI Agent Key').trim();
        const scopes = Array.isArray(body.scopes)
          ? body.scopes.join(',')
          : String(body.scopes || 'tasks:read,tasks:write,projects:write,cockpit:act,weather:read');
        const allowPrivate = Boolean(body.allowPrivate);
        const rawKey = `hh_live_${crypto.randomBytes(20).toString('hex')}`;

        const created = await db.mutate((d) => {
          const row = {
            id: makeId('key'),
            householdId: hhId,
            memberId: member.id,
            name,
            keyPrefix: rawKey.slice(0, 14),
            keyHash: hashApiKey(rawKey),
            scopes,
            allowPrivate,
            lastUsedAt: '',
            createdAt: new Date().toISOString(),
          };
          d.ApiKeys.unshift(row);
          const { keyHash, ...safe } = row;
          return safe;
        });

        return sendJson(res, 201, { apiKey: created, secretKey: rawKey });
      }

      if (method === 'DELETE' && normalizedPath.startsWith('/api/api-keys/')) {
        const id = normalizedPath.slice('/api/api-keys/'.length);
        await db.mutate((d) => {
          d.ApiKeys = d.ApiKeys.filter((k) => !(k.householdId === hhId && k.id === id));
        });
        return sendJson(res, 200, { ok: true });
      }

      // Categories (Hierarchical Tree)
      if (method === 'GET' && normalizedPath === '/api/categories') {
        const fed = await db.getFederated(member, { includePrivate });
        const pathMap = buildCategoryPathMap(fed.categories);
        return sendJson(res, 200, {
          categories: fed.categories.map((c) => ({ ...c, path: pathMap.get(c.id) || c.name })),
        });
      }

      if (method === 'POST' && normalizedPath === '/api/categories') {
        const body = await readJsonBody(req);
        const name = String(body.name || '').trim();
        if (!name) return sendJson(res, 400, { error: 'Category name is required.' });
        const visibility = body.visibility === 'private' ? 'private' : 'household';
        const cat = {
          id: makeId('cat'),
          householdId: hhId,
          name,
          parentCategoryId: String(body.parentCategoryId || ''),
          visibility,
          ownerId: visibility === 'private' ? member.id : '',
          sortOrder: Number(body.sortOrder) || 10,
          createdAt: new Date().toISOString(),
        };
        if (visibility === 'private') {
          await db.mutatePrivate(member, (p) => {
            p.Categories.push(cat);
          });
        } else {
          await db.mutate((d) => {
            d.Categories.push(cat);
          });
        }
        return sendJson(res, 201, { category: cat });
      }

      if (method === 'PATCH' && normalizedPath.startsWith('/api/categories/')) {
        const catId = normalizedPath.slice('/api/categories/'.length);
        const body = await readJsonBody(req);
        const fed = await db.getFederated(member, { includePrivate });
        const found = fed.categories.find((c) => c.id === catId);
        if (!found) return sendJson(res, 404, { error: 'Category not found.' });
        const isPriv = found.storageSource === 'personal_sheet' || found.visibility === 'private';

        const updater = (store) => {
          const cat = store.Categories.find((c) => c.id === catId && (isPriv || c.householdId === hhId));
          if (!cat) throw Object.assign(new Error('Category not found.'), { status: 404 });

          if (body.name !== undefined && String(body.name).trim()) {
            cat.name = String(body.name).trim();
          }

          if (body.parentCategoryId !== undefined) {
            const nextParent = String(body.parentCategoryId || '');
            if (nextParent === cat.id) {
              throw Object.assign(new Error('A category cannot be its own parent.'), { status: 400 });
            }
            if (nextParent) {
              // Prevent circular hierarchy
              const blocked = new Set([cat.id]);
              let added = true;
              while (added) {
                added = false;
                for (const c of store.Categories) {
                  if (c.parentCategoryId && blocked.has(c.parentCategoryId) && !blocked.has(c.id)) {
                    blocked.add(c.id);
                    added = true;
                  }
                }
              }
              if (blocked.has(nextParent)) {
                throw Object.assign(new Error('Cannot move a category inside one of its own subcategories.'), {
                  status: 400,
                });
              }
              const parentObj = store.Categories.find((c) => c.id === nextParent);
              if (!parentObj) {
                throw Object.assign(new Error('Target parent category not found in the same sheet.'), {
                  status: 400,
                });
              }
            }
            cat.parentCategoryId = nextParent;
          }

          if (body.sortOrder !== undefined && Number.isFinite(Number(body.sortOrder))) {
            cat.sortOrder = Number(body.sortOrder);
          }

          // Recompute breadcrumb paths on pending TaskInstances
          const pathMap = buildCategoryPathMap(store.Categories);
          const taskCatMap = new Map(store.Tasks.map((t) => [t.id, t.categoryId]));
          for (const inst of store.TaskInstances) {
            if (inst.status === 'pending') {
              const tidCat = taskCatMap.get(inst.taskId);
              if (tidCat) inst.categoryPath = pathMap.get(tidCat) || 'General';
            }
          }
          return cat;
        };

        const updated = isPriv
          ? await db.mutatePrivate(member, updater)
          : await db.mutate(updater);
        return sendJson(res, 200, { category: updated });
      }

      if (method === 'DELETE' && normalizedPath.startsWith('/api/categories/')) {
        const catId = normalizedPath.slice('/api/categories/'.length);
        const deleteFromStore = (store, filterHh) => {
          const target = store.Categories.find(
            (c) => c.id === catId && (!filterHh || c.householdId === hhId),
          );
          if (!target) return false;
          const fallbackParent = target.parentCategoryId || '';
          // Promote direct children up to fallbackParent so subcategories are never orphaned
          for (const c of store.Categories) {
            if (c.parentCategoryId === catId) c.parentCategoryId = fallbackParent;
          }
          // Reassign tasks & projects from deleted category to fallbackParent
          for (const t of store.Tasks) {
            if (t.categoryId === catId) t.categoryId = fallbackParent;
          }
          for (const p of store.Projects) {
            if (p.categoryId === catId) p.categoryId = fallbackParent;
          }
          store.Categories = store.Categories.filter((c) => c.id !== catId);
          // Refresh breadcrumb paths on pending TaskInstances
          const pathMap = buildCategoryPathMap(store.Categories);
          const taskCatMap = new Map(store.Tasks.map((t) => [t.id, t.categoryId]));
          for (const inst of store.TaskInstances) {
            if (inst.status === 'pending') {
              const cid = taskCatMap.get(inst.taskId);
              inst.categoryPath = cid ? pathMap.get(cid) || 'General' : 'General';
            }
          }
          return true;
        };

        await db.mutate((d) => deleteFromStore(d, true));
        await db.mutatePrivate(member, (p) => deleteFromStore(p, false));
        return sendJson(res, 200, { ok: true });
      }

      // Projects & Steps
      if (method === 'GET' && normalizedPath === '/api/projects') {
        const fed = await db.getFederated(member, { includePrivate });
        const projects = fed.projects.map((p) => {
          const steps = fed.tasks
            .filter((t) => t.projectId === p.id)
            .sort((a, b) => (a.stepOrder || 0) - (b.stepOrder || 0));
          const stepInstances = fed.instances.filter((i) => i.projectId === p.id);
          const doneCount = stepInstances.filter((i) => i.status === 'completed').length;
          return {
            ...p,
            stepCount: steps.length,
            completedSteps: doneCount,
            steps,
            instances: stepInstances,
          };
        });
        return sendJson(res, 200, { projects });
      }

      if (method === 'POST' && normalizedPath === '/api/projects') {
        const body = await readJsonBody(req);
        const title = String(body.title || '').trim();
        if (!title) return sendJson(res, 400, { error: 'Project title is required.' });
        const visibility = body.visibility === 'private' ? 'private' : 'household';
        const now = new Date().toISOString();
        const todayStr = getTodayStr(household.timezone);

        const project = {
          id: makeId('proj'),
          householdId: hhId,
          title,
          description: String(body.description || '').trim(),
          categoryId: String(body.categoryId || 'cat_projects'),
          visibility,
          ownerId: member.id,
          status: String(body.status || 'active'),
          targetDate: String(body.targetDate || ''),
          leadMemberId:
            visibility === 'private'
              ? member.id
              : body.leadMemberId !== undefined
                ? String(body.leadMemberId)
                : member.id,
          createdAt: now,
          completedAt: '',
        };

        if (visibility === 'private') {
          await db.mutatePrivate(member, (p) => p.Projects.unshift(project));
        } else {
          await db.mutate((d) => d.Projects.unshift(project));
        }

        const createdSteps = [];
        if (Array.isArray(body.steps)) {
          for (let i = 0; i < body.steps.length; i++) {
            const s = body.steps[i];
            const resStep = await createTaskRecord({
              member,
              household,
              todayStr,
              body: {
                ...s,
                projectId: project.id,
                stepOrder: i + 1,
                categoryId: project.categoryId,
                visibility,
                cadenceMode: 'strict_date',
                recurrenceType: 'once',
                overduePolicy: s.overduePolicy || 'carry_over',
                firstDueDate: s.dueDate || s.firstDueDate || project.targetDate || todayStr,
              },
            });
            createdSteps.push(resStep);
          }
        }

        return sendJson(res, 201, { project, steps: createdSteps });
      }

      if (method === 'POST' && /^\/api\/projects\/[^/]+\/steps$/.test(normalizedPath)) {
        const projectId = normalizedPath.split('/')[3];
        const body = await readJsonBody(req);
        const fed = await db.getFederated(member, { includePrivate });
        const project = fed.projects.find((p) => p.id === projectId);
        if (!project) return sendJson(res, 404, { error: 'Project not found.' });

        const todayStr = getTodayStr(household.timezone);
        const existingCount = fed.tasks.filter((t) => t.projectId === projectId).length;
        const stepList = Array.isArray(body.steps) ? body.steps : [body];
        const created = [];

        for (let i = 0; i < stepList.length; i++) {
          const s = stepList[i];
          const resStep = await createTaskRecord({
            member,
            household,
            todayStr,
            body: {
              ...s,
              projectId,
              parentTaskId: String(s.parentTaskId || ''),
              stepOrder: existingCount + i + 1,
              categoryId: s.categoryId !== undefined ? s.categoryId : project.categoryId,
              visibility: project.visibility,
              cadenceMode: s.cadenceMode || 'strict_date',
              recurrenceType: s.recurrenceType || 'once',
              overduePolicy: s.overduePolicy || 'carry_over',
              firstDueDate: s.dueDate || s.firstDueDate || project.targetDate || todayStr,
            },
          });
          created.push(resStep);
        }

        return sendJson(res, 201, { created });
      }

      if (method === 'PATCH' && normalizedPath.startsWith('/api/projects/')) {
        const projectId = normalizedPath.slice('/api/projects/'.length);
        const body = await readJsonBody(req);
        const fed = await db.getFederated(member, { includePrivate });
        const found = fed.projects.find((p) => p.id === projectId);
        if (!found) return sendJson(res, 404, { error: 'Project not found.' });
        const isPriv = found.storageSource === 'personal_sheet' || found.visibility === 'private';

        const updater = (store) => {
          const p = store.Projects.find((x) => x.id === projectId);
          if (!p) throw Object.assign(new Error('Project not found'), { status: 404 });
          if (body.title !== undefined && String(body.title).trim()) p.title = String(body.title).trim();
          if (body.description !== undefined) p.description = String(body.description).trim();
          if (body.categoryId !== undefined) p.categoryId = String(body.categoryId);
          if (body.status !== undefined && ['planning', 'active', 'on_hold', 'completed'].includes(body.status)) {
            p.status = body.status;
            p.completedAt = body.status === 'completed' ? new Date().toISOString() : '';
          }
          if (body.targetDate !== undefined) p.targetDate = String(body.targetDate);
          if (body.leadMemberId !== undefined) p.leadMemberId = String(body.leadMemberId);
          return p;
        };
        const updated = isPriv
          ? await db.mutatePrivate(member, updater)
          : await db.mutate(updater);
        return sendJson(res, 200, { project: updated });
      }

      if (method === 'DELETE' && normalizedPath.startsWith('/api/projects/')) {
        const projectId = normalizedPath.slice('/api/projects/'.length);
        await db.mutate((d) => {
          d.Projects = d.Projects.filter((p) => !(p.householdId === hhId && p.id === projectId));
          d.Tasks = d.Tasks.filter((t) => !(t.householdId === hhId && t.projectId === projectId));
          d.TaskInstances = d.TaskInstances.filter((i) => !(i.householdId === hhId && i.projectId === projectId));
        });
        await db.mutatePrivate(member, (p) => {
          p.Projects = p.Projects.filter((x) => x.id !== projectId);
          p.Tasks = p.Tasks.filter((x) => x.projectId !== projectId);
          p.TaskInstances = p.TaskInstances.filter((x) => x.projectId !== projectId);
        });
        return sendJson(res, 200, { ok: true });
      }

      // Tasks CRUD + Quick Log + Bulk + Favorite 1-tap complete
      if (method === 'GET' && normalizedPath === '/api/tasks') {
        const fed = await db.getFederated(member, { includePrivate });
        let list = fed.tasks;
        const vis = url.searchParams.get('visibility');
        if (vis === 'household' || vis === 'private') list = list.filter((t) => t.visibility === vis);
        const catId = url.searchParams.get('categoryId');
        if (catId) list = list.filter((t) => t.categoryId === catId);
        const projId = url.searchParams.get('projectId');
        if (projId) list = list.filter((t) => t.projectId === projId);
        if (url.searchParams.get('needsDetails') === 'true') list = list.filter((t) => t.needsDetails);
        return sendJson(res, 200, { tasks: list });
      }

      if (method === 'POST' && normalizedPath === '/api/tasks/quick-log') {
        const body = await readJsonBody(req);
        const todayStr = getTodayStr(household.timezone);
        const result = await handleQuickLog({ member, household, body, todayStr });
        return sendJson(res, 201, result);
      }

      if (method === 'POST' && normalizedPath === '/api/tasks/bulk') {
        const body = await readJsonBody(req);
        const items = Array.isArray(body.tasks) ? body.tasks : [];
        if (items.length === 0) return sendJson(res, 400, { error: 'Provide a non-empty `tasks` array.' });
        const todayStr = getTodayStr(household.timezone);
        const created = [];
        for (const item of items.slice(0, 100)) {
          created.push(await createTaskRecord({ member, household, body: item, todayStr }));
        }
        return sendJson(res, 201, { createdCount: created.length, created });
      }

      if (method === 'POST' && normalizedPath === '/api/tasks/reorder') {
        const body = await readJsonBody(req);
        const updates = Array.isArray(body.updates) ? body.updates : [];
        if (updates.length === 0) return sendJson(res, 400, { error: 'Provide an `updates` array.' });

        const applyBatch = (store, filterHh) => {
          const byId = new Map(
            store.Tasks.filter((t) => !filterHh || t.householdId === hhId).map((t) => [t.id, t]),
          );
          let changed = false;

          for (const u of updates) {
            const task = byId.get(u.id);
            if (!task) continue;

            if (u.parentTaskId !== undefined) {
              const nextParent = String(u.parentTaskId || '');
              if (nextParent === task.id) continue;
              // Guard against circular nesting
              if (nextParent) {
                let cur = byId.get(nextParent);
                let isCycle = false;
                const seen = new Set([task.id]);
                while (cur) {
                  if (seen.has(cur.id)) {
                    isCycle = true;
                    break;
                  }
                  seen.add(cur.id);
                  cur = cur.parentTaskId ? byId.get(cur.parentTaskId) : null;
                }
                if (isCycle) continue;
              }
              task.parentTaskId = nextParent;
              changed = true;
            }
            if (u.stepOrder !== undefined && Number.isFinite(Number(u.stepOrder))) {
              task.stepOrder = Number(u.stepOrder);
              changed = true;
            }
            if (u.categoryId !== undefined) {
              task.categoryId = String(u.categoryId || '');
              changed = true;
            }
          }

          if (changed) {
            const pathMap = buildCategoryPathMap(store.Categories);
            for (const inst of store.TaskInstances) {
              if (inst.status === 'pending') {
                const t = byId.get(inst.taskId);
                if (t) {
                  inst.categoryPath = t.categoryId ? pathMap.get(t.categoryId) || 'General' : 'General';
                }
              }
            }
          }
          return changed;
        };

        await db.mutate((d) => applyBatch(d, true));
        if (includePrivate) {
          await db.mutatePrivate(member, (p) => applyBatch(p, false));
        }
        return sendJson(res, 200, { ok: true });
      }

      if (method === 'POST' && normalizedPath === '/api/tasks') {
        const body = await readJsonBody(req);
        const todayStr = getTodayStr(household.timezone);
        const result = await createTaskRecord({ member, household, body, todayStr });
        return sendJson(res, 201, result);
      }

      if (method === 'POST' && /^\/api\/tasks\/[^/]+\/quick-complete$/.test(normalizedPath)) {
        const taskId = normalizedPath.split('/')[3];
        const todayStr = getTodayStr(household.timezone);
        const fed = await db.getFederated(member, { includePrivate });
        const task = fed.tasks.find((t) => t.id === taskId);
        if (!task) return sendJson(res, 404, { error: 'Task not found.' });

        const alreadyDoneToday = fed.instances.find(
          (i) =>
            i.taskId === taskId &&
            i.status === 'completed' &&
            String(i.completedAt || '').startsWith(todayStr),
        );
        if (alreadyDoneToday) {
          return sendJson(res, 200, {
            instance: alreadyDoneToday,
            nextInstance: null,
            alreadyCompletedToday: true,
          });
        }

        // If an open instance due today or earlier already exists, complete it! Otherwise log a fresh completed run for today.
        const existingPending = fed.instances
          .filter((i) => i.taskId === taskId && isOpenStatus(i.status) && i.dueDate <= todayStr)
          .sort((a, b) => b.dueDate.localeCompare(a.dueDate))[0];
        if (existingPending) {
          const result = await completeInstanceById({
            member,
            household,
            instanceId: existingPending.id,
            body: { completed: true },
            todayStr,
          });
          return sendJson(res, 200, result);
        }

        const catPathMap = buildCategoryPathMap(fed.categories);
        const now = new Date().toISOString();
        const logged = {
          id: makeId('inst'),
          householdId: hhId,
          taskId: task.id,
          projectId: task.projectId || '',
          taskTitle: task.title,
          categoryPath: catPathMap.get(task.categoryId) || 'General',
          visibility: task.visibility || 'household',
          ownerId: task.ownerId || member.id,
          effort: Math.max(1, Number(task.effort) || 1),
          windowType: 'daily',
          dueDate: todayStr,
          windowEndDate: todayStr,
          triggerSource: 'quick_log',
          weatherUrgency: '',
          weatherSummary: '',
          assignmentMode: 'fixed',
          eligibleMemberIds: task.eligibleMemberIds || '',
          assigneeId: member.id,
          assigneeName: member.name,
          claimedBy: member.name,
          status: 'completed',
          overduePolicy: task.overduePolicy || 'roll_forward',
          reason: 'Quick-completed from Daily Cockpit',
          completedAt: now,
          completedBy: member.name,
          notes: '',
          createdAt: now,
        };

        if (task.visibility === 'private') {
          await db.mutatePrivate(member, (p) => p.TaskInstances.unshift(logged));
        } else {
          await db.mutate((d) => d.TaskInstances.unshift(logged));
        }
        return sendJson(res, 200, { instance: logged, nextInstance: null });
      }

      if (method === 'PATCH' && normalizedPath.startsWith('/api/tasks/')) {
        const taskId = normalizedPath.slice('/api/tasks/'.length);
        const body = await readJsonBody(req);
        const fed = await db.getFederated(member, { includePrivate });
        const found = fed.tasks.find((t) => t.id === taskId);
        if (!found) return sendJson(res, 404, { error: 'Task not found.' });
        const isPriv = found.storageSource === 'personal_sheet' || found.visibility === 'private';
        const catPathMap = buildCategoryPathMap(fed.categories);

        const hhMembers = fed.shared.Members.filter((m) => m.householdId === hhId);
        const updater = (store) => {
          const t = store.Tasks.find((x) => x.id === taskId);
          if (!t) throw Object.assign(new Error('Task not found'), { status: 404 });
          if (body.title !== undefined && String(body.title).trim()) t.title = String(body.title).trim();
          if (body.description !== undefined) t.description = String(body.description).trim();
          if (body.categoryId !== undefined) t.categoryId = String(body.categoryId);
          if (body.projectId !== undefined) t.projectId = String(body.projectId);
          if (body.parentTaskId !== undefined && body.parentTaskId !== t.id) {
            t.parentTaskId = String(body.parentTaskId);
          }
          if (body.stepOrder !== undefined) t.stepOrder = Number(body.stepOrder) || 0;
          if (body.isFavorite !== undefined) t.isFavorite = Boolean(body.isFavorite);
          if (body.needsDetails !== undefined) t.needsDetails = Boolean(body.needsDetails);
          if (body.isHabit !== undefined) t.isHabit = Boolean(body.isHabit);
          if (body.routineCue !== undefined) {
            t.routineCue = ['morning', 'afternoon', 'evening', 'anytime', ''].includes(body.routineCue)
              ? body.routineCue
              : t.routineCue || '';
          }
          if (body.effort !== undefined) t.effort = Math.min(5, Math.max(1, Number(body.effort) || 2));
          if (body.cadenceMode !== undefined) t.cadenceMode = String(body.cadenceMode);
          if (body.recurrenceType !== undefined) t.recurrenceType = String(body.recurrenceType);
          if (body.recurrenceInterval !== undefined) t.recurrenceInterval = Math.max(1, Number(body.recurrenceInterval) || 1);
          if (body.recurrenceDays !== undefined) {
            t.recurrenceDays = Array.isArray(body.recurrenceDays)
              ? body.recurrenceDays.join(',')
              : String(body.recurrenceDays);
          }
          if (body.targetSeason !== undefined) t.targetSeason = String(body.targetSeason);
          if (body.weatherTrigger !== undefined) t.weatherTrigger = String(body.weatherTrigger);
          if (body.weatherCooldownDays !== undefined) t.weatherCooldownDays = Math.max(1, Number(body.weatherCooldownDays) || 5);
          if (body.overduePolicy !== undefined) t.overduePolicy = String(body.overduePolicy);
          if (body.assignmentMode !== undefined) t.assignmentMode = String(body.assignmentMode);
          if (body.eligibleMemberIds !== undefined) {
            t.eligibleMemberIds = Array.isArray(body.eligibleMemberIds)
              ? body.eligibleMemberIds.join(',')
              : String(body.eligibleMemberIds);
          }
          if (body.fixedMemberId !== undefined) t.fixedMemberId = String(body.fixedMemberId);
          if (body.active !== undefined) t.active = Boolean(body.active);

          const newPath = catPathMap.get(t.categoryId) || 'General';
          const fixedMember = t.fixedMemberId ? hhMembers.find((m) => m.id === t.fixedMemberId) : null;
          const nextWindowType = [
            'weekly',
            'biweekly',
            'monthly',
            'custom_months',
            'quarterly',
            'seasonal',
            'yearly',
          ].includes(t.recurrenceType)
            ? t.recurrenceType
            : 'daily';
          const hasDateOverride = Boolean(
            body.firstDueDate && /^\d{4}-\d{2}-\d{2}$/.test(body.firstDueDate),
          );
          const hasEndOverride = Boolean(
            body.windowEndDate && /^\d{4}-\d{2}-\d{2}$/.test(body.windowEndDate),
          );
          let updatedOpenCount = 0;

          for (const inst of store.TaskInstances) {
            if (inst.taskId === t.id && isOpenStatus(inst.status)) {
              updatedOpenCount++;
              inst.taskTitle = t.title;
              inst.categoryPath = newPath;
              inst.projectId = t.projectId || '';
              inst.effort = t.effort;
              inst.overduePolicy = t.overduePolicy;
              inst.eligibleMemberIds = t.eligibleMemberIds;
              inst.assignmentMode = t.assignmentMode;
              if (body.cadenceMode !== undefined || body.recurrenceType !== undefined) {
                inst.windowType = nextWindowType;
              }
              if (hasDateOverride) {
                inst.dueDate = body.firstDueDate;
                if (hasEndOverride) {
                  inst.windowEndDate =
                    body.windowEndDate >= body.firstDueDate ? body.windowEndDate : body.firstDueDate;
                } else if (
                  t.cadenceMode !== 'flexible_window' ||
                  !inst.windowEndDate ||
                  inst.windowEndDate < body.firstDueDate ||
                  inst.windowType === 'daily'
                ) {
                  inst.windowEndDate = body.firstDueDate;
                }
              } else if (hasEndOverride) {
                inst.windowEndDate =
                  body.windowEndDate >= inst.dueDate ? body.windowEndDate : inst.dueDate;
              }
              if (body.assignmentMode === 'fixed' && fixedMember) {
                inst.assigneeId = fixedMember.id;
                inst.assigneeName = fixedMember.name;
              } else if (body.assignmentMode === 'open_pool') {
                inst.assigneeId = '';
                inst.assigneeName = '';
              }
            }
          }

          if (
            updatedOpenCount === 0 &&
            hasDateOverride &&
            t.active !== false &&
            t.cadenceMode !== 'weather_triggered'
          ) {
            const createdInst = buildInstanceFromTask({
              task: t,
              household,
              members: hhMembers,
              instances: store.TaskInstances,
              categoryPathMap: catPathMap,
              todayStr: getTodayStr(household.timezone),
              anchorDateStr: body.firstDueDate,
              triggerSource: t.projectId ? 'project' : 'schedule',
            });
            createdInst.dueDate = body.firstDueDate;
            if (hasEndOverride) {
              createdInst.windowEndDate =
                body.windowEndDate >= body.firstDueDate ? body.windowEndDate : body.firstDueDate;
            } else if (t.cadenceMode !== 'flexible_window' || createdInst.windowEndDate < body.firstDueDate) {
              createdInst.windowEndDate = body.firstDueDate;
            }
            store.TaskInstances.push(createdInst);
          }
          return t;
        };

        const updated = isPriv
          ? await db.mutatePrivate(member, updater)
          : await db.mutate(updater);
        return sendJson(res, 200, { task: updated });
      }

      if (method === 'DELETE' && normalizedPath.startsWith('/api/tasks/')) {
        const taskId = normalizedPath.slice('/api/tasks/'.length);
        await db.mutate((d) => {
          d.Tasks = d.Tasks.filter((t) => !(t.householdId === hhId && t.id === taskId));
          d.TaskInstances = d.TaskInstances.filter(
            (i) => !(i.householdId === hhId && i.taskId === taskId && i.status === 'pending'),
          );
        });
        await db.mutatePrivate(member, (p) => {
          p.Tasks = p.Tasks.filter((t) => t.id !== taskId);
          p.TaskInstances = p.TaskInstances.filter((i) => !(i.taskId === taskId && i.status === 'pending'));
        });
        return sendJson(res, 200, { ok: true });
      }

      // Schedule Generation
      if (method === 'POST' && normalizedPath === '/api/schedule/generate') {
        const body = await readJsonBody(req);
        const horizonDays = Math.min(45, Math.max(1, Number(body.horizonDays) || 14));
        const todayStr = getTodayStr(household.timezone);

        const sharedResult = await db.mutate((d) => {
          const hhMembers = d.Members.filter((m) => m.householdId === hhId);
          const hhCats = d.Categories.filter((c) => c.householdId === hhId);
          const hhTasks = d.Tasks.filter((t) => t.householdId === hhId);
          const hhInsts = d.TaskInstances.filter((i) => i.householdId === hhId);

          const { createdInstances, taskUpdates } = generateUpcomingSchedule({
            household,
            members: hhMembers,
            categories: hhCats,
            tasks: hhTasks,
            instances: hhInsts,
            todayStr,
            horizonDays,
          });
          d.TaskInstances.push(...createdInstances);
          for (const [tid, lastMid] of taskUpdates.entries()) {
            const t = d.Tasks.find((x) => x.id === tid);
            if (t) t.lastAssignedMemberId = lastMid;
          }
          return createdInstances.length;
        });

        let privCount = 0;
        if (includePrivate) {
          privCount = await db.mutatePrivate(member, (p) => {
            const { createdInstances } = generateUpcomingSchedule({
              household,
              members: [member],
              categories: p.Categories || [],
              tasks: p.Tasks || [],
              instances: p.TaskInstances || [],
              todayStr,
              horizonDays,
            });
            p.TaskInstances.push(...createdInstances);
            return createdInstances.length;
          });
        }

        return sendJson(res, 200, { createdCount: sharedResult + privCount });
      }

      // Task Instances: List, Complete, Claim, Skip, Update, Delete
      if (method === 'GET' && normalizedPath === '/api/instances') {
        const { fed } = await syncDynamicState({ member, household, includePrivate });
        let list = fed.instances;
        const status = url.searchParams.get('status');
        if (status) list = list.filter((i) => i.status === status);
        return sendJson(res, 200, { instances: list });
      }

      if (method === 'POST' && normalizedPath === '/api/instances/ad-hoc') {
        const body = await readJsonBody(req);
        const title = String(body.title || body.text || '').trim();
        if (!title) return sendJson(res, 400, { error: 'Please describe what you did.' });

        const visibility = body.visibility === 'private' ? 'private' : 'household';
        const todayStr = getTodayStr(household.timezone);
        const performedDate =
          body.date && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : todayStr;
        const fed = await db.getFederated(member, { includePrivate: true });
        const catPathMap = buildCategoryPathMap(fed.categories);
        const categoryId = String(body.categoryId || '');
        const categoryPath = categoryId
          ? catPathMap.get(categoryId) || 'General'
          : visibility === 'private'
            ? 'Personal (Ad-Hoc)'
            : 'General';

        const now = new Date().toISOString();
        const completedAt = performedDate === todayStr ? now : `${performedDate}T12:00:00.000Z`;

        const instance = {
          id: makeId('inst'),
          householdId: hhId,
          taskId: '',
          projectId: '',
          taskTitle: title,
          categoryPath,
          visibility,
          ownerId: member.id,
          effort: Math.min(5, Math.max(1, Number(body.effort) || 1)),
          windowType: 'ad_hoc',
          dueDate: performedDate,
          windowEndDate: performedDate,
          triggerSource: 'ad_hoc',
          weatherUrgency: '',
          weatherSummary: '',
          assignmentMode: 'fixed',
          eligibleMemberIds: visibility === 'private' ? member.id : '',
          assigneeId: member.id,
          assigneeName: member.name,
          claimedBy: member.name,
          status: 'completed',
          overduePolicy: 'auto_skip',
          reason: 'Ad-hoc record',
          completedAt,
          completedBy: member.name,
          notes: String(body.notes || '').trim(),
          createdAt: now,
        };

        if (visibility === 'private') {
          await db.mutatePrivate(member, (p) => {
            p.TaskInstances.unshift(instance);
          });
        } else {
          await db.mutate((d) => {
            d.TaskInstances.unshift(instance);
          });
        }

        return sendJson(res, 201, { instance });
      }

      if (method === 'POST' && /^\/api\/instances\/[^/]+\/complete$/.test(normalizedPath)) {
        const instanceId = normalizedPath.split('/')[3];
        const body = await readJsonBody(req);
        const todayStr = getTodayStr(household.timezone);
        const result = await completeInstanceById({ member, household, instanceId, body, todayStr });
        return sendJson(res, 200, result);
      }

      if (method === 'POST' && /^\/api\/instances\/[^/]+\/claim$/.test(normalizedPath)) {
        const instanceId = normalizedPath.split('/')[3];
        const body = await readJsonBody(req);
        const result = await claimInstanceById({ member, instanceId, unclaim: Boolean(body.unclaim) });
        return sendJson(res, 200, result);
      }

      if (method === 'POST' && /^\/api\/instances\/[^/]+\/skip$/.test(normalizedPath)) {
        const instanceId = normalizedPath.split('/')[3];
        const result = await skipInstanceById({ member, instanceId });
        return sendJson(res, 200, result);
      }

      if (method === 'POST' && /^\/api\/instances\/[^/]+\/defer$/.test(normalizedPath)) {
        const instanceId = normalizedPath.split('/')[3];
        const body = await readJsonBody(req);
        const todayStr = getTodayStr(household.timezone);
        const result = await deferInstanceById({ member, instanceId, body, todayStr });
        return sendJson(res, 200, result);
      }

      if (method === 'PATCH' && normalizedPath.startsWith('/api/instances/')) {
        const instanceId = normalizedPath.slice('/api/instances/'.length);
        const body = await readJsonBody(req);
        const fed = await db.getFederated(member, { includePrivate });
        const found = fed.instances.find((i) => i.id === instanceId);
        if (!found) return sendJson(res, 404, { error: 'Instance not found.' });
        const isPriv = found.storageSource === 'personal_sheet' || found.visibility === 'private';
        const hhMembers = fed.shared.Members.filter((m) => m.householdId === hhId);
        const catPathMap = buildCategoryPathMap(fed.categories);

        const updater = (store) => {
          const inst = store.TaskInstances.find((x) => x.id === instanceId);
          if (!inst) throw Object.assign(new Error('Instance not found'), { status: 404 });
          if (body.taskTitle !== undefined && String(body.taskTitle).trim()) {
            inst.taskTitle = String(body.taskTitle).trim();
          }
          if (body.categoryId !== undefined) {
            inst.categoryPath = body.categoryId
              ? catPathMap.get(String(body.categoryId)) || 'General'
              : inst.visibility === 'private'
                ? 'Personal (Ad-Hoc)'
                : 'General';
          } else if (body.categoryPath !== undefined && String(body.categoryPath).trim()) {
            inst.categoryPath = String(body.categoryPath).trim();
          }
          if (body.effort !== undefined) {
            inst.effort = Math.min(5, Math.max(1, Number(body.effort) || 1));
          }
          if (body.assigneeId !== undefined) {
            if (body.assigneeId === '') {
              inst.assigneeId = '';
              inst.assigneeName = '';
              inst.claimedBy = '';
              inst.assignmentMode = 'open_pool';
              inst.reason = 'Anyone';
            } else {
              const target = hhMembers.find((m) => m.id === body.assigneeId);
              if (!target) throw Object.assign(new Error('Assignee not found'), { status: 404 });
              inst.assigneeId = target.id;
              inst.assigneeName = target.name;
              if (inst.triggerSource === 'ad_hoc' || inst.status === 'completed') {
                inst.completedBy = target.name;
              } else {
                inst.reason = `Assigned by ${member.name.split(' ')[0]}`;
              }
            }
          }
          if (body.dueDate !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(body.dueDate)) {
            inst.dueDate = body.dueDate;
            if (inst.triggerSource === 'ad_hoc') {
              inst.windowEndDate = body.dueDate;
              inst.completedAt = `${body.dueDate}T12:00:00.000Z`;
            } else if (!inst.windowEndDate || inst.windowEndDate < body.dueDate) {
              inst.windowEndDate = body.dueDate;
            }
          }
          if (
            body.status !== undefined &&
            ['pending', 'started', 'on_hold', 'gated', 'completed', 'skipped'].includes(body.status)
          ) {
            inst.status = body.status;
            if (body.status === 'completed' && !inst.completedAt) {
              inst.completedAt = new Date().toISOString();
              inst.completedBy = member.name;
            } else if (body.status !== 'completed') {
              inst.completedAt = '';
              inst.completedBy = '';
            }
          }
          if (body.notes !== undefined) inst.notes = String(body.notes).trim();
          return inst;
        };

        const updated = isPriv
          ? await db.mutatePrivate(member, updater)
          : await db.mutate(updater);
        return sendJson(res, 200, { instance: updated });
      }

      if (method === 'DELETE' && normalizedPath.startsWith('/api/instances/')) {
        const instanceId = normalizedPath.slice('/api/instances/'.length);
        await db.mutate((d) => {
          d.TaskInstances = d.TaskInstances.filter((i) => !(i.householdId === hhId && i.id === instanceId));
        });
        await db.mutatePrivate(member, (p) => {
          p.TaskInstances = p.TaskInstances.filter((i) => i.id !== instanceId);
        });
        return sendJson(res, 200, { ok: true });
      }

      // Fair Distribution (Opt-in per user!)
      if (method === 'POST' && normalizedPath === '/api/distribution/preview') {
        const body = await readJsonBody(req);
        const todayStr = getTodayStr(household.timezone);
        const data = await db.getAll();
        const plan = computeRebalancePlan({
          household,
          members: data.Members.filter((m) => m.householdId === hhId),
          tasks: data.Tasks.filter((t) => t.householdId === hhId),
          instances: data.TaskInstances.filter((i) => i.householdId === hhId),
          todayStr,
          includeFixed: Boolean(body.includeFixed),
        });
        return sendJson(res, 200, {
          beforeLoads: plan.beforeLoads,
          afterLoads: plan.afterLoads,
          changes: plan.changes,
        });
      }

      if (method === 'POST' && normalizedPath === '/api/distribution/apply') {
        const body = await readJsonBody(req);
        const todayStr = getTodayStr(household.timezone);
        const result = await db.mutate((d) => {
          const plan = computeRebalancePlan({
            household,
            members: d.Members.filter((m) => m.householdId === hhId),
            tasks: d.Tasks.filter((t) => t.householdId === hhId),
            instances: d.TaskInstances.filter((i) => i.householdId === hhId),
            todayStr,
            includeFixed: Boolean(body.includeFixed),
          });
          const updatedMap = new Map(plan.simulatedInstances.map((i) => [i.id, i]));
          d.TaskInstances = d.TaskInstances.map((i) =>
            i.householdId === hhId && updatedMap.has(i.id) ? updatedMap.get(i.id) : i,
          );
          return { appliedCount: plan.changes.length, changes: plan.changes, afterLoads: plan.afterLoads };
        });
        return sendJson(res, 200, result);
      }

      // Reminders & Notifications
      if (method === 'POST' && normalizedPath === '/api/reminders/run') {
        const body = await readJsonBody(req);
        const type = body.type || 'both';
        const appUrl = getAppUrl(req);
        const todayStr = getTodayStr(household.timezone);

        const result = await db.mutate(async (d) => {
          const hhMembers = d.Members.filter((m) => m.householdId === hhId);
          const hhTasks = d.Tasks.filter((t) => t.householdId === hhId);
          const hhInsts = d.TaskInstances.filter((i) => i.householdId === hhId);
          const hhNotifs = d.Notifications.filter((n) => n.householdId === hhId);
          const forecast = await getTenDayForecast(household, todayStr);
          const weatherAlerts = evaluateWeatherAlerts(forecast.days, hhTasks, hhInsts, todayStr);

          const toSend = [];
          if (type === 'daily_digest' || type === 'both') {
            toSend.push(
              ...buildDailyDigestNotifications({
                household,
                members: hhMembers,
                instances: hhInsts,
                weatherAlerts,
                todayStr,
                appUrl,
              }),
            );
          }
          if (type === 'overdue_alert' || type === 'both') {
            toSend.push(
              ...buildOverdueAlertNotifications({
                household,
                members: hhMembers,
                instances: hhInsts,
                existingNotifications: body.force ? [] : hhNotifs,
                todayStr,
                appUrl,
              }),
            );
          }
          for (const n of toSend) {
            const priority = n._priority || 'default';
            delete n._priority;
            const delivery = await deliverExternalNotification(n, process.env, { priority });
            n.channel = delivery.channel;
            n.deliveryStatus = delivery.deliveryStatus;
            d.Notifications.unshift(n);
          }
          return { sentCount: toSend.length, notifications: toSend };
        });
        return sendJson(res, 200, result);
      }

      if (method === 'POST' && normalizedPath === '/api/notifications/read-all') {
        await db.mutate((d) => {
          const now = new Date().toISOString();
          for (const n of d.Notifications) {
            if (n.householdId === hhId && n.memberId === member.id && !n.readAt) n.readAt = now;
          }
        });
        return sendJson(res, 200, { ok: true });
      }

      // -----------------------------------------------------------------------
      // Site-Wide Administration (Strictly locked to SITE_ADMIN_EMAILS)
      // -----------------------------------------------------------------------
      if (method === 'GET' && normalizedPath === '/api/admin/overview') {
        if (!isSiteAdminMember(member)) {
          return sendJson(res, 403, { error: 'Site administrator access required.' });
        }
        const data = await db.getAll();
        const todayStr = getTodayStr(household.timezone || 'America/Los_Angeles');
        const sevenDaysAgo = addDays(todayStr, -6);

        const rawDaily =
          typeof db.getSiteAnalytics === 'function' ? await db.getSiteAnalytics() : [];
        const byDay = new Map(rawDaily.map((d) => [d.date, d]));
        const last14Days = [];
        for (let offset = -13; offset <= 0; offset++) {
          const d = addDays(todayStr, offset);
          const row = byDay.get(d);
          last14Days.push({
            date: d,
            pageViews: row?.pageViews || 0,
            demoLaunches: row?.demoLaunches || 0,
          });
        }

        const totalPageViews = rawDaily.reduce((s, r) => s + (r.pageViews || 0), 0);
        const totalDemoLaunches = rawDaily.reduce((s, r) => s + (r.demoLaunches || 0), 0);
        const todayRow = byDay.get(todayStr);
        const last7DaysPageViews = rawDaily
          .filter((r) => r.date >= sevenDaysAgo)
          .reduce((s, r) => s + (r.pageViews || 0), 0);
        const last7DaysDemoLaunches = rawDaily
          .filter((r) => r.date >= sevenDaysAgo)
          .reduce((s, r) => s + (r.demoLaunches || 0), 0);

        const households = data.Households.map((hh) => {
          const hhMembers = data.Members.filter((m) => m.householdId === hh.id);
          const hhTasks = data.Tasks.filter((t) => t.householdId === hh.id && t.visibility !== 'private');
          const hhProjects = data.Projects.filter((p) => p.householdId === hh.id && p.visibility !== 'private');
          const hhInsts = data.TaskInstances.filter((i) => i.householdId === hh.id && i.visibility !== 'private');
          const hhInvites = data.Invites.filter((i) => i.householdId === hh.id);
          const completedCount = hhInsts.filter((i) => i.status === 'completed').length;
          const openCount = hhInsts.filter((i) => isOpenStatus(i.status)).length;
          const timestamps = [
            hh.createdAt,
            ...hhMembers.map((m) => m.createdAt),
            ...hhTasks.map((t) => t.createdAt),
            ...hhInsts.map((i) => i.completedAt || i.createdAt),
          ]
            .filter(Boolean)
            .sort();
          const lastActivityAt = timestamps[timestamps.length - 1] || hh.createdAt || '';

          return {
            id: hh.id,
            name: hh.name,
            locationName: hh.locationName || '',
            timezone: hh.timezone || '',
            createdAt: hh.createdAt || '',
            lastActivityAt,
            isCurrentHousehold: hh.id === hhId,
            memberCount: hhMembers.length,
            members: hhMembers.map((m) => ({
              id: m.id,
              name: m.name,
              email: m.email,
              role: m.role,
              memberGroup: m.memberGroup || 'partner',
              active: m.active !== false,
            })),
            taskCount: hhTasks.length,
            projectCount: hhProjects.length,
            completedCount,
            openCount,
            inviteCount: hhInvites.length,
          };
        }).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

        const status = db.getStatus();
        return sendJson(res, 200, {
          analytics: {
            totalPageViews,
            todayPageViews: todayRow?.pageViews || 0,
            last7DaysPageViews,
            totalDemoLaunches,
            todayDemoLaunches: todayRow?.demoLaunches || 0,
            last7DaysDemoLaunches,
            daily: last14Days,
          },
          totals: {
            households: households.length,
            members: data.Members.length,
            activeMembers: data.Members.filter((m) => m.active !== false).length,
            tasks: data.Tasks.filter((t) => t.visibility !== 'private').length,
            projects: data.Projects.filter((p) => p.visibility !== 'private').length,
            completedInstances: data.TaskInstances.filter(
              (i) => i.visibility !== 'private' && i.status === 'completed',
            ).length,
          },
          config: {
            storageMode: status.mode,
            storageLabel: status.label,
            demoEnabled: isDemoEnabled(process.env),
            registrationCodeRequired: Boolean((process.env.REGISTRATION_CODE || '').trim()),
            emailConfigured: Boolean(process.env.RESEND_API_KEY),
            ntfyConfigured: Boolean(process.env.NTFY_TOPIC_URL),
            webhookConfigured: Boolean(process.env.REMINDER_WEBHOOK_URL),
            appUrl: getAppUrl(req),
          },
          households,
        });
      }

      if (method === 'DELETE' && normalizedPath.startsWith('/api/admin/households/')) {
        if (!isSiteAdminMember(member)) {
          return sendJson(res, 403, { error: 'Site administrator access required.' });
        }
        const targetHhId = decodeURIComponent(normalizedPath.slice('/api/admin/households/'.length));
        if (!targetHhId) return sendJson(res, 400, { error: 'Missing household ID.' });
        if (targetHhId === hhId) {
          return sendJson(res, 400, {
            error: 'Cannot delete your own currently signed-in household from the admin panel.',
          });
        }

        const deleted = await db.mutate((d) => {
          const targetHh = d.Households.find((h) => h.id === targetHhId);
          if (!targetHh) throw Object.assign(new Error('Household not found.'), { status: 404 });
          const targetMemberIds = d.Members.filter((m) => m.householdId === targetHhId).map((m) => m.id);
          d.Households = d.Households.filter((h) => h.id !== targetHhId);
          d.Members = d.Members.filter((m) => m.householdId !== targetHhId);
          d.Invites = d.Invites.filter((i) => i.householdId !== targetHhId);
          d.ApiKeys = d.ApiKeys.filter((k) => k.householdId !== targetHhId);
          d.Categories = d.Categories.filter((c) => c.householdId !== targetHhId);
          d.Projects = d.Projects.filter((p) => p.householdId !== targetHhId);
          d.Tasks = d.Tasks.filter((t) => t.householdId !== targetHhId);
          d.TaskInstances = d.TaskInstances.filter((i) => i.householdId !== targetHhId);
          d.Notifications = d.Notifications.filter((n) => n.householdId !== targetHhId);
          return { name: targetHh.name, memberIds: targetMemberIds };
        });

        if (typeof db.deletePrivateScope === 'function') {
          for (const mid of deleted.memberIds) {
            await db.deletePrivateScope(mid).catch(() => {});
          }
        }

        return sendJson(res, 200, {
          ok: true,
          deletedHouseholdName: deleted.name,
          deletedMemberCount: deleted.memberIds.length,
        });
      }

      // Sheet Sync, Init, Export (Shared & Personal!)
      if (method === 'POST' && normalizedPath === '/api/sheet/sync') {
        await db.getAll({ forceRefresh: true });
        await db.getPrivate(member, { forceRefresh: true });
        return sendJson(res, 200, {
          ok: true,
          storage: { shared: db.getStatus(), personal: db.getPrivateStatus(member) },
        });
      }

      if (method === 'POST' && normalizedPath === '/api/sheet/init') {
        const shared = await db.initializeSheet({ seedDemo: false });
        const personal = await db.initializePrivateSheet(member);
        return sendJson(res, 200, { ok: true, storage: { shared, personal } });
      }

      if (method === 'GET' && normalizedPath === '/api/sheet/export') {
        const scope = url.searchParams.get('scope') === 'private' ? 'private' : 'shared';
        const tab = url.searchParams.get('tab');
        const csvMap = await db.exportTabsAsCsv({ scope, member });
        if (tab && csvMap[tab]) {
          res.writeHead(200, {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="home-hub-${scope}-${tab.toLowerCase()}.csv"`,
          });
          return res.end(csvMap[tab]);
        }
        return sendJson(res, 200, { scope, tabs: csvMap });
      }

      return sendJson(res, 404, { error: `API route not found: ${method} ${pathname}` });
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) {
        console.error(`[API Error] ${method} ${pathname}:`, err);
      }
      return sendJson(res, status, { error: err.message || 'Internal server error' });
    }
  };
}
