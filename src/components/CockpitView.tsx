import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  BookmarkCheck,
  Check,
  CloudRain,
  Edit3,
  Flame,
  FolderKanban,
  Hand,
  Inbox,
  Lock,
  Moon,
  Plus,
  Repeat,
  SkipForward,
  SlidersHorizontal,
  Sparkles,
  Star,
  Sun,
  Sunrise,
  Zap,
} from 'lucide-react';
import type { DashboardData, HabitStat, Task, TaskInstance } from '../types';
import { CalendarDatePicker } from './CalendarDatePicker';
import { CategoryCombobox } from './CategoryCombobox';
import { DeferMenu } from './DeferMenu';
import {
  StatusBadge,
  StatusNotePopover,
  isOpenStatus,
  type ActiveStatus,
} from './StatusNotePopover';
import type { DetailTarget } from './TaskDetailModal';
import { buildCategoryOptions } from './TaskModal';

interface Props {
  data: DashboardData;
  busy: boolean;
  onQuickLog: (text: string, mode: 'complete_now' | 'add_inbox', visibility: 'household' | 'private') => Promise<void>;
  onLogAdHoc: (payload: {
    title: string;
    categoryId?: string;
    visibility: 'household' | 'private';
    date?: string;
    notes?: string;
  }) => Promise<void>;
  onQuickCompleteFavorite: (taskId: string) => Promise<void>;
  onCompleteInstance: (id: string, completed?: boolean) => Promise<void>;
  onClaimInstance: (id: string, unclaim?: boolean) => Promise<void>;
  onSkipInstance: (id: string) => Promise<void>;
  onDeferInstance: (id: string, payload: { days?: number; untilDate?: string }) => Promise<void>;
  onUpdateInstanceStatus: (
    id: string,
    payload: { status: ActiveStatus; notes: string; dueDate?: string },
  ) => Promise<void>;
  onAddTask: () => void;
  onAddHabit: () => void;
  onEditTask: (task: Task) => void;
  onEditAdHoc: (instance: TaskInstance) => void;
  onOpenDetail: (target: DetailTarget) => void;
  onCategoryCreated: () => Promise<void>;
  onOpenProjects: () => void;
}

function addDaysStr(dateStr: string, days: number) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days, 12));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

function diffDaysStr(aStr: string, bStr: string) {
  const [ay, am, ad] = aStr.split('-').map(Number);
  const [by, bm, bd] = bStr.split('-').map(Number);
  return Math.round((Date.UTC(ay, am - 1, ad, 12) - Date.UTC(by, bm - 1, bd, 12)) / 86_400_000);
}

function isEligibleForMe(inst: TaskInstance, userId: string) {
  if (inst.visibility === 'private') return inst.ownerId === userId;
  if (inst.assigneeId) return inst.assigneeId === userId;
  if (!inst.eligibleMemberIds) return true;
  return inst.eligibleMemberIds.split(',').includes(userId);
}

export function CockpitView({
  data,
  busy,
  onQuickLog,
  onLogAdHoc,
  onQuickCompleteFavorite,
  onCompleteInstance,
  onClaimInstance,
  onSkipInstance,
  onDeferInstance,
  onUpdateInstanceStatus,
  onAddTask,
  onAddHabit,
  onEditTask,
  onEditAdHoc,
  onOpenDetail,
  onCategoryCreated,
  onOpenProjects,
}: Props) {
  const [quickText, setQuickText] = useState('');
  const [quickPrivate, setQuickPrivate] = useState(false);
  const [quickCategoryId, setQuickCategoryId] = useState('');
  const [quickShowExtras, setQuickShowExtras] = useState(false);
  const [quickDate, setQuickDate] = useState(data.todayStr);
  const [quickNotes, setQuickNotes] = useState('');
  const [submittingQuick, setSubmittingQuick] = useState(false);

  const showEffort = Boolean(data.user.showEffortAndFairness);
  const projectMap = useMemo(() => new Map(data.projects.map((p) => [p.id, p])), [data.projects]);
  const memberMap = useMemo(() => new Map(data.members.map((m) => [m.id, m])), [data.members]);
  const taskMap = useMemo(() => new Map(data.tasks.map((t) => [t.id, t])), [data.tasks]);
  const quickCategoryOptions = useMemo(
    () =>
      buildCategoryOptions(data.categories).filter((c) =>
        quickPrivate ? c.visibility === 'private' : c.visibility !== 'private',
      ),
    [data.categories, quickPrivate],
  );

  const { habits, habitStatMap, overdue, inProgressOrWaiting, dueToday, openRadar, favorites, needsDetails, completedToday } = useMemo(() => {
    const cueOrder: Record<string, number> = { morning: 0, afternoon: 1, evening: 2, anytime: 3, '': 4 };
    const habitList = data.tasks
      .filter(
        (t) =>
          Boolean(t.isHabit) &&
          t.active !== false &&
          (t.visibility !== 'private' || t.ownerId === data.user.id),
      )
      .sort((a, b) => {
        const ca = cueOrder[a.routineCue || 'anytime'] ?? 4;
        const cb = cueOrder[b.routineCue || 'anytime'] ?? 4;
        if (ca !== cb) return ca - cb;
        return a.title.localeCompare(b.title);
      });
    const habitIds = new Set(habitList.map((h) => h.id));
    const statMap = new Map<string, HabitStat>((data.habitStats || []).map((s) => [s.taskId, s]));

    const open = data.instances.filter((i) => isOpenStatus(i.status));

    const trackedList = open.filter(
      (i) =>
        !habitIds.has(i.taskId) &&
        (i.status === 'started' || i.status === 'on_hold' || i.status === 'gated') &&
        isEligibleForMe(i, data.user.id),
    );
    const trackedIds = new Set(trackedList.map((i) => i.id));

    const overdueList = open.filter((i) => {
      if (habitIds.has(i.taskId) || trackedIds.has(i.id)) return false;
      const end = i.windowEndDate || i.dueDate;
      return Boolean(end) && end < data.todayStr && isEligibleForMe(i, data.user.id);
    });

    const dueTodayList = open.filter((i) => {
      if (habitIds.has(i.taskId)) return false;
      if (trackedIds.has(i.id)) return false;
      const end = i.windowEndDate || i.dueDate;
      if (!end || end < data.todayStr) return false;
      const isMine = i.assigneeId === data.user.id;
      const isToday = i.dueDate <= data.todayStr && (i.windowType === 'daily' || end === data.todayStr);
      return isMine && isToday;
    });

    const radarHorizon = addDaysStr(data.todayStr, 14);
    const openList = open
      .filter((i) => {
        if (habitIds.has(i.taskId)) return false;
        if (trackedIds.has(i.id)) return false;
        if (i.assigneeId) return false;
        if (i.assignmentMode !== 'open_pool') return false;
        if (!isEligibleForMe(i, data.user.id)) return false;
        const end = i.windowEndDate || i.dueDate;
        if (!end || end < data.todayStr) return false;
        if (i.triggerSource === 'weather') return true;
        if (end <= radarHorizon) return true;
        const spanDays = i.dueDate && end ? diffDaysStr(end, i.dueDate) : 0;
        return i.dueDate <= data.todayStr && spanDays <= 31;
      })
      .sort((a, b) =>
        (a.windowEndDate || a.dueDate || '').localeCompare(b.windowEndDate || b.dueDate || ''),
      );

    const favs = data.tasks.filter(
      (t) =>
        t.isFavorite &&
        !t.isHabit &&
        t.active !== false &&
        (t.visibility !== 'private' || t.ownerId === data.user.id),
    );

    const rough = data.tasks.filter((t) => t.needsDetails && t.active !== false);

    const doneToday = data.instances.filter((i) => {
      if (i.status !== 'completed') return false;
      if (i.dueDate === data.todayStr && (i.triggerSource === 'quick_log' || i.triggerSource === 'ad_hoc')) {
        return true;
      }
      if (!i.completedAt) return i.dueDate === data.todayStr;
      try {
        const parts = new Intl.DateTimeFormat('en-CA', {
          timeZone: data.household.timezone || undefined,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).formatToParts(new Date(i.completedAt));
        const y = parts.find((p) => p.type === 'year')?.value;
        const m = parts.find((p) => p.type === 'month')?.value;
        const d = parts.find((p) => p.type === 'day')?.value;
        if (y && m && d) return `${y}-${m}-${d}` === data.todayStr;
      } catch {
        // fallback
      }
      return String(i.completedAt).startsWith(data.todayStr);
    });

    return {
      habits: habitList,
      habitStatMap: statMap,
      overdue: overdueList,
      inProgressOrWaiting: trackedList,
      dueToday: dueTodayList,
      openRadar: openList,
      favorites: favs,
      needsDetails: rough,
      completedToday: doneToday,
    };
  }, [data.instances, data.tasks, data.habitStats, data.todayStr, data.user.id]);

  async function submitAdHoc() {
    if (!quickText.trim()) return;
    setSubmittingQuick(true);
    try {
      await onLogAdHoc({
        title: quickText.trim(),
        categoryId: quickCategoryId || undefined,
        visibility: quickPrivate ? 'private' : 'household',
        date: quickDate || data.todayStr,
        notes: quickNotes.trim() || undefined,
      });
      setQuickText('');
      setQuickNotes('');
      setQuickDate(data.todayStr);
      setQuickShowExtras(false);
    } finally {
      setSubmittingQuick(false);
    }
  }

  async function submitQuickInbox() {
    if (!quickText.trim()) return;
    setSubmittingQuick(true);
    try {
      await onQuickLog(quickText.trim(), 'add_inbox', quickPrivate ? 'private' : 'household');
      setQuickText('');
    } finally {
      setSubmittingQuick(false);
    }
  }

  function renderInstanceRow(inst: TaskInstance, isRadar = false) {
    const project = inst.projectId ? projectMap.get(inst.projectId) : null;
    const assignee = inst.assigneeId ? memberMap.get(inst.assigneeId) : null;
    const taskDef = inst.taskId ? taskMap.get(inst.taskId) : undefined;
    const isOneOff =
      Boolean(inst.projectId) ||
      (taskDef ? taskDef.cadenceMode !== 'weather_triggered' && taskDef.recurrenceType === 'once' : false);
    const isOverdue = (inst.windowEndDate || inst.dueDate) < data.todayStr;

    return (
      <div
        key={inst.id}
        className={`assignment-row ${isOverdue ? 'overdue' : ''} ${inst.visibility === 'private' ? 'private-row' : ''}`}
      >
        <button
          type="button"
          className="check-btn"
          onClick={() => onCompleteInstance(inst.id, true)}
          title="Mark complete"
        />

        <div
          className="assignment-main clickable-main"
          onClick={() => onOpenDetail({ instanceId: inst.id, taskId: inst.taskId || undefined })}
          title="Click to view details & update status"
        >
          <div className="assignment-title">
            <span className="clickable-title">{inst.taskTitle}</span>
            <StatusBadge status={inst.status} />
            {isOneOff ? (
              <span className="tag warning">One-off</span>
            ) : taskDef ? (
              <span className="tag primary">
                <Repeat size={10} /> {taskDef.cadenceMode === 'weather_triggered' ? 'Weather' : taskDef.recurrenceType}
              </span>
            ) : null}
            {inst.visibility === 'private' && (
              <span className="tag private">
                <Lock size={11} /> Private
              </span>
            )}
            {project && (
              <span
                className="tag info"
                style={{ cursor: 'pointer' }}
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenProjects();
                }}
              >
                <FolderKanban size={11} /> {project.title}
              </span>
            )}
            {inst.weatherUrgency === 'urgent' && <span className="tag accent">Weather Urgent</span>}
            {inst.weatherUrgency === 'heads_up' && <span className="tag info">Weather Heads-Up</span>}
            {showEffort && (
              <span className={`tag effort-${inst.effort}`}>
                {inst.effort} {inst.effort === 1 ? 'pt' : 'pts'}
              </span>
            )}
          </div>
          {inst.notes && <div className="instance-note">{inst.notes}</div>}
          <div className="assignment-meta">
            <span>{inst.categoryPath}</span>
            <span>&middot;</span>
            <span style={{ color: isOverdue ? 'var(--accent)' : undefined, fontWeight: isOverdue ? 600 : 400 }}>
              {inst.windowEndDate && inst.windowEndDate !== inst.dueDate
                ? `Window: through ${inst.windowEndDate}`
                : inst.dueDate === data.todayStr
                  ? 'Due today'
                  : `Due ${inst.dueDate}`}
            </span>
            {inst.reason && <span>&middot; {inst.reason}</span>}
          </div>
        </div>

        <div className="cockpit-controls">
          <div className="slot-end">
            {isRadar && !inst.assigneeId ? (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => onClaimInstance(inst.id, false)}
              >
                <Hand size={13} /> Claim
              </button>
            ) : assignee ? (
              <span className="tag" title={`Assigned to ${assignee.name}`}>
                {assignee.name.split(' ')[0]}
              </span>
            ) : null}
          </div>

          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => onCompleteInstance(inst.id, true)}
          >
            <Check size={14} /> Done
          </button>

          <div>
            {taskMap.has(inst.taskId) && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => onEditTask(taskMap.get(inst.taskId)!)}
                title="Edit task"
              >
                <Edit3 size={14} />
              </button>
            )}
          </div>

          <StatusNotePopover
            instance={inst}
            onSave={(payload) => onUpdateInstanceStatus(inst.id, payload)}
          />

          <DeferMenu
            minDate={data.todayStr}
            onDefer={(payload) => onDeferInstance(inst.id, payload)}
          />

          <div>
            {inst.overduePolicy !== 'carry_over' && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => onSkipInstance(inst.id)}
                title="Skip this occurrence"
              >
                <SkipForward size={14} /> Skip
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Daily Cockpit</h1>
          <p className="page-subtitle">
            {data.household.name} &middot; {data.todayStr}
            {data.weather.locationName ? ` · ${data.weather.locationName}` : ''}
          </p>
        </div>
        <div className="header-actions">
          <button type="button" className="btn btn-primary" onClick={onAddTask}>
            <Plus size={16} /> New Task
          </button>
        </div>
      </div>

      {/* Free-Form Ad-Hoc Record & Quick-Capture Bar */}
      <div className="quick-capture">
        <div className="quick-capture-row">
          <Zap size={18} style={{ color: 'var(--primary)', flexShrink: 0 }} />
          <input
            className="quick-capture-input"
            placeholder="Hey, I did this (keep a record) — or drop a rough task into Inbox..."
            value={quickText}
            onChange={(e) => setQuickText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && quickText.trim()) {
                e.preventDefault();
                submitAdHoc();
              }
            }}
          />
          <div style={{ width: 190 }}>
            <CategoryCombobox
              categories={data.categories}
              value={quickCategoryId}
              onChange={setQuickCategoryId}
              visibility={quickPrivate ? 'private' : 'household'}
              onCategoryCreated={onCategoryCreated}
              placeholder="Category (optional)"
              emptyLabel="No category"
              compact
            />
          </div>
          <button
            type="button"
            className={`pill ${quickPrivate ? 'active' : ''}`}
            onClick={() => {
              setQuickPrivate((p) => !p);
              setQuickCategoryId('');
            }}
            title="Store in your Personal Private Sheet"
          >
            <Lock size={12} /> {quickPrivate ? 'Private' : 'Shared'}
          </button>
          <button
            type="button"
            className={`btn btn-ghost btn-sm ${quickShowExtras ? 'active' : ''}`}
            onClick={() => setQuickShowExtras((v) => !v)}
            title="Optional date & notes"
          >
            <SlidersHorizontal size={13} /> Date / Notes
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={!quickText.trim() || submittingQuick}
            onClick={submitQuickInbox}
          >
            <Inbox size={14} /> Add to Inbox
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={!quickText.trim() || submittingQuick}
            onClick={submitAdHoc}
            title="Log a completed record without creating a recurring task"
          >
            <BookmarkCheck size={14} /> Log Ad-Hoc
          </button>
        </div>

        {quickShowExtras && (
          <div
            style={{
              display: 'flex',
              gap: 10,
              marginTop: 10,
              paddingTop: 10,
              borderTop: '1px solid var(--border)',
              flexWrap: 'wrap',
              alignItems: 'center',
            }}
          >
            <div style={{ width: 170 }}>
              <CalendarDatePicker
                value={quickDate}
                onChange={setQuickDate}
                placeholder="Date done"
                compact
              />
            </div>
            <input
              className="input"
              style={{ flex: 1, minWidth: 200, padding: '7px 10px', fontSize: '0.86rem' }}
              placeholder="Optional notes (e.g., filter size, vendor name, cost, part number)..."
              value={quickNotes}
              onChange={(e) => setQuickNotes(e.target.value)}
            />
          </div>
        )}
      </div>

      {/* Two-Tier Weather Forecast Alerts (1-3d Urgent vs 4-10d Gentle Heads-Up) */}
      {data.weather.alerts.length > 0 && (
        <div className="weather-strip">
          {data.weather.alerts.map((alert) => (
            <div key={alert.taskId} className={`weather-alert-card ${alert.urgency}`}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                <CloudRain size={20} style={{ flexShrink: 0 }} />
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.94rem' }}>
                    {alert.urgency === 'urgent' ? 'Urgent Weather (1–3d): ' : 'Gentle Heads-Up (4–10d): '}
                    {alert.taskTitle}
                  </div>
                  <div style={{ fontSize: '0.82rem', opacity: 0.9 }}>{alert.summary}</div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {alert.existingInstanceId && (
                  <button
                    type="button"
                    className={`btn btn-sm ${alert.urgency === 'urgent' ? 'btn-accent' : 'btn-secondary'}`}
                    onClick={() => onCompleteInstance(alert.existingInstanceId!, true)}
                  >
                    <Check size={14} /> Mark Done
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Daily Habits Check-In Strip (7-day consistency + streaks, auto-skips if missed) */}
      <div className="agenda-section">
        <div className="section-heading" style={{ justifyContent: 'space-between' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <Flame size={14} style={{ color: '#c86d51' }} />
            <span>Habits</span>
            {habits.length > 0 && (
              <span className="tag primary">
                {habits.filter((h) => {
                  const s = habitStatMap.get(h.id);
                  return Boolean(s?.doneToday || s?.weeklyGoalMet);
                }).length}{' '}
                / {habits.length} on track
              </span>
            )}
          </span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onAddHabit}>
            <Plus size={13} /> Add Habit
          </button>
        </div>

        {habits.length === 0 ? (
          <div
            className="card"
            style={{
              padding: '13px 16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <span style={{ color: 'var(--text-muted)', fontSize: '0.86rem' }}>
              Build personal daily routines (e.g., skincare before bed, stretching) — auto-skips if missed and tracks your 7-day consistency.
            </span>
            <button type="button" className="btn btn-secondary btn-sm" onClick={onAddHabit}>
              <Flame size={13} /> New Habit
            </button>
          </div>
        ) : (
          <div className="habits-grid">
            {habits.map((h) => {
              const stat = habitStatMap.get(h.id);
              const doneToday = Boolean(stat?.doneToday);
              const streak = stat?.currentStreak || 0;
              const streakUnit = stat?.streakUnit === 'weeks' ? 'w' : 'd';
              const targetPerWeek =
                stat?.targetPerWeek ||
                (h.recurrenceType === 'times_per_week' ? Math.max(1, h.recurrenceInterval || 3) : 0);
              const completedThisWeek = stat?.completedThisWeek || 0;
              const weeklyGoalMet = Boolean(stat?.weeklyGoalMet);
              const completedLast7 = stat?.completedLast7 || 0;
              const last7 = stat?.last7Days || [];
              const cue = h.routineCue || 'anytime';
              const cueLabel =
                cue === 'morning'
                  ? 'Morning'
                  : cue === 'afternoon'
                    ? 'Afternoon'
                    : cue === 'evening'
                      ? 'Evening'
                      : 'Anytime';
              const CueIcon =
                cue === 'morning'
                  ? Sunrise
                  : cue === 'afternoon'
                    ? Sun
                    : cue === 'evening'
                      ? Moon
                      : Sparkles;

              return (
                <div key={h.id} className={`habit-card ${doneToday || weeklyGoalMet ? 'done-today' : ''}`}>
                  <div className="habit-card-top">
                    <button
                      type="button"
                      className={`check-btn ${doneToday ? 'checked' : ''}`}
                      disabled={busy}
                      onClick={() => {
                        if (doneToday && stat?.todayCompletedInstanceId) {
                          onCompleteInstance(stat.todayCompletedInstanceId, false);
                        } else {
                          onQuickCompleteFavorite(h.id);
                        }
                      }}
                      title={doneToday ? 'Undo today’s check-in' : `Check off "${h.title}" for today`}
                    >
                      {doneToday && <Check size={14} strokeWidth={3} />}
                    </button>

                    <div
                      style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}
                      onClick={() => onOpenDetail({ taskId: h.id })}
                      title="Click to view habit details & history"
                    >
                      <div className="habit-card-title clickable-title">{h.title}</div>
                      <div className="habit-card-sub">
                        <span className="habit-cue-pill">
                          <CueIcon size={11} /> {cueLabel}
                        </span>
                        {targetPerWeek > 0 && (
                          <span className="habit-cue-pill" title={`Weekly goal: ${targetPerWeek}x per week`}>
                            {targetPerWeek}x / wk
                          </span>
                        )}
                        {h.visibility === 'private' && (
                          <span className="habit-cue-pill" title="Private (Personal Sheet)">
                            <Lock size={10} /> Private
                          </span>
                        )}
                      </div>
                    </div>

                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      style={{ padding: 4 }}
                      onClick={() => onEditTask(h)}
                      title="Edit habit"
                    >
                      <Edit3 size={13} />
                    </button>
                  </div>

                  <div className="habit-card-foot">
                    <div className="habit-dots" aria-label={`${completedLast7} of last 7 days completed`}>
                      {last7.map((pt) => (
                        <span
                          key={pt.date}
                          className={`habit-dot ${pt.done ? 'done' : ''} ${pt.isToday ? 'today' : ''}`}
                          title={`${pt.weekday} (${pt.date}): ${pt.done ? 'Done' : pt.isToday ? 'Today' : 'Rest / Missed'}`}
                        >
                          {pt.weekday.charAt(0)}
                        </span>
                      ))}
                    </div>
                    <div className="habit-stats-meta">
                      {targetPerWeek > 0 ? (
                        <span
                          className="habit-rate"
                          style={weeklyGoalMet ? { color: 'var(--primary)', fontWeight: 700 } : undefined}
                          title={`${completedThisWeek} of ${targetPerWeek} completed this week (Mon–Sun)`}
                        >
                          {completedThisWeek}/{targetPerWeek} wk{weeklyGoalMet ? ' ✓' : ''}
                        </span>
                      ) : (
                        <span className="habit-rate">{completedLast7}/7</span>
                      )}
                      {streak > 0 && (
                        <span
                          className="habit-streak-pill"
                          title={
                            streakUnit === 'w'
                              ? `Current streak: ${streak} week${streak === 1 ? '' : 's'} hitting ${targetPerWeek}x/wk${stat?.bestStreak && stat.bestStreak > streak ? ` (Best: ${stat.bestStreak}w)` : ''}`
                              : `Current streak: ${streak} day${streak === 1 ? '' : 's'}${stat?.bestStreak && stat.bestStreak > streak ? ` (Best: ${stat.bestStreak}d)` : ''}`
                          }
                        >
                          <Flame size={11} /> {streak}
                          {streakUnit}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Pinned / Favorited 1-Tap Buttons */}
      {favorites.length > 0 && (
        <div className="agenda-section">
          <div className="section-heading">
            <Star size={14} /> 1-Tap Favorites
          </div>
          <div className="favorites-grid">
            {favorites.map((t) => {
              const doneTodayInst = completedToday.find((i) => i.taskId === t.id);
              const isDoneToday = Boolean(doneTodayInst);
              return (
                <button
                  key={t.id}
                  type="button"
                  className={`fav-btn ${isDoneToday ? 'done-today' : ''}`}
                  disabled={busy || isDoneToday}
                  onClick={() => onQuickCompleteFavorite(t.id)}
                  title={
                    isDoneToday
                      ? 'Already completed today (undo under Completed Today if needed)'
                      : `Mark "${t.title}" complete`
                  }
                >
                  <span className={`fav-icon ${isDoneToday ? 'done' : ''}`}>
                    <Check size={16} strokeWidth={isDoneToday ? 3 : 2} />
                  </span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div
                      style={{
                        fontWeight: 600,
                        fontSize: '0.88rem',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        textDecoration: isDoneToday ? 'line-through' : undefined,
                        color: isDoneToday ? 'var(--text-muted)' : undefined,
                      }}
                    >
                      {t.title}
                    </div>
                    <div
                      style={{
                        fontSize: '0.74rem',
                        color: isDoneToday ? 'var(--primary)' : 'var(--text-muted)',
                        display: 'flex',
                        gap: 6,
                        alignItems: 'center',
                      }}
                    >
                      <span>{isDoneToday ? 'Done today · resets tomorrow' : 'Tap to mark done'}</span>
                      {t.visibility === 'private' && <Lock size={11} />}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Overdue (Must-Complete carry_over tasks) */}
      {overdue.length > 0 && (
        <div className="agenda-section">
          <div className="section-heading overdue">
            <AlertTriangle size={14} /> Overdue ({overdue.length})
          </div>
          <div className="chore-list">{overdue.map((i) => renderInstanceRow(i, !i.assigneeId))}</div>
        </div>
      )}

      {/* Started / On Hold / Gated (Multi-step non-atomic tasks in progress or waiting) */}
      {inProgressOrWaiting.length > 0 && (
        <div className="agenda-section">
          <div className="section-heading">
            <span>In Progress &amp; Waiting (Started / On Hold / Gated)</span>
            <span className="tag info">{inProgressOrWaiting.length}</span>
          </div>
          <div className="chore-list">
            {inProgressOrWaiting.map((i) => renderInstanceRow(i, !i.assigneeId))}
          </div>
        </div>
      )}

      {/* Due Today */}
      <div className="agenda-section">
        <div className="section-heading today">
          <span>Your Tasks Today</span>
          <span className="tag primary">{dueToday.length}</span>
        </div>
        {dueToday.length === 0 ? (
          <div className="card" style={{ padding: '18px 20px', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            All personal &amp; assigned tasks for today are clear! Check Open for Anyone below or tap a Favorite above.
          </div>
        ) : (
          <div className="chore-list">{dueToday.map((i) => renderInstanceRow(i, false))}</div>
        )}
      </div>

      {/* Anyone (Visible to all eligible household members) */}
      {openRadar.length > 0 && (
        <div className="agenda-section">
          <div className="section-heading">
            <span>Anyone (Claim or Complete)</span>
            <span className="tag">{openRadar.length}</span>
          </div>
          <div className="chore-list">{openRadar.map((i) => renderInstanceRow(i, true))}</div>
        </div>
      )}

      {/* Needs Details Triage */}
      {needsDetails.length > 0 && (
        <div className="agenda-section">
          <div className="section-heading">
            <Inbox size={14} /> Needs Details ({needsDetails.length})
          </div>
          <div className="chore-list">
            {needsDetails.map((t) => (
              <div key={t.id} className="assignment-row">
                <div
                  className="assignment-main clickable-main"
                  onClick={() => onOpenDetail({ taskId: t.id })}
                  title="Click to view details"
                >
                  <div className="assignment-title">
                    <span className="clickable-title">{t.title}</span>
                    <span className="tag warning">Needs details</span>
                    {t.visibility === 'private' && (
                      <span className="tag private">
                        <Lock size={11} /> Private
                      </span>
                    )}
                  </div>
                  <div className="assignment-meta">
                    Captured via quick-log — assign a category, recurrence, or overdue rule anytime.
                  </div>
                </div>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => onEditTask(t)}>
                  Fill Details
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Completed Today */}
      {completedToday.length > 0 && (
        <div className="agenda-section">
          <div className="section-heading">
            <span>Completed Today</span>
            <span className="tag primary">{completedToday.length}</span>
          </div>
          <div className="chore-list">
            {completedToday.map((inst) => (
              <div key={inst.id} className="assignment-row completed">
                <button
                  type="button"
                  className="check-btn checked"
                  onClick={() => onCompleteInstance(inst.id, false)}
                  title="Undo completion"
                >
                  <Check size={14} strokeWidth={3} />
                </button>
                <div
                  className="assignment-main clickable-main"
                  onClick={() => onOpenDetail({ instanceId: inst.id, taskId: inst.taskId || undefined })}
                  title="Click to view details & update status"
                >
                  <div className="assignment-title">
                    <span className="clickable-title">{inst.taskTitle}</span>
                    {inst.triggerSource === 'ad_hoc' && <span className="tag primary">Ad-hoc</span>}
                    {inst.visibility === 'private' && (
                      <span className="tag private">
                        <Lock size={11} /> Private
                      </span>
                    )}
                  </div>
                  <div className="assignment-meta">
                    Done by {inst.completedBy || 'Member'} &middot; {inst.categoryPath}
                    {inst.notes && <span>&middot; {inst.notes}</span>}
                  </div>
                </div>
                {inst.triggerSource === 'ad_hoc' ? (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => onEditAdHoc(inst)}
                    title="Edit ad-hoc record"
                  >
                    <Edit3 size={14} /> Edit
                  </button>
                ) : taskMap.has(inst.taskId) ? (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => onEditTask(taskMap.get(inst.taskId)!)}
                    title="Edit task"
                  >
                    <Edit3 size={14} />
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
