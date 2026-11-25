import { makeId } from './schema.js';

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const SEASONS = ['spring', 'summer', 'fall', 'winter'];
export const OPEN_STATUSES = new Set(['pending', 'started', 'on_hold', 'gated']);
export function isOpenStatus(status) {
  return OPEN_STATUSES.has(status);
}

export function getTodayStr(timezone = 'UTC') {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());
    const y = parts.find((p) => p.type === 'year')?.value;
    const m = parts.find((p) => p.type === 'month')?.value;
    const d = parts.find((p) => p.type === 'day')?.value;
    if (y && m && d) return `${y}-${m}-${d}`;
  } catch {
    // Fallback
  }
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function parseDateStr(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
}

export function formatDateUTC(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDays(dateStr, days) {
  const d = parseDateStr(dateStr);
  d.setUTCDate(d.getUTCDate() + days);
  return formatDateUTC(d);
}

export function diffDays(aStr, bStr) {
  const a = parseDateStr(aStr);
  const b = parseDateStr(bStr);
  return Math.round((a.getTime() - b.getTime()) / 86_400_000);
}

export function getWeekdayName(dateStr) {
  return WEEKDAYS[parseDateStr(dateStr).getUTCDay()];
}

export function parseCsvIds(str) {
  if (!str) return [];
  if (Array.isArray(str)) return str.filter(Boolean);
  return String(str)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function getCurrentSeason(dateStr) {
  const month = parseDateStr(dateStr).getUTCMonth() + 1;
  if (month >= 3 && month <= 5) return 'spring';
  if (month >= 6 && month <= 8) return 'summer';
  if (month >= 9 && month <= 11) return 'fall';
  return 'winter';
}

export function getWindowBounds(recurrenceType, anchorDateStr, targetSeason = '') {
  const dt = parseDateStr(anchorDateStr);
  const y = dt.getUTCFullYear();
  const m = dt.getUTCMonth(); // 0..11

  if (recurrenceType === 'weekly' || recurrenceType === 'biweekly') {
    const dow = dt.getUTCDay(); // 0 Sun .. 6 Sat
    const mondayOffset = dow === 0 ? -6 : 1 - dow;
    const start = addDays(anchorDateStr, mondayOffset);
    const span = recurrenceType === 'biweekly' ? 13 : 6;
    return { windowType: recurrenceType, dueDate: start, windowEndDate: addDays(start, span) };
  }

  if (recurrenceType === 'monthly') {
    const start = formatDateUTC(new Date(Date.UTC(y, m, 1, 12)));
    const end = formatDateUTC(new Date(Date.UTC(y, m + 1, 0, 12)));
    return { windowType: 'monthly', dueDate: start, windowEndDate: end };
  }

  if (recurrenceType === 'quarterly') {
    const qStartMonth = Math.floor(m / 3) * 3;
    const start = formatDateUTC(new Date(Date.UTC(y, qStartMonth, 1, 12)));
    const end = formatDateUTC(new Date(Date.UTC(y, qStartMonth + 3, 0, 12)));
    return { windowType: 'quarterly', dueDate: start, windowEndDate: end };
  }

  if (recurrenceType === 'seasonal') {
    const season = SEASONS.includes(targetSeason) ? targetSeason : getCurrentSeason(anchorDateStr);
    const ranges = {
      spring: [2, 5], // Mar 1 .. May 31
      summer: [5, 8], // Jun 1 .. Aug 31
      fall: [8, 11], // Sep 1 .. Nov 30
      winter: [11, 14], // Dec 1 .. Feb 28/29
    };
    const [sm, em] = ranges[season];
    let startYear = y;
    if (season === 'winter' && m <= 1) startYear = y - 1;
    let start = new Date(Date.UTC(startYear, sm, 1, 12));
    let end = new Date(Date.UTC(startYear, em, 0, 12));
    if (formatDateUTC(end) < anchorDateStr) {
      start = new Date(Date.UTC(startYear + 1, sm, 1, 12));
      end = new Date(Date.UTC(startYear + 1, em, 0, 12));
    }
    return {
      windowType: 'seasonal',
      dueDate: formatDateUTC(start),
      windowEndDate: formatDateUTC(end),
    };
  }

  if (recurrenceType === 'yearly') {
    return {
      windowType: 'yearly',
      dueDate: `${y}-01-01`,
      windowEndDate: `${y}-12-31`,
    };
  }

  return { windowType: 'daily', dueDate: anchorDateStr, windowEndDate: anchorDateStr };
}

export function computeNextDueDate(task, fromDateStr, { inclusive = false } = {}) {
  const type = task.recurrenceType || 'weekly';
  const interval = Math.max(1, Number(task.recurrenceInterval) || 1);
  const days = parseCsvIds(task.recurrenceDays).filter((d) => WEEKDAYS.includes(d));

  if (type === 'once') {
    return inclusive ? fromDateStr : null;
  }

  const startOffset = inclusive ? 0 : 1;

  if (type === 'daily' || type === 'custom_days') {
    return addDays(fromDateStr, inclusive ? 0 : interval);
  }

  if (type === 'weekly' || type === 'biweekly') {
    if (days.length > 0 && task.cadenceMode !== 'flexible_window') {
      const baseDate = !inclusive && type === 'biweekly' ? addDays(fromDateStr, 7) : fromDateStr;
      for (let i = startOffset; i <= 21; i++) {
        const candidate = addDays(baseDate, i);
        if (days.includes(getWeekdayName(candidate))) return candidate;
      }
    }
    const step = type === 'biweekly' ? 14 : 7 * interval;
    return addDays(fromDateStr, inclusive ? 0 : step);
  }

  if (type === 'monthly') {
    const base = parseDateStr(fromDateStr);
    const targetDay = Math.min(28, Math.max(1, interval || base.getUTCDate()));
    if (inclusive && base.getUTCDate() <= targetDay) {
      return formatDateUTC(new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), targetDay, 12)));
    }
    return formatDateUTC(new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, targetDay, 12)));
  }

  if (type === 'quarterly') {
    const base = parseDateStr(fromDateStr);
    const next = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + (inclusive ? 0 : 3), 1, 12));
    return formatDateUTC(next);
  }

  if (type === 'seasonal') {
    const anchor = inclusive ? fromDateStr : addDays(fromDateStr, 95);
    return getWindowBounds('seasonal', anchor, task.targetSeason).dueDate;
  }

  if (type === 'yearly') {
    const base = parseDateStr(fromDateStr);
    const y = base.getUTCFullYear() + (inclusive ? 0 : 1);
    return `${y}-01-01`;
  }

  return addDays(fromDateStr, 7);
}

/**
 * Build breadcrumb paths ("Home > Exterior & Yard > Seasonal & Weather") from flat Categories.
 */
export function buildCategoryPathMap(categories = []) {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const pathMap = new Map();

  for (const cat of categories) {
    const parts = [];
    const seen = new Set();
    let cur = cat;
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      parts.unshift(cur.name);
      cur = cur.parentCategoryId ? byId.get(cur.parentCategoryId) : null;
    }
    pathMap.set(cat.id, parts.join(' > '));
  }
  return pathMap;
}

/**
 * Enforce per-task overdue policies:
 * - auto_skip: marks past pending instances as skipped
 * - roll_forward: moves past pending instances cleanly into the active window
 * - carry_over: leaves pending so it remains visibly overdue
 */
export function reconcileOverdueInstances(instances, todayStr) {
  let changed = false;
  for (const inst of instances) {
    // Only auto-skip / roll-forward untouched pending instances (never auto-skip started/on_hold/gated work!)
    if (inst.status !== 'pending') continue;
    const endDate = inst.windowEndDate || inst.dueDate;
    if (!endDate || endDate >= todayStr) continue;

    const policy = inst.overduePolicy || 'carry_over';
    if (policy === 'auto_skip') {
      inst.status = 'skipped';
      inst.reason = 'Auto-skipped after window passed';
      changed = true;
    } else if (policy === 'roll_forward') {
      const bounds = getWindowBounds(inst.windowType || 'daily', todayStr);
      inst.dueDate = bounds.dueDate;
      inst.windowEndDate = bounds.windowEndDate;
      inst.reason = 'Rolled forward into current window';
      changed = true;
    }
  }
  return changed;
}

export function isMemberEligibleForInstance(instance, memberId) {
  if (instance.visibility === 'private') {
    return instance.ownerId === memberId;
  }
  if (instance.assigneeId) {
    return instance.assigneeId === memberId;
  }
  const eligible = parseCsvIds(instance.eligibleMemberIds);
  if (eligible.length === 0) return true;
  return eligible.includes(memberId);
}

export function getEligibleMembers(task, members) {
  const activeMembers = members.filter((m) => m.active !== false);
  if (task.visibility === 'private' && task.ownerId) {
    return activeMembers.filter((m) => m.id === task.ownerId);
  }
  const eligibleIds = parseCsvIds(task.eligibleMemberIds);
  if (eligibleIds.length === 0) return activeMembers;
  const filtered = activeMembers.filter((m) => eligibleIds.includes(m.id));
  return filtered.length > 0 ? filtered : activeMembers;
}

/**
 * Compute rolling 14-day workload metrics (shared household tasks only; private excluded).
 */
export function computeMemberLoads(members, instances, todayStr, windowDays = 14) {
  const activeMembers = members.filter((m) => m.active !== false);
  const totalCapacity = activeMembers.reduce(
    (sum, m) => sum + Math.max(0.25, Number(m.weeklyCapacity) || 1),
    0,
  );

  const windowStart = addDays(todayStr, -windowDays);
  const windowEnd = addDays(todayStr, windowDays);

  const byMember = new Map();
  for (const m of activeMembers) {
    byMember.set(m.id, {
      memberId: m.id,
      name: m.name,
      email: m.email,
      avatarColor: m.avatarColor || '#2D6A4F',
      role: m.role,
      memberGroup: m.memberGroup || 'partner',
      weeklyCapacity: Math.max(0.25, Number(m.weeklyCapacity) || 1),
      pendingPoints: 0,
      completedPoints: 0,
      totalPoints: 0,
      pendingCount: 0,
      completedCount: 0,
      overdueCount: 0,
    });
  }

  for (const inst of instances) {
    if (inst.visibility === 'private') continue;
    if (inst.status === 'skipped') continue;
    if (!inst.assigneeId) continue;

    const bucket = byMember.get(inst.assigneeId);
    if (!bucket) continue;

    const pts = Math.max(1, Number(inst.effort) || 1);
    const endDate = inst.windowEndDate || inst.dueDate;
    if (isOpenStatus(inst.status)) {
      if (inst.dueDate <= windowEnd) {
        bucket.pendingPoints += pts;
        bucket.totalPoints += pts;
        bucket.pendingCount += 1;
        if (endDate < todayStr && inst.status !== 'on_hold' && inst.status !== 'gated') {
          bucket.overdueCount += 1;
        }
      }
    } else if (inst.status === 'completed') {
      if (inst.dueDate >= windowStart && inst.dueDate <= windowEnd) {
        bucket.completedPoints += pts;
        bucket.totalPoints += pts;
        bucket.completedCount += 1;
      }
    }
  }

  const grandTotalPoints = Array.from(byMember.values()).reduce((s, b) => s + b.totalPoints, 0);

  return Array.from(byMember.values()).map((b) => {
    const normalizedLoad = Number((b.totalPoints / b.weeklyCapacity).toFixed(2));
    const targetPercent = totalCapacity > 0 ? Math.round((b.weeklyCapacity / totalCapacity) * 100) : 0;
    const actualPercent =
      grandTotalPoints > 0 ? Math.round((b.totalPoints / grandTotalPoints) * 100) : targetPercent;
    return {
      ...b,
      normalizedLoad,
      targetPercent,
      actualPercent,
      deltaPercent: actualPercent - targetPercent,
    };
  });
}

export function pickAssignee({
  task,
  members,
  instances,
  household,
  todayStr,
  extraLoadByMember = {},
}) {
  const eligible = getEligibleMembers(task, members);
  if (eligible.length === 0) {
    return { member: null, reason: 'No eligible members' };
  }

  if (task.visibility === 'private') {
    return { member: eligible[0], reason: 'Private personal task' };
  }

  const mode = task.assignmentMode || household?.rotationMode || 'open_pool';

  if (mode === 'open_pool') {
    const names = eligible.map((m) => m.name.split(' ')[0]).join(', ');
    return { member: null, reason: `Anyone (${names})` };
  }

  if (mode === 'fixed' && task.fixedMemberId) {
    const fixed = eligible.find((m) => m.id === task.fixedMemberId) || members.find((m) => m.id === task.fixedMemberId);
    if (fixed) {
      return { member: fixed, reason: `Assigned to ${fixed.name.split(' ')[0]}` };
    }
  }

  if (mode === 'round_robin') {
    const lastIdx = eligible.findIndex((m) => m.id === task.lastAssignedMemberId);
    const nextMember = eligible[(lastIdx + 1) % eligible.length];
    const prevMember = lastIdx >= 0 ? eligible[lastIdx] : null;
    return {
      member: nextMember,
      reason: prevMember
        ? `Round-robin (next after ${prevMember.name.split(' ')[0]})`
        : 'Round-robin rotation',
    };
  }

  const loads = computeMemberLoads(eligible, instances, todayStr, 14);
  const scored = loads.map((entry) => {
    const extraPts = extraLoadByMember[entry.memberId] || 0;
    const adjustedPoints = entry.totalPoints + extraPts;
    const normalized = adjustedPoints / entry.weeklyCapacity;
    const repeatPenalty =
      eligible.length > 1 && entry.memberId === task.lastAssignedMemberId ? 0.85 : 0;
    return { entry, adjustedPoints, score: normalized + repeatPenalty };
  });

  scored.sort((a, b) => {
    if (Math.abs(a.score - b.score) > 0.001) return a.score - b.score;
    return a.entry.name.localeCompare(b.entry.name);
  });

  const winner = scored[0];
  const member = eligible.find((m) => m.id === winner.entry.memberId);
  const firstName = member.name.split(' ')[0];
  const ptsLabel = winner.adjustedPoints === 1 ? '1 pt' : `${winner.adjustedPoints} pts`;
  const reason =
    eligible.length > 1 && task.lastAssignedMemberId && task.lastAssignedMemberId !== member.id
      ? `Balanced (${ptsLabel} load, rotated)`
      : `Balanced (${firstName} lowest load: ${ptsLabel})`;

  return { member, reason };
}

export function buildInstanceFromTask({
  task,
  household,
  members,
  instances,
  categoryPathMap,
  todayStr,
  anchorDateStr,
  triggerSource = 'schedule',
  weatherUrgency = '',
  weatherSummary = '',
  extraLoadByMember = {},
}) {
  const { member, reason } = pickAssignee({
    task,
    members,
    instances,
    household,
    todayStr,
    extraLoadByMember,
  });

  let windowType = 'daily';
  let dueDate = anchorDateStr;
  let windowEndDate = anchorDateStr;

  if (task.cadenceMode === 'flexible_window') {
    const bounds = getWindowBounds(task.recurrenceType || 'weekly', anchorDateStr, task.targetSeason);
    windowType = bounds.windowType;
    dueDate = bounds.dueDate;
    windowEndDate = bounds.windowEndDate;
  } else if (triggerSource === 'weather') {
    windowType = 'daily';
    dueDate = anchorDateStr;
    windowEndDate = anchorDateStr;
  } else {
    windowType =
      ['weekly', 'monthly', 'quarterly', 'seasonal', 'yearly'].includes(task.recurrenceType)
        ? task.recurrenceType
        : 'daily';
  }

  return {
    id: makeId('inst'),
    householdId: household.id,
    taskId: task.id,
    projectId: task.projectId || '',
    taskTitle: task.title,
    categoryPath: categoryPathMap.get(task.categoryId) || 'General',
    visibility: task.visibility || 'household',
    ownerId: task.ownerId || '',
    effort: Math.max(1, Number(task.effort) || 1),
    windowType,
    dueDate,
    windowEndDate,
    triggerSource,
    weatherUrgency,
    weatherSummary,
    assignmentMode: task.assignmentMode || 'open_pool',
    eligibleMemberIds: task.eligibleMemberIds || '',
    assigneeId: member ? member.id : '',
    assigneeName: member ? member.name : '',
    claimedBy: '',
    status: 'pending',
    overduePolicy: task.overduePolicy || 'carry_over',
    reason: weatherSummary || reason,
    completedAt: '',
    completedBy: '',
    notes: '',
    createdAt: new Date().toISOString(),
  };
}

export function generateUpcomingSchedule({
  household,
  members,
  categories,
  tasks,
  instances,
  todayStr,
  horizonDays = 14,
}) {
  const endDateStr = addDays(todayStr, horizonDays);
  const categoryPathMap = buildCategoryPathMap(categories);
  const createdInstances = [];
  const workingInstances = [...instances];
  const extraLoadByMember = {};
  const taskUpdates = new Map();

  for (const task of tasks) {
    if (task.active === false) continue;
    if (task.projectId) continue; // Project steps are scheduled directly
    if (task.cadenceMode === 'weather_triggered') continue;
    if (task.recurrenceType === 'once') continue;

    // For flexible windows >= weekly, just ensure one active pending instance covers current window
    if (task.cadenceMode === 'flexible_window' && task.recurrenceType !== 'daily') {
      const hasPending = workingInstances.some(
        (i) => i.taskId === task.id && isOpenStatus(i.status),
      );
      if (hasPending) continue;
      const inst = buildInstanceFromTask({
        task,
        household,
        members,
        instances: workingInstances,
        categoryPathMap,
        todayStr,
        anchorDateStr: todayStr,
        extraLoadByMember,
      });
      createdInstances.push(inst);
      workingInstances.push(inst);
      if (inst.assigneeId) {
        extraLoadByMember[inst.assigneeId] = (extraLoadByMember[inst.assigneeId] || 0) + inst.effort;
        taskUpdates.set(task.id, inst.assigneeId);
      }
      continue;
    }

    const existingDates = new Set(
      workingInstances.filter((i) => i.taskId === task.id).map((i) => i.dueDate),
    );

    const taskInsts = workingInstances
      .filter((i) => i.taskId === task.id)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

    let cursor;
    if (taskInsts.length > 0 && taskInsts[taskInsts.length - 1].dueDate >= todayStr) {
      cursor = computeNextDueDate(task, taskInsts[taskInsts.length - 1].dueDate, { inclusive: false });
    } else {
      cursor = computeNextDueDate(task, todayStr, { inclusive: true });
    }

    let lastAssigned = task.lastAssignedMemberId;
    let safety = 0;

    while (cursor && cursor <= endDateStr && safety < 25) {
      safety++;
      if (!existingDates.has(cursor)) {
        const tempTask = { ...task, lastAssignedMemberId: lastAssigned };
        const inst = buildInstanceFromTask({
          task: tempTask,
          household,
          members,
          instances: workingInstances,
          categoryPathMap,
          todayStr,
          anchorDateStr: cursor,
          extraLoadByMember,
        });
        createdInstances.push(inst);
        workingInstances.push(inst);
        existingDates.add(cursor);
        if (inst.assigneeId) {
          extraLoadByMember[inst.assigneeId] = (extraLoadByMember[inst.assigneeId] || 0) + inst.effort;
          lastAssigned = inst.assigneeId;
          taskUpdates.set(task.id, lastAssigned);
        }
      }
      cursor = computeNextDueDate(task, cursor, { inclusive: false });
    }
  }

  return { createdInstances, taskUpdates };
}

export function computeRebalancePlan({
  household,
  members,
  tasks,
  instances,
  todayStr,
  includeFixed = false,
}) {
  const activeMembers = members.filter((m) => m.active !== false);
  const sharedInstances = instances.filter((i) => i.visibility !== 'private');
  const taskMap = new Map(tasks.map((t) => [t.id, t]));

  const beforeLoads = computeMemberLoads(activeMembers, sharedInstances, todayStr, 14);

  const mutable = sharedInstances
    .filter((inst) => {
      if (inst.status !== 'pending') return false;
      if (inst.assignmentMode === 'open_pool' && !inst.assigneeId) return false;
      const task = taskMap.get(inst.taskId);
      if (!includeFixed && task?.assignmentMode === 'fixed') return false;
      return true;
    })
    .sort((a, b) => {
      if (Number(b.effort) !== Number(a.effort)) return Number(b.effort) - Number(a.effort);
      return a.dueDate.localeCompare(b.dueDate);
    });

  const mutableIds = new Set(mutable.map((m) => m.id));
  const simulated = sharedInstances.filter((i) => !mutableIds.has(i.id));
  const extraLoadByMember = {};
  const lastByTask = new Map(tasks.map((t) => [t.id, t.lastAssignedMemberId]));
  const changes = [];

  for (const inst of mutable) {
    const task = taskMap.get(inst.taskId) || {
      id: inst.taskId,
      assignmentMode: household.rotationMode || 'auto_balanced',
      eligibleMemberIds: inst.eligibleMemberIds || '',
      visibility: 'household',
    };
    const simTask = {
      ...task,
      assignmentMode:
        task.assignmentMode === 'fixed' && includeFixed
          ? household.rotationMode || 'auto_balanced'
          : task.assignmentMode === 'open_pool'
            ? household.rotationMode || 'auto_balanced'
            : task.assignmentMode,
      lastAssignedMemberId: lastByTask.get(inst.taskId) || '',
    };

    const { member, reason } = pickAssignee({
      task: simTask,
      members: activeMembers,
      instances: simulated,
      household,
      todayStr,
      extraLoadByMember,
    });

    if (!member) {
      simulated.push(inst);
      continue;
    }

    const updated = { ...inst, assigneeId: member.id, assigneeName: member.name, reason };
    simulated.push(updated);
    extraLoadByMember[member.id] = (extraLoadByMember[member.id] || 0) + (Number(inst.effort) || 1);
    lastByTask.set(inst.taskId, member.id);

    if (member.id !== inst.assigneeId) {
      changes.push({
        instanceId: inst.id,
        taskTitle: inst.taskTitle,
        dueDate: inst.dueDate,
        effort: inst.effort,
        fromMemberId: inst.assigneeId,
        fromMemberName: inst.assigneeName || 'Unassigned',
        toMemberId: member.id,
        toMemberName: member.name,
        reason,
      });
    }
  }

  const afterLoads = computeMemberLoads(activeMembers, simulated, todayStr, 14);
  return { beforeLoads, afterLoads, changes, simulatedInstances: simulated };
}

/**
 * Compute lightweight habit consistency stats (7-day dots + current/best streak)
 * directly from existing TaskInstances — zero extra Google Sheet tabs required.
 */
export function computeHabitStats(tasks = [], instances = [], todayStr) {
  const habits = tasks.filter((t) => Boolean(t.isHabit) && t.active !== false);
  const completedByTask = new Map();
  const todayCompletedInstanceByTask = new Map();

  for (const inst of instances) {
    if (inst.status !== 'completed' || !inst.taskId) continue;
    const completedDate =
      inst.completedAt && /^\d{4}-\d{2}-\d{2}/.test(String(inst.completedAt))
        ? String(inst.completedAt).slice(0, 10)
        : inst.dueDate || '';
    const dateKey =
      inst.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(inst.dueDate) && inst.triggerSource !== 'quick_log'
        ? inst.dueDate
        : completedDate;
    if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) continue;

    if (!completedByTask.has(inst.taskId)) completedByTask.set(inst.taskId, new Set());
    completedByTask.get(inst.taskId).add(dateKey);

    if (dateKey === todayStr || completedDate === todayStr) {
      completedByTask.get(inst.taskId).add(todayStr);
      todayCompletedInstanceByTask.set(inst.taskId, inst.id);
    }
  }

  return habits.map((habit) => {
    const doneDates = completedByTask.get(habit.id) || new Set();
    const last7Days = [];
    for (let offset = -6; offset <= 0; offset++) {
      const date = addDays(todayStr, offset);
      last7Days.push({
        date,
        weekday: getWeekdayName(date),
        done: doneDates.has(date),
        isToday: offset === 0,
      });
    }

    const doneToday = doneDates.has(todayStr);
    const completedLast7 = last7Days.filter((d) => d.done).length;

    // Current streak: count backwards from today (if done today) or yesterday (so morning streak stays intact)
    let currentStreak = 0;
    let cursor = doneToday ? todayStr : addDays(todayStr, -1);
    let safety = 0;
    while (doneDates.has(cursor) && safety < 3650) {
      currentStreak++;
      cursor = addDays(cursor, -1);
      safety++;
    }

    // Best streak across recorded completion history
    const sortedDates = Array.from(doneDates).sort();
    let bestStreak = 0;
    let run = 0;
    let prev = '';
    for (const d of sortedDates) {
      if (prev && diffDays(d, prev) === 1) {
        run++;
      } else {
        run = 1;
      }
      if (run > bestStreak) bestStreak = run;
      prev = d;
    }

    return {
      taskId: habit.id,
      doneToday,
      todayCompletedInstanceId: todayCompletedInstanceByTask.get(habit.id) || null,
      currentStreak,
      bestStreak,
      completedLast7,
      last7Days,
    };
  });
}
