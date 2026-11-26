import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCategoryPathMap,
  computeHabitStats,
  computeMemberLoads,
  computeNextDueDate,
  computeRebalancePlan,
  getWindowBounds,
  pickAssignee,
  reconcileOverdueInstances,
} from '../server/taskEngine.js';
import { buildDailyDigestNotifications } from '../server/reminders.js';
import { buildSimulatedForecast, evaluateWeatherAlerts } from '../server/weather.js';

const members = [
  { id: 'm1', name: 'Maya', email: 'maya@test', active: true, weeklyCapacity: 1.0, role: 'admin', memberGroup: 'partner' },
  { id: 'm2', name: 'Alex', email: 'alex@test', active: true, weeklyCapacity: 1.0, role: 'admin', memberGroup: 'partner' },
  { id: 'm3', name: 'Riley', email: 'riley@test', active: true, weeklyCapacity: 0.5, role: 'member', memberGroup: 'kid' },
];

const household = { id: 'hh1', name: 'Test Home', timezone: 'UTC', rotationMode: 'auto_balanced' };

test('window bounds & next due dates support quarterly, seasonal, and yearly horizons', () => {
  const q = getWindowBounds('quarterly', '2026-11-24');
  assert.equal(q.dueDate, '2026-10-01');
  assert.equal(q.windowEndDate, '2026-12-31');

  const fall = getWindowBounds('seasonal', '2026-10-10', 'fall');
  assert.equal(fall.dueDate, '2026-09-01');
  assert.equal(fall.windowEndDate, '2026-11-30');

  const yr = getWindowBounds('yearly', '2026-11-24');
  assert.equal(yr.dueDate, '2026-01-01');
  assert.equal(yr.windowEndDate, '2026-12-31');

  assert.equal(computeNextDueDate({ recurrenceType: 'yearly' }, '2026-11-24'), '2027-01-01');
  assert.equal(computeNextDueDate({ recurrenceType: 'quarterly' }, '2026-10-01'), '2027-01-01');

  // Every N months (custom_months): window bounds + clamped month advancement
  const every6 = getWindowBounds('custom_months', '2026-11-25', '', 6);
  assert.equal(every6.windowType, 'custom_months');
  assert.equal(every6.dueDate, '2026-11-01');
  assert.equal(every6.windowEndDate, '2027-04-30');

  assert.equal(
    computeNextDueDate({ recurrenceType: 'custom_months', recurrenceInterval: 6 }, '2026-11-25'),
    '2027-05-25',
  );
  assert.equal(
    computeNextDueDate({ recurrenceType: 'custom_months', recurrenceInterval: 1 }, '2026-01-31'),
    '2026-02-28',
  );

  // Yearly with targetMonth (e.g. September = 9)
  const sepInYear = getWindowBounds('yearly', '2026-09-05', '', 1, 9);
  assert.equal(sepInYear.dueDate, '2026-09-01');
  assert.equal(sepInYear.windowEndDate, '2026-09-30');

  const sepNextYear = getWindowBounds('yearly', '2026-11-26', '', 1, 9);
  assert.equal(sepNextYear.dueDate, '2027-09-01');
  assert.equal(sepNextYear.windowEndDate, '2027-09-30');

  assert.equal(
    computeNextDueDate({ recurrenceType: 'yearly', targetMonth: 9 }, '2026-09-15'),
    '2027-09-01',
  );
});

test('daily digest separates Overdue, Today, This Week, and This Month and hides distant yearly tasks', () => {
  const notifs = buildDailyDigestNotifications({
    household,
    members: [members[0]],
    todayStr: '2026-11-26',
    instances: [
      { id: 'i_over', taskTitle: 'Overdue bill', categoryPath: 'Finance', visibility: 'household', status: 'pending', assignmentMode: 'open_pool', assigneeId: '', dueDate: '2026-11-24', windowEndDate: '2026-11-24' },
      { id: 'i_today', taskTitle: 'Take out trash', categoryPath: 'Home', visibility: 'household', status: 'pending', assignmentMode: 'open_pool', assigneeId: '', dueDate: '2026-11-26', windowEndDate: '2026-11-26' },
      { id: 'i_week', taskTitle: 'Clean fridge', categoryPath: 'Home', visibility: 'household', status: 'pending', assignmentMode: 'open_pool', assigneeId: '', dueDate: '2026-11-01', windowEndDate: '2026-11-30' },
      { id: 'i_month', taskTitle: 'Service furnace', categoryPath: 'Home', visibility: 'household', status: 'pending', assignmentMode: 'open_pool', assigneeId: '', dueDate: '2026-12-01', windowEndDate: '2026-12-20' },
      { id: 'i_year_far', taskTitle: 'Flush water heater', categoryPath: 'Home', visibility: 'household', status: 'pending', assignmentMode: 'open_pool', assigneeId: '', dueDate: '2026-01-01', windowEndDate: '2026-12-31' },
      { id: 'i_sep_next', taskTitle: 'Clean out gutters', categoryPath: 'Home', visibility: 'household', status: 'pending', assignmentMode: 'open_pool', assigneeId: '', dueDate: '2027-09-01', windowEndDate: '2027-09-30' },
    ],
  });

  assert.equal(notifs.length, 1);
  const body = notifs[0].body;
  assert.match(body, /Overdue \(1\):[\s\S]*Overdue bill/);
  assert.match(body, /Today \(1\):[\s\S]*Take out trash/);
  assert.match(body, /This Week \(1\):[\s\S]*Clean fridge/);
  assert.match(body, /This Month \(1\):[\s\S]*Service furnace/);
  assert.doesNotMatch(body, /Flush water heater/);
  assert.doesNotMatch(body, /Clean out gutters/);
});

test('reconcileOverdueInstances respects carry_over, auto_skip, and roll_forward', () => {
  const instances = [
    { id: 'i1', status: 'pending', overduePolicy: 'carry_over', windowType: 'daily', dueDate: '2026-11-20', windowEndDate: '2026-11-20' },
    { id: 'i2', status: 'pending', overduePolicy: 'auto_skip', windowType: 'daily', dueDate: '2026-11-20', windowEndDate: '2026-11-20' },
    { id: 'i3', status: 'pending', overduePolicy: 'roll_forward', windowType: 'daily', dueDate: '2026-11-20', windowEndDate: '2026-11-20' },
  ];
  const changed = reconcileOverdueInstances(instances, '2026-11-24');
  assert.equal(changed, true);
  assert.equal(instances[0].status, 'pending');
  assert.equal(instances[0].dueDate, '2026-11-20');
  assert.equal(instances[1].status, 'skipped');
  assert.equal(instances[2].status, 'pending');
  assert.equal(instances[2].dueDate, '2026-11-24');
});

test('two-tier weather alerts classify 1-3d as urgent and 4-10d as heads_up, respecting cooldown', () => {
  const forecast = buildSimulatedForecast('rain_and_freeze', '2026-11-24');
  const tasks = [
    { id: 't_rain', title: 'Cover patio', active: true, weatherTrigger: 'rain_soon', weatherCooldownDays: 5 },
    { id: 't_freeze', title: 'Clear irrigation', active: true, weatherTrigger: 'freeze_soon', weatherCooldownDays: 14 },
  ];
  const alerts = evaluateWeatherAlerts(forecast, tasks, [], '2026-11-24');
  assert.equal(alerts.length, 2);
  assert.equal(alerts[0].taskId, 't_rain');
  assert.equal(alerts[0].urgency, 'urgent');
  assert.equal(alerts[1].taskId, 't_freeze');
  assert.equal(alerts[1].urgency, 'heads_up');

  // Recently completed weather task should be suppressed during cooldown
  const alertsAfterDone = evaluateWeatherAlerts(
    forecast,
    tasks,
    [{ id: 'i_done', taskId: 't_rain', status: 'completed', completedAt: '2026-11-23T18:00:00Z' }],
    '2026-11-24',
  );
  assert.equal(alertsAfterDone.length, 1);
  assert.equal(alertsAfterDone[0].taskId, 't_freeze');
});

test('eligibility filtering, open_pool radar, and private exclusion from fairness work accurately', () => {
  // Adults only restriction excludes kid (m3)
  const { member: picked } = pickAssignee({
    task: { id: 't1', assignmentMode: 'round_robin', eligibleMemberIds: 'm1,m2', lastAssignedMemberId: 'm2' },
    members,
    instances: [],
    household,
    todayStr: '2026-11-24',
  });
  assert.equal(picked.id, 'm1');

  // Open pool leaves unassigned for radar
  const { member: openPicked } = pickAssignee({
    task: { id: 't2', assignmentMode: 'open_pool', eligibleMemberIds: 'm1,m2' },
    members,
    instances: [],
    household,
    todayStr: '2026-11-24',
  });
  assert.equal(openPicked, null);

  // Private tasks must NEVER count toward shared household fairness load
  const loads = computeMemberLoads(
    members,
    [
      { id: 'p1', visibility: 'private', assigneeId: 'm1', effort: 5, dueDate: '2026-11-24', status: 'pending' },
      { id: 's1', visibility: 'household', assigneeId: 'm2', effort: 3, dueDate: '2026-11-24', status: 'pending' },
    ],
    '2026-11-24',
  );
  assert.equal(loads.find((l) => l.memberId === 'm1').totalPoints, 0);
  assert.equal(loads.find((l) => l.memberId === 'm2').totalPoints, 3);
});

test('buildCategoryPathMap builds multi-level hierarchy breadcrumbs and rebalance reduces peak load', () => {
  const paths = buildCategoryPathMap([
    { id: 'c1', name: 'Home', parentCategoryId: '' },
    { id: 'c2', name: 'Exterior', parentCategoryId: 'c1' },
    { id: 'c3', name: 'Seasonal', parentCategoryId: 'c2' },
  ]);
  assert.equal(paths.get('c3'), 'Home > Exterior > Seasonal');

  const plan = computeRebalancePlan({
    household,
    members,
    tasks: [
      { id: 't1', assignmentMode: 'auto_balanced', eligibleMemberIds: 'm1,m2', visibility: 'household' },
      { id: 't2', assignmentMode: 'auto_balanced', eligibleMemberIds: 'm1,m2', visibility: 'household' },
    ],
    instances: [
      { id: 'a1', taskId: 't1', taskTitle: 'A', effort: 5, assigneeId: 'm1', assigneeName: 'Maya', dueDate: '2026-11-25', status: 'pending', visibility: 'household' },
      { id: 'a2', taskId: 't2', taskTitle: 'B', effort: 3, assigneeId: 'm1', assigneeName: 'Maya', dueDate: '2026-11-26', status: 'pending', visibility: 'household' },
    ],
    todayStr: '2026-11-24',
  });
  assert.equal(plan.changes.length, 1);
  assert.equal(plan.changes[0].toMemberId, 'm2');
});

test('computeHabitStats computes 7-day dots, preserves active streak before today is done, and increments on completion', () => {
  const habitTasks = [
    { id: 'h1', title: 'Skincare before bed', isHabit: true, active: true },
    { id: 'h2', title: 'Morning stretch', isHabit: true, active: true },
    { id: 't_reg', title: 'Regular task', isHabit: false, active: true },
  ];
  const instances = [
    // h1 completed 3 days ago, 2 days ago, and yesterday (not yet today -> streak 3, 3/7)
    { id: 'i1', taskId: 'h1', status: 'completed', dueDate: '2026-11-21', completedAt: '2026-11-21T22:00:00Z' },
    { id: 'i2', taskId: 'h1', status: 'completed', dueDate: '2026-11-22', completedAt: '2026-11-22T22:00:00Z' },
    { id: 'i3', taskId: 'h1', status: 'completed', dueDate: '2026-11-23', completedAt: '2026-11-23T22:00:00Z' },
    // h2 completed 5 days ago, skipped, then yesterday + today -> streak 2, best 2, 3/7
    { id: 'i4', taskId: 'h2', status: 'completed', dueDate: '2026-11-19', completedAt: '2026-11-19T08:00:00Z' },
    { id: 'i5', taskId: 'h2', status: 'completed', dueDate: '2026-11-23', completedAt: '2026-11-23T08:00:00Z' },
    { id: 'i6', taskId: 'h2', status: 'completed', dueDate: '2026-11-24', completedAt: '2026-11-24T08:00:00Z' },
  ];

  const stats = computeHabitStats(habitTasks, instances, '2026-11-24');
  assert.equal(stats.length, 2);

  const s1 = stats.find((s) => s.taskId === 'h1');
  assert.equal(s1.doneToday, false);
  assert.equal(s1.todayCompletedInstanceId, null);
  assert.equal(s1.currentStreak, 3);
  assert.equal(s1.bestStreak, 3);
  assert.equal(s1.completedLast7, 3);
  assert.equal(s1.last7Days.length, 7);
  assert.equal(s1.last7Days[6].isToday, true);
  assert.equal(s1.last7Days[6].done, false);

  const s2 = stats.find((s) => s.taskId === 'h2');
  assert.equal(s2.doneToday, true);
  assert.equal(s2.todayCompletedInstanceId, 'i6');
  assert.equal(s2.currentStreak, 2);
  assert.equal(s2.completedLast7, 3);
  assert.equal(s2.last7Days[6].done, true);
});
