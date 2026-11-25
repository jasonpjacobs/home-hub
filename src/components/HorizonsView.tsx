import React, { useMemo, useState } from 'react';
import {
  CalendarPlus,
  Check,
  Edit3,
  FolderKanban,
  Hand,
  LayoutGrid,
  LayoutList,
  Lock,
  Plus,
  Repeat,
  Search,
  SkipForward,
  Trash2,
} from 'lucide-react';
import type { DashboardData, Task, TaskInstance } from '../types';
import { DeferMenu } from './DeferMenu';
import {
  StatusBadge,
  StatusNotePopover,
  isOpenStatus,
  type ActiveStatus,
} from './StatusNotePopover';
import type { DetailTarget } from './TaskDetailModal';

type HorizonKey = 'weekly' | 'monthly' | 'quarterly' | 'seasonal' | 'yearly' | 'all' | 'history';

interface Props {
  data: DashboardData;
  busy: boolean;
  onGenerateSchedule: () => Promise<void>;
  onAddTask: () => void;
  onEditTask: (task: Task) => void;
  onEditAdHoc: (instance: TaskInstance) => void;
  onOpenDetail: (target: DetailTarget) => void;
  onComplete: (id: string, completed?: boolean) => Promise<void>;
  onClaim: (id: string, unclaim?: boolean) => Promise<void>;
  onSkip: (id: string) => Promise<void>;
  onDefer: (id: string, payload: { days?: number; untilDate?: string }) => Promise<void>;
  onUpdateStatus: (
    id: string,
    payload: { status: ActiveStatus; notes: string; dueDate?: string },
  ) => Promise<void>;
  onReassign: (id: string, assigneeId: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

function addDaysStr(dateStr: string, days: number) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days, 12));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

function parseUTC(dateStr: string) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

function formatDayLabel(dateStr: string, todayStr: string) {
  const tomorrowStr = addDaysStr(todayStr, 1);
  const yesterdayStr = addDaysStr(todayStr, -1);
  const formatted = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(parseUTC(dateStr));
  if (dateStr === todayStr) return `Today · ${formatted}`;
  if (dateStr === tomorrowStr) return `Tomorrow · ${formatted}`;
  if (dateStr === yesterdayStr) return `Yesterday · ${formatted}`;
  return formatted;
}

function getWeekStartISO(dateStr: string) {
  const dt = parseUTC(dateStr);
  const dow = dt.getUTCDay();
  const offset = dow === 0 ? -6 : 1 - dow;
  return addDaysStr(dateStr, offset);
}

function formatWeekLabel(weekStartStr: string, todayWeekStartStr: string) {
  const weekEndStr = addDaysStr(weekStartStr, 6);
  const fmt = (s: string) =>
    new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(
      parseUTC(s),
    );
  const range = `${fmt(weekStartStr)} – ${fmt(weekEndStr)}`;
  if (weekStartStr === todayWeekStartStr) return `This Week · ${range}`;
  if (weekStartStr === addDaysStr(todayWeekStartStr, 7)) return `Next Week · ${range}`;
  return `Week of ${range}`;
}

function formatMonthLabel(dateStr: string, todayStr: string) {
  const dt = parseUTC(dateStr);
  const label = new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(dt);
  return dateStr.slice(0, 7) === todayStr.slice(0, 7) ? `This Month · ${label}` : label;
}

export function HorizonsView({
  data,
  busy,
  onGenerateSchedule,
  onAddTask,
  onEditTask,
  onEditAdHoc,
  onOpenDetail,
  onComplete,
  onClaim,
  onSkip,
  onDefer,
  onUpdateStatus,
  onReassign,
  onDelete,
}: Props) {
  const [horizon, setHorizon] = useState<HorizonKey>('weekly');
  const [memberFilter, setMemberFilter] = useState<string>('all');
  const [showDone, setShowDone] = useState(false);
  const [historyQuery, setHistoryQuery] = useState('');
  const [layoutMode, setLayoutMode] = useState<'list' | 'grid'>(() => {
    try {
      return window.localStorage.getItem('homehub_horizon_layout') === 'grid' ? 'grid' : 'list';
    } catch {
      return 'list';
    }
  });

  function switchLayout(next: 'list' | 'grid') {
    setLayoutMode(next);
    try {
      window.localStorage.setItem('homehub_horizon_layout', next);
    } catch {
      // ignore
    }
  }

  const showEffort = Boolean(data.user.showEffortAndFairness);
  const projectMap = useMemo(() => new Map(data.projects.map((p) => [p.id, p])), [data.projects]);
  const taskMap = useMemo(() => new Map(data.tasks.map((t) => [t.id, t])), [data.tasks]);

  const weekLimit = addDaysStr(data.todayStr, 7);
  const monthLimit = addDaysStr(data.todayStr, 31);
  const quarterLimit = addDaysStr(data.todayStr, 95);

  const items = useMemo(() => {
    const q = historyQuery.trim().toLowerCase();
    const list = data.instances.filter((i) => {
      if (horizon === 'history') {
        if (i.status !== 'completed') return false;
      } else if (!showDone && !isOpenStatus(i.status)) {
        return false;
      }
      if (memberFilter === 'mine' && i.assigneeId !== data.user.id) return false;
      if (memberFilter === 'private' && i.visibility !== 'private') return false;
      if (
        memberFilter !== 'all' &&
        memberFilter !== 'mine' &&
        memberFilter !== 'private' &&
        i.assigneeId !== memberFilter
      ) {
        return false;
      }

      if (horizon === 'history') {
        if (
          q &&
          !`${i.taskTitle} ${i.categoryPath} ${i.notes} ${i.completedBy}`
            .toLowerCase()
            .includes(q)
        ) {
          return false;
        }
        return true;
      }
      if (horizon === 'weekly') {
        return i.windowType === 'weekly' || i.windowType === 'biweekly' || i.dueDate <= weekLimit;
      }
      if (horizon === 'monthly') {
        return i.windowType === 'monthly' || (i.dueDate <= monthLimit && i.windowType !== 'yearly');
      }
      if (horizon === 'quarterly') {
        return (
          i.windowType === 'quarterly' ||
          i.windowType === 'custom_months' ||
          (i.dueDate <= quarterLimit && i.windowType !== 'daily')
        );
      }
      if (horizon === 'seasonal') {
        return i.windowType === 'seasonal' || i.triggerSource === 'weather';
      }
      if (horizon === 'yearly') {
        return (
          i.windowType === 'yearly' ||
          i.windowType === 'seasonal' ||
          i.windowType === 'quarterly' ||
          i.windowType === 'custom_months'
        );
      }
      return true;
    });
    if (horizon === 'history') {
      return [...list].sort((a, b) =>
        String(b.completedAt || b.dueDate).localeCompare(String(a.completedAt || a.dueDate)),
      );
    }
    return list;
  }, [
    data.instances,
    data.user.id,
    horizon,
    memberFilter,
    showDone,
    historyQuery,
    weekLimit,
    monthLimit,
    quarterLimit,
  ]);

  const horizonTabs: Array<{ key: HorizonKey; label: string }> = [
    { key: 'weekly', label: 'Weekly' },
    { key: 'monthly', label: 'Monthly' },
    { key: 'quarterly', label: 'Quarterly' },
    { key: 'seasonal', label: 'Seasonal & Weather' },
    { key: 'yearly', label: 'Yearly' },
    { key: 'all', label: 'All Scheduled' },
    { key: 'history', label: 'History & Ad-Hoc Log' },
  ];

  // Group items by day / week / month / season for horizontal demarcation lines
  const groupedSections = useMemo(() => {
    const todayWeekStart = getWeekStartISO(data.todayStr);
    const map = new Map<
      string,
      { key: string; label: string; tone: 'overdue' | 'current' | 'normal'; sortKey: string; items: typeof items }
    >();

    const addToGroup = (
      key: string,
      label: string,
      tone: 'overdue' | 'current' | 'normal',
      sortKey: string,
      inst: (typeof items)[number],
    ) => {
      let g = map.get(key);
      if (!g) {
        g = { key, label, tone, sortKey, items: [] };
        map.set(key, g);
      }
      g.items.push(inst);
    };

    for (const inst of items) {
      const end = inst.windowEndDate || inst.dueDate;
      const isOverdue =
        (inst.status === 'pending' || inst.status === 'started') && end < data.todayStr;

      if (horizon === 'history') {
        const doneDate = (inst.completedAt || inst.dueDate || data.todayStr).slice(0, 10);
        if (doneDate === data.todayStr || doneDate === addDaysStr(data.todayStr, -1)) {
          addToGroup(
            `hday_${doneDate}`,
            formatDayLabel(doneDate, data.todayStr),
            doneDate === data.todayStr ? 'current' : 'normal',
            doneDate,
            inst,
          );
        } else {
          const ym = doneDate.slice(0, 7);
          addToGroup(`hmo_${ym}`, formatMonthLabel(`${ym}-01`, data.todayStr), 'normal', `${ym}-00`, inst);
        }
        continue;
      }

      if (isOverdue) {
        addToGroup('00_overdue', 'Overdue', 'overdue', '0000-00-00', inst);
        continue;
      }

      if (horizon === 'weekly') {
        if (inst.windowType === 'weekly' || inst.windowType === 'biweekly') {
          addToGroup(
            `wflex_${inst.windowEndDate || inst.dueDate}`,
            `Flexible This Week · through ${inst.windowEndDate || inst.dueDate}`,
            'current',
            '9999-01-01',
            inst,
          );
        } else {
          const d = inst.dueDate || data.todayStr;
          addToGroup(
            `day_${d}`,
            formatDayLabel(d, data.todayStr),
            d === data.todayStr ? 'current' : 'normal',
            d,
            inst,
          );
        }
      } else if (horizon === 'monthly') {
        if (inst.windowType === 'monthly') {
          const ym = (inst.dueDate || data.todayStr).slice(0, 7);
          addToGroup(
            `mflex_${ym}`,
            `Flexible ${formatMonthLabel(`${ym}-01`, data.todayStr)}`,
            ym === data.todayStr.slice(0, 7) ? 'current' : 'normal',
            `${ym}-99`,
            inst,
          );
        } else {
          const ws = getWeekStartISO(inst.dueDate || data.todayStr);
          addToGroup(
            `wk_${ws}`,
            formatWeekLabel(ws, todayWeekStart),
            ws === todayWeekStart ? 'current' : 'normal',
            ws,
            inst,
          );
        }
      } else if (horizon === 'seasonal') {
        if (inst.triggerSource === 'weather') {
          addToGroup(
            '01_weather',
            'Weather Forecast Triggers',
            inst.weatherUrgency === 'urgent' ? 'overdue' : 'current',
            '0001-00-00',
            inst,
          );
        } else {
          const ym = (inst.windowEndDate || inst.dueDate || data.todayStr).slice(0, 7);
          addToGroup(
            `smo_${ym}`,
            `Seasonal Window · Ends ${formatMonthLabel(`${ym}-01`, data.todayStr)}`,
            'normal',
            ym,
            inst,
          );
        }
      } else {
        // Quarterly, Yearly, All Scheduled -> group cleanly by Month
        const anchor = inst.dueDate || data.todayStr;
        const ym = anchor.slice(0, 7);
        addToGroup(
          `mo_${ym}`,
          formatMonthLabel(`${ym}-01`, data.todayStr),
          ym === data.todayStr.slice(0, 7) ? 'current' : 'normal',
          ym,
          inst,
        );
      }
    }

    const groups = Array.from(map.values());
    if (horizon === 'history') {
      groups.sort((a, b) => b.sortKey.localeCompare(a.sortKey));
    } else {
      groups.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
    }
    return groups;
  }, [items, horizon, data.todayStr]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Horizons Planner</h1>
          <p className="page-subtitle">
            View strict due dates alongside flexible Weekly, Monthly, Quarterly, Seasonal, and
            Yearly windows.
          </p>
        </div>
        <div className="header-actions">
          <button type="button" className="btn btn-secondary" onClick={onGenerateSchedule} disabled={busy}>
            <CalendarPlus size={16} /> Fill Next 14 Days
          </button>
          <button type="button" className="btn btn-primary" onClick={onAddTask}>
            <Plus size={16} /> New Task
          </button>
        </div>
      </div>

      <div className="tabs-bar">
        {horizonTabs.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`tab-btn ${horizon === t.key ? 'active' : ''}`}
            onClick={() => setHorizon(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="filter-bar">
        <div className="pill-group">
          <button
            type="button"
            className={`pill ${memberFilter === 'all' ? 'active' : ''}`}
            onClick={() => setMemberFilter('all')}
          >
            Everyone
          </button>
          <button
            type="button"
            className={`pill ${memberFilter === 'mine' ? 'active' : ''}`}
            onClick={() => setMemberFilter('mine')}
          >
            Assigned to Me
          </button>
          <button
            type="button"
            className={`pill ${memberFilter === 'private' ? 'active' : ''}`}
            onClick={() => setMemberFilter('private')}
          >
            <Lock size={12} /> Private Only
          </button>
          {data.members.map((m) => (
            <button
              key={m.id}
              type="button"
              className={`pill ${memberFilter === m.id ? 'active' : ''}`}
              onClick={() => setMemberFilter(m.id)}
            >
              {m.name.split(' ')[0]}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {horizon === 'history' ? (
            <div style={{ position: 'relative', minWidth: 230 }}>
              <Search
                size={14}
                style={{
                  position: 'absolute',
                  left: 10,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--text-muted)',
                }}
              />
              <input
                className="input"
                style={{ padding: '6px 10px 6px 30px', fontSize: '0.84rem' }}
                placeholder="Search completed & ad-hoc log..."
                value={historyQuery}
                onChange={(e) => setHistoryQuery(e.target.value)}
              />
            </div>
          ) : (
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.84rem', color: 'var(--text-muted)' }}>
              <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
              Include completed &amp; skipped
            </label>
          )}

          <div className="view-toggle" role="group" aria-label="Layout view">
            <button
              type="button"
              className={layoutMode === 'list' ? 'active' : ''}
              onClick={() => switchLayout('list')}
            >
              <LayoutList size={14} /> List
            </button>
            <button
              type="button"
              className={layoutMode === 'grid' ? 'active' : ''}
              onClick={() => switchLayout('grid')}
            >
              <LayoutGrid size={14} /> Grid
            </button>
          </div>
        </div>
      </div>

      {groupedSections.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
          No tasks in this horizon right now.
        </div>
      ) : (
        <div>
          {groupedSections.map((group) => (
            <div key={group.key} className="horizon-group">
              <div className={`horizon-divider ${group.tone}`}>
                <span className="horizon-divider-label">
                  <span>{group.label}</span>
                  <span className={`tag ${group.tone === 'overdue' ? 'accent' : group.tone === 'current' ? 'primary' : ''}`}>
                    {group.items.length}
                  </span>
                </span>
                <span className="horizon-divider-line" />
              </div>

              <div className={layoutMode === 'grid' ? 'horizon-card-grid' : 'chore-list'}>
                {group.items.map((inst) => {
                  const isDone = inst.status === 'completed';
                  const isOverdue = !isDone && isOpenStatus(inst.status) && inst.status !== 'on_hold' && inst.status !== 'gated' && (inst.windowEndDate || inst.dueDate) < data.todayStr;
                  const proj = inst.projectId ? projectMap.get(inst.projectId) : null;
                  const taskDef = inst.taskId ? taskMap.get(inst.taskId) : undefined;
                  const isOneOff =
                    inst.triggerSource !== 'ad_hoc' &&
                    (Boolean(inst.projectId) ||
                      (taskDef ? taskDef.cadenceMode !== 'weather_triggered' && taskDef.recurrenceType === 'once' : false));

                  if (layoutMode === 'grid') {
                    return (
                      <div
                        key={inst.id}
                        className={`horizon-card ${isOverdue ? 'overdue' : ''} ${inst.visibility === 'private' ? 'private-row' : ''} ${isDone ? 'completed' : ''}`}
                      >
                        <div className="horizon-card-head">
                          <button
                            type="button"
                            className={`check-btn ${isDone ? 'checked' : ''}`}
                            onClick={() => onComplete(inst.id, !isDone)}
                          >
                            {isDone && <Check size={14} strokeWidth={3} />}
                          </button>
                          <div
                            className="clickable-main"
                            style={{ flex: 1, minWidth: 0 }}
                            onClick={() => onOpenDetail({ instanceId: inst.id, taskId: inst.taskId || undefined })}
                            title="Click to view details & update status"
                          >
                            <div
                              className="clickable-title"
                              style={{
                                fontWeight: 600,
                                fontSize: '0.95rem',
                                textDecoration: isDone ? 'line-through' : undefined,
                                color: isDone ? 'var(--text-muted)' : undefined,
                              }}
                            >
                              {inst.taskTitle}
                            </div>
                            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 6 }}>
                              <StatusBadge status={inst.status} />
                              {inst.triggerSource === 'ad_hoc' ? (
                                <span className="tag info">Ad-hoc</span>
                              ) : isOneOff ? (
                                <span className="tag warning">One-off</span>
                              ) : (
                                <span className="tag primary">
                                  <Repeat size={10} /> {inst.windowType}
                                </span>
                              )}
                              {inst.visibility === 'private' && (
                                <span className="tag private">
                                  <Lock size={11} /> Private
                                </span>
                              )}
                              {proj && (
                                <span className="tag info">
                                  <FolderKanban size={11} /> {proj.title}
                                </span>
                              )}
                              {inst.status === 'skipped' && <span className="tag warning">Skipped</span>}
                              {showEffort && (
                                <span className={`tag effort-${inst.effort}`}>
                                  {inst.effort} {inst.effort === 1 ? 'pt' : 'pts'}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        {inst.notes && <div className="instance-note">{inst.notes}</div>}

                        <div className="assignment-meta" style={{ marginTop: 0 }}>
                          <span>{inst.categoryPath}</span>
                          <span>&middot;</span>
                          <span>
                            {inst.windowEndDate && inst.windowEndDate !== inst.dueDate
                              ? `${inst.dueDate} → ${inst.windowEndDate}`
                              : inst.dueDate}
                          </span>
                          {inst.completedBy && <span>&middot; Done by {inst.completedBy}</span>}
                        </div>

                        <div className="horizon-card-foot">
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            {!isDone && !inst.assigneeId && inst.assignmentMode === 'open_pool' && (
                              <button type="button" className="btn btn-secondary btn-sm" onClick={() => onClaim(inst.id)}>
                                <Hand size={13} /> Claim
                              </button>
                            )}
                            {inst.visibility !== 'private' && !isDone && (
                              <select
                                className="inline-select"
                                value={inst.assigneeId}
                                onChange={(e) => onReassign(inst.id, e.target.value)}
                                aria-label={`Assignee for ${inst.taskTitle}`}
                              >
                                <option value="">Anyone</option>
                                {data.members.map((m) => (
                                  <option key={m.id} value={m.id}>
                                    {m.name.split(' ')[0]}
                                  </option>
                                ))}
                              </select>
                            )}
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                            {!isDone && isOpenStatus(inst.status) && (
                              <>
                                <StatusNotePopover
                                  instance={inst}
                                  onSave={(payload) => onUpdateStatus(inst.id, payload)}
                                />
                                <DeferMenu
                                  minDate={data.todayStr}
                                  onDefer={(payload) => onDefer(inst.id, payload)}
                                />
                                <button
                                  type="button"
                                  className="btn btn-ghost btn-sm"
                                  onClick={() => onSkip(inst.id)}
                                  title="Skip occurrence"
                                >
                                  <SkipForward size={13} />
                                </button>
                              </>
                            )}
                            {inst.triggerSource === 'ad_hoc' ? (
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                onClick={() => onEditAdHoc(inst)}
                                title="Edit ad-hoc record"
                              >
                                <Edit3 size={13} />
                              </button>
                            ) : taskMap.has(inst.taskId) ? (
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                onClick={() => onEditTask(taskMap.get(inst.taskId)!)}
                                title="Edit task"
                              >
                                <Edit3 size={13} />
                              </button>
                            ) : null}
                            <button
                              type="button"
                              className="btn btn-danger-ghost btn-sm"
                              onClick={() => onDelete(inst.id)}
                              title="Delete occurrence"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div
                      key={inst.id}
                      className={`assignment-row ${isOverdue ? 'overdue' : ''} ${inst.visibility === 'private' ? 'private-row' : ''} ${isDone ? 'completed' : ''}`}
                    >
                      <button
                        type="button"
                        className={`check-btn ${isDone ? 'checked' : ''}`}
                        onClick={() => onComplete(inst.id, !isDone)}
                      >
                        {isDone && <Check size={14} strokeWidth={3} />}
                      </button>

                      <div
                        className="assignment-main clickable-main"
                        onClick={() => onOpenDetail({ instanceId: inst.id, taskId: inst.taskId || undefined })}
                        title="Click to view details & update status"
                      >
                        <div className="assignment-title">
                          <span className="clickable-title">{inst.taskTitle}</span>
                          <StatusBadge status={inst.status} />
                          {inst.triggerSource === 'ad_hoc' ? (
                            <span className="tag info">Ad-hoc</span>
                          ) : isOneOff ? (
                            <span className="tag warning">One-off</span>
                          ) : (
                            <span className="tag primary">
                              <Repeat size={10} /> {inst.windowType}
                            </span>
                          )}
                          {inst.visibility === 'private' && (
                            <span className="tag private">
                              <Lock size={11} /> Private
                            </span>
                          )}
                          {proj && (
                            <span className="tag info">
                              <FolderKanban size={11} /> {proj.title}
                            </span>
                          )}
                          {inst.status === 'skipped' && <span className="tag warning">Skipped</span>}
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
                          <span>
                            {inst.windowEndDate && inst.windowEndDate !== inst.dueDate
                              ? `${inst.dueDate} → ${inst.windowEndDate}`
                              : inst.dueDate}
                          </span>
                          {inst.completedBy && <span>&middot; Done by {inst.completedBy}</span>}
                          {inst.notes && <span>&middot; {inst.notes}</span>}
                          {!inst.notes && inst.reason && <span>&middot; {inst.reason}</span>}
                        </div>
                      </div>

                      <div className="horizons-controls">
                        <div>
                          {!isDone && !inst.assigneeId && inst.assignmentMode === 'open_pool' && (
                            <button type="button" className="btn btn-secondary btn-sm" onClick={() => onClaim(inst.id)}>
                              <Hand size={13} /> Claim
                            </button>
                          )}
                        </div>

                        <div>
                          {inst.visibility !== 'private' && !isDone && (
                            <select
                              className="inline-select"
                              value={inst.assigneeId}
                              onChange={(e) => onReassign(inst.id, e.target.value)}
                              aria-label={`Assignee for ${inst.taskTitle}`}
                            >
                              <option value="">Anyone</option>
                              {data.members.map((m) => (
                                <option key={m.id} value={m.id}>
                                  {m.name.split(' ')[0]}
                                </option>
                              ))}
                            </select>
                          )}
                        </div>

                        <div>
                          {!isDone && isOpenStatus(inst.status) && (
                            <StatusNotePopover
                              instance={inst}
                              onSave={(payload) => onUpdateStatus(inst.id, payload)}
                            />
                          )}
                        </div>

                        <div>
                          {!isDone && isOpenStatus(inst.status) && (
                            <DeferMenu
                              minDate={data.todayStr}
                              onDefer={(payload) => onDefer(inst.id, payload)}
                            />
                          )}
                        </div>

                        <div>
                          {!isDone && isOpenStatus(inst.status) && (
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() => onSkip(inst.id)}
                              title="Skip occurrence"
                            >
                              <SkipForward size={14} /> Skip
                            </button>
                          )}
                        </div>

                        <div>
                          {inst.triggerSource === 'ad_hoc' ? (
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() => onEditAdHoc(inst)}
                              title="Edit ad-hoc record"
                            >
                              <Edit3 size={14} />
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

                        <button
                          type="button"
                          className="btn btn-danger-ghost btn-sm"
                          onClick={() => onDelete(inst.id)}
                          title="Delete occurrence"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
