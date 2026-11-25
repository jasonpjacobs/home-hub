import React, { useMemo, useState } from 'react';
import {
  BookmarkCheck,
  CheckCircle2,
  Edit3,
  FolderKanban,
  Lock,
  Repeat,
  Search,
} from 'lucide-react';
import type { DashboardData, Task, TaskInstance } from '../types';
import type { DetailTarget } from './TaskDetailModal';

interface Props {
  data: DashboardData;
  onOpenDetail: (target: DetailTarget) => void;
  onEditAdHoc: (instance: TaskInstance) => void;
  onEditTask: (task: Task) => void;
}

type KindFilter = 'all' | 'recurring' | 'one_off' | 'ad_hoc' | 'project';
type RangeFilter = '7d' | '30d' | 'all';

function parseUTC(dateStr: string) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

function addDaysStr(dateStr: string, days: number) {
  const dt = parseUTC(dateStr);
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

function formatDateHeading(dateStr: string, todayStr: string) {
  const formatted = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(parseUTC(dateStr));
  if (dateStr === todayStr) return `Today · ${formatted}`;
  if (dateStr === addDaysStr(todayStr, -1)) return `Yesterday · ${formatted}`;
  return formatted;
}

function formatTime(iso: string) {
  if (!iso || !iso.includes('T')) return '';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(dt);
}

function classifyKind(inst: TaskInstance, taskMap: Map<string, Task>): 'ad_hoc' | 'project' | 'one_off' | 'recurring' {
  if (inst.triggerSource === 'ad_hoc') return 'ad_hoc';
  if (inst.projectId) return 'project';
  const task = inst.taskId ? taskMap.get(inst.taskId) : undefined;
  if (task) {
    if (task.cadenceMode === 'weather_triggered') return 'recurring';
    return task.recurrenceType === 'once' ? 'one_off' : 'recurring';
  }
  return inst.windowType === 'ad_hoc' ? 'ad_hoc' : 'one_off';
}

export function ActivityLogView({ data, onOpenDetail, onEditAdHoc, onEditTask }: Props) {
  const [query, setQuery] = useState('');
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [range, setRange] = useState<RangeFilter>('30d');
  const [includePrivate, setIncludePrivate] = useState(false);

  const taskMap = useMemo(() => new Map(data.tasks.map((t) => [t.id, t])), [data.tasks]);
  const projectMap = useMemo(() => new Map(data.projects.map((p) => [p.id, p])), [data.projects]);
  const memberByName = useMemo(
    () => new Map(data.members.map((m) => [m.name.toLowerCase(), m.id])),
    [data.members],
  );

  const activeMembers = useMemo(
    () => data.members.filter((m) => m.active !== false),
    [data.members],
  );

  const minDateStr = useMemo(() => {
    if (range === '7d') return addDaysStr(data.todayStr, -7);
    if (range === '30d') return addDaysStr(data.todayStr, -30);
    return '';
  }, [range, data.todayStr]);

  const completedEntries = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.instances
      .filter((inst) => {
        if (inst.status !== 'completed') return false;
        if (!includePrivate && inst.visibility === 'private') return false;

        const completedDate = (inst.completedAt || inst.dueDate || data.todayStr).slice(0, 10);
        if (minDateStr && completedDate < minDateStr) return false;

        const kind = classifyKind(inst, taskMap);
        if (kindFilter !== 'all' && kind !== kindFilter) return false;

        if (
          q &&
          !`${inst.taskTitle} ${inst.categoryPath} ${inst.notes} ${inst.completedBy} ${inst.assigneeName}`
            .toLowerCase()
            .includes(q)
        ) {
          return false;
        }
        return true;
      })
      .map((inst) => {
        const completedDate = (inst.completedAt || inst.dueDate || data.todayStr).slice(0, 10);
        const sortTs = inst.completedAt || `${completedDate}T12:00:00.000Z`;
        // Resolve which member column gets credit (prefer completedBy name match, fallback to assigneeId)
        const byCompletedName = inst.completedBy
          ? memberByName.get(inst.completedBy.toLowerCase())
          : undefined;
        const memberId = byCompletedName || inst.assigneeId || activeMembers[0]?.id || '';
        const kind = classifyKind(inst, taskMap);
        return { inst, completedDate, sortTs, memberId, kind };
      })
      .sort((a, b) => b.sortTs.localeCompare(a.sortTs));
  }, [
    data.instances,
    data.todayStr,
    includePrivate,
    minDateStr,
    kindFilter,
    query,
    taskMap,
    memberByName,
    activeMembers,
  ]);

  // Count per member for column headers
  const countByMember = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of completedEntries) {
      map.set(entry.memberId, (map.get(entry.memberId) || 0) + 1);
    }
    return map;
  }, [completedEntries]);

  // Group chronologically by date (newest-first), with each date holding per-member columns
  const dateBands = useMemo(() => {
    const byDate = new Map<string, typeof completedEntries>();
    for (const entry of completedEntries) {
      const list = byDate.get(entry.completedDate) || [];
      list.push(entry);
      byDate.set(entry.completedDate, list);
    }
    return Array.from(byDate.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([dateStr, entries]) => {
        const byMember = new Map<string, typeof completedEntries>();
        for (const m of activeMembers) byMember.set(m.id, []);
        for (const e of entries) {
          const list = byMember.get(e.memberId) || [];
          list.push(e);
          byMember.set(e.memberId, list);
        }
        return { dateStr, entries, byMember };
      });
  }, [completedEntries, activeMembers]);

  const colStyle = {
    gridTemplateColumns: `repeat(${Math.max(1, activeMembers.length)}, minmax(210px, 1fr))`,
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Completed Activity Log</h1>
          <p className="page-subtitle">
            Chronological record of completed household tasks — one column per person.
          </p>
        </div>
        <div className="header-actions">
          <div className="pill-group">
            {(
              [
                ['7d', 'Last 7 Days'],
                ['30d', 'Last 30 Days'],
                ['all', 'All Time'],
              ] as Array<[RangeFilter, string]>
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                className={`pill ${range === k ? 'active' : ''}`}
                onClick={() => setRange(k)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="filter-bar">
        <div style={{ position: 'relative', flex: 1, minWidth: 220 }}>
          <Search
            size={15}
            style={{
              position: 'absolute',
              left: 11,
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--text-muted)',
            }}
          />
          <input
            className="input"
            style={{ paddingLeft: 34 }}
            placeholder="Search completed tasks, categories, or notes..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div className="pill-group">
          {(
            [
              ['all', 'All'],
              ['recurring', 'Recurring'],
              ['one_off', 'One-Off'],
              ['ad_hoc', 'Ad-Hoc'],
              ['project', 'Projects'],
            ] as Array<[KindFilter, string]>
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              className={`pill ${kindFilter === k ? 'active' : ''}`}
              onClick={() => setKindFilter(k)}
            >
              {label}
            </button>
          ))}
        </div>

        <label
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontSize: '0.83rem',
            color: 'var(--text-muted)',
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={includePrivate}
            onChange={(e) => setIncludePrivate(e.target.checked)}
          />
          Include my private log
        </label>
      </div>

      <div className="activity-scroll">
        {/* Sticky One-User-Per-Column Header */}
        <div className="activity-columns-header" style={colStyle}>
          {activeMembers.map((m) => (
            <div key={m.id} className="activity-col-head">
              <span className="avatar sm" style={{ background: m.avatarColor }}>
                {m.name.charAt(0)}
              </span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div
                  style={{
                    fontWeight: 700,
                    fontSize: '0.92rem',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {m.name}
                </div>
                <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)' }}>
                  {m.memberGroup}
                </div>
              </div>
              <span className="tag primary">{countByMember.get(m.id) || 0}</span>
            </div>
          ))}
        </div>

        {dateBands.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: 44, color: 'var(--text-muted)', marginTop: 12 }}>
            No completed tasks match this filter yet. Check off a task or log an ad-hoc entry from
            the Daily Cockpit!
          </div>
        ) : (
          dateBands.map((band) => (
            <div key={band.dateStr} className="activity-date-band">
              <div className={`horizon-divider ${band.dateStr === data.todayStr ? 'current' : ''}`}>
                <span className="horizon-divider-label">
                  <span>{formatDateHeading(band.dateStr, data.todayStr)}</span>
                  <span className={`tag ${band.dateStr === data.todayStr ? 'primary' : ''}`}>
                    {band.entries.length}
                  </span>
                </span>
                <span className="horizon-divider-line" />
              </div>

              <div className="activity-columns-grid" style={colStyle}>
                {activeMembers.map((m) => {
                  const colEntries = band.byMember.get(m.id) || [];
                  return (
                    <div key={m.id} className="activity-col-cell">
                      {colEntries.length === 0 ? (
                        <div className="activity-empty-dash">—</div>
                      ) : (
                        colEntries.map(({ inst, kind }) => {
                          const proj = inst.projectId ? projectMap.get(inst.projectId) : null;
                          const timeStr = formatTime(inst.completedAt);
                          return (
                            <div
                              key={inst.id}
                              className={`activity-card clickable-main ${inst.visibility === 'private' ? 'private-row' : ''}`}
                              onClick={() =>
                                onOpenDetail({ instanceId: inst.id, taskId: inst.taskId || undefined })
                              }
                              title="Click to view details & update status"
                            >
                              <div className="activity-card-top">
                                <CheckCircle2
                                  size={14}
                                  style={{ color: 'var(--primary)', flexShrink: 0, marginTop: 2 }}
                                />
                                <span
                                  className="clickable-title"
                                  style={{ fontWeight: 600, fontSize: '0.88rem', lineHeight: 1.3, flex: 1 }}
                                >
                                  {inst.taskTitle}
                                </span>
                                {inst.triggerSource === 'ad_hoc' ? (
                                  <button
                                    type="button"
                                    className="tree-icon-btn"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onEditAdHoc(inst);
                                    }}
                                    title="Edit ad-hoc record"
                                  >
                                    <Edit3 size={12} />
                                  </button>
                                ) : inst.taskId && taskMap.has(inst.taskId) ? (
                                  <button
                                    type="button"
                                    className="tree-icon-btn"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onEditTask(taskMap.get(inst.taskId)!);
                                    }}
                                    title="Edit task"
                                  >
                                    <Edit3 size={12} />
                                  </button>
                                ) : null}
                              </div>

                              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
                                {kind === 'recurring' && (
                                  <span className="tag primary">
                                    <Repeat size={10} /> Recurring
                                  </span>
                                )}
                                {kind === 'one_off' && <span className="tag warning">One-off</span>}
                                {kind === 'ad_hoc' && (
                                  <span className="tag info">
                                    <BookmarkCheck size={10} /> Ad-hoc
                                  </span>
                                )}
                                {proj && (
                                  <span className="tag info">
                                    <FolderKanban size={10} /> {proj.title}
                                  </span>
                                )}
                                {inst.visibility === 'private' && (
                                  <span className="tag private">
                                    <Lock size={10} /> Private
                                  </span>
                                )}
                                {data.user.showEffortAndFairness && (
                                  <span className={`tag effort-${inst.effort}`}>
                                    {inst.effort} {inst.effort === 1 ? 'pt' : 'pts'}
                                  </span>
                                )}
                              </div>

                              {inst.notes && (
                                <div className="instance-note" style={{ fontSize: '0.77rem', marginTop: 6 }}>
                                  {inst.notes}
                                </div>
                              )}

                              <div
                                style={{
                                  fontSize: '0.73rem',
                                  color: 'var(--text-muted)',
                                  marginTop: 6,
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  gap: 6,
                                }}
                              >
                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {inst.categoryPath}
                                </span>
                                {timeStr && <span style={{ flexShrink: 0 }}>{timeStr}</span>}
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
