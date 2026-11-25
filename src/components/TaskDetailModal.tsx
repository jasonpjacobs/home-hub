import React, { useEffect, useMemo, useState } from 'react';
import {
  BookmarkCheck,
  Calendar,
  Check,
  CheckCircle2,
  Circle,
  CircleDot,
  Clock,
  CloudRain,
  CornerDownRight,
  Edit3,
  Flame,
  Folder,
  FolderKanban,
  Hand,
  Lock,
  Moon,
  PauseCircle,
  Repeat,
  ShieldAlert,
  SkipForward,
  Sparkles,
  Sun,
  Sunrise,
  Trash2,
  User,
  X,
} from 'lucide-react';
import { api } from '../api';
import type { DashboardData, Task, TaskInstance } from '../types';
import { CalendarDatePicker } from './CalendarDatePicker';
import { buildCategoryOptions } from './TaskModal';

export interface DetailTarget {
  instanceId?: string;
  taskId?: string;
}

interface Props {
  data: DashboardData;
  target: DetailTarget;
  onClose: () => void;
  onSelectTarget: (next: DetailTarget) => void;
  onEditTask: (task: Task) => void;
  onEditAdHoc: (instance: TaskInstance) => void;
  onOpenProjects: () => void;
  onRefresh: () => Promise<void>;
  onToast: (msg: string) => void;
}

const ALL_STATUS_OPTIONS: Array<{
  value: TaskInstance['status'];
  label: string;
  tone: string;
  icon: React.ReactNode;
}> = [
  { value: 'pending', label: 'Not Started', tone: '', icon: <Circle size={13} /> },
  { value: 'started', label: 'Started', tone: 'info', icon: <CircleDot size={13} /> },
  { value: 'on_hold', label: 'On Hold', tone: 'warning', icon: <PauseCircle size={13} /> },
  { value: 'gated', label: 'Gated', tone: 'gated', icon: <ShieldAlert size={13} /> },
  { value: 'completed', label: 'Completed', tone: 'primary', icon: <CheckCircle2 size={13} /> },
  { value: 'skipped', label: 'Skipped', tone: 'warning', icon: <SkipForward size={13} /> },
];

function formatScheduleLabel(task?: Task, inst?: TaskInstance): string {
  if (inst?.triggerSource === 'ad_hoc') return 'Ad-hoc log entry';
  if (!task) return inst?.windowType ? `${inst.windowType} schedule` : 'Scheduled task';
  if (task.projectId) return 'One-off project task';
  if (task.isHabit) {
    const cue =
      task.routineCue && task.routineCue !== 'anytime'
        ? ` · ${task.routineCue.charAt(0).toUpperCase()}${task.routineCue.slice(1)}`
        : '';
    if (task.recurrenceType === 'daily') return `Daily habit${cue}`;
    if (task.recurrenceType === 'weekly' && task.recurrenceDays) {
      return `Habit (${task.recurrenceDays})${cue}`;
    }
    if (task.recurrenceType === 'custom_days') {
      return `Habit every ${task.recurrenceInterval || 1} days${cue}`;
    }
    return `Habit (${task.recurrenceType})${cue}`;
  }
  if (task.cadenceMode === 'weather_triggered') {
    return `Weather-triggered (${(task.weatherTrigger || 'none').replace(/_/g, ' ')})`;
  }
  if (task.recurrenceType === 'once') return 'One-off task';
  const prefix = task.cadenceMode === 'flexible_window' ? 'Flexible ' : '';
  if (task.recurrenceType === 'weekly' && task.recurrenceDays) {
    return `${prefix}Weekly (${task.recurrenceDays})`;
  }
  if (task.recurrenceType === 'seasonal' && task.targetSeason) {
    return `${prefix}Seasonal (${task.targetSeason})`;
  }
  if (task.recurrenceType === 'custom_days') {
    const n = task.recurrenceInterval || 1;
    return `${prefix}Every ${n} ${n === 1 ? 'day' : 'days'}`;
  }
  if (task.recurrenceType === 'custom_months') {
    const n = task.recurrenceInterval || 1;
    return `${prefix}Every ${n} ${n === 1 ? 'month' : 'months'}`;
  }
  return `${prefix}${task.recurrenceType.charAt(0).toUpperCase()}${task.recurrenceType.slice(1)}`;
}

function formatOverduePolicy(policy?: string): string {
  if (policy === 'auto_skip') return 'Auto-skip if missed';
  if (policy === 'roll_forward') return 'Roll forward to next window';
  return 'Carry over until completed';
}

export function TaskDetailModal({
  data,
  target,
  onClose,
  onSelectTarget,
  onEditTask,
  onEditAdHoc,
  onOpenProjects,
  onRefresh,
  onToast,
}: Props) {
  // Resolve live instance + task from dashboard so modal always reflects fresh state
  const resolvedInstance = useMemo<TaskInstance | undefined>(() => {
    if (target.instanceId) {
      const exact = data.instances.find((i) => i.id === target.instanceId);
      if (exact) return exact;
    }
    if (target.taskId) {
      const matching = data.instances.filter((i) => i.taskId === target.taskId);
      if (matching.length === 0) return undefined;
      // Prefer open instance closest to today, else most recent completed/skipped
      const open = matching
        .filter((i) => i.status !== 'completed' && i.status !== 'skipped')
        .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''));
      if (open.length > 0) return open[0];
      return [...matching].sort((a, b) =>
        String(b.completedAt || b.dueDate || '').localeCompare(String(a.completedAt || a.dueDate || '')),
      )[0];
    }
    return undefined;
  }, [data.instances, target.instanceId, target.taskId]);

  const resolvedTask = useMemo<Task | undefined>(() => {
    const tid = target.taskId || resolvedInstance?.taskId;
    if (!tid) return undefined;
    return data.tasks.find((t) => t.id === tid);
  }, [data.tasks, target.taskId, resolvedInstance?.taskId]);

  const [status, setStatus] = useState<TaskInstance['status']>(resolvedInstance?.status || 'pending');
  const [notes, setNotes] = useState(resolvedInstance?.notes || '');
  const [dueDate, setDueDate] = useState(resolvedInstance?.dueDate || data.todayStr);
  const [assigneeId, setAssigneeId] = useState(resolvedInstance?.assigneeId || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync form controls whenever resolved instance changes (e.g. switching to a sub-task or after refresh)
  useEffect(() => {
    setStatus(resolvedInstance?.status || 'pending');
    setNotes(resolvedInstance?.notes || '');
    setDueDate(resolvedInstance?.dueDate || data.todayStr);
    setAssigneeId(resolvedInstance?.assigneeId || '');
    setError(null);
  }, [
    resolvedInstance?.id,
    resolvedInstance?.status,
    resolvedInstance?.notes,
    resolvedInstance?.dueDate,
    resolvedInstance?.assigneeId,
    data.todayStr,
  ]);

  const isDirty = Boolean(
    resolvedInstance &&
      (status !== resolvedInstance.status ||
        notes.trim() !== (resolvedInstance.notes || '').trim() ||
        dueDate !== (resolvedInstance.dueDate || '') ||
        assigneeId !== (resolvedInstance.assigneeId || '')),
  );

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (isDirty && !window.confirm('Discard your unsaved status/note changes?')) return;
        onClose();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isDirty, onClose]);

  const categoryMap = useMemo(() => {
    return new Map(buildCategoryOptions(data.categories).map((c) => [c.id, c.label]));
  }, [data.categories]);

  const project = useMemo(() => {
    const pid = resolvedTask?.projectId || resolvedInstance?.projectId;
    return pid ? data.projects.find((p) => p.id === pid) : undefined;
  }, [data.projects, resolvedTask?.projectId, resolvedInstance?.projectId]);

  const parentTask = useMemo(() => {
    return resolvedTask?.parentTaskId
      ? data.tasks.find((t) => t.id === resolvedTask.parentTaskId)
      : undefined;
  }, [data.tasks, resolvedTask?.parentTaskId]);

  const subTasks = useMemo(() => {
    if (!resolvedTask) return [];
    return data.tasks
      .filter((t) => t.parentTaskId === resolvedTask.id)
      .sort((a, b) => (a.stepOrder || 0) - (b.stepOrder || 0))
      .map((child) => ({
        task: child,
        instance: data.instances.find((i) => i.taskId === child.id && i.status !== 'skipped'),
      }));
  }, [data.tasks, data.instances, resolvedTask]);

  const habitStat = useMemo(() => {
    if (!resolvedTask?.isHabit) return undefined;
    return (data.habitStats || []).find((s) => s.taskId === resolvedTask.id);
  }, [data.habitStats, resolvedTask]);

  const recentHistory = useMemo(() => {
    if (!resolvedTask) return [];
    return data.instances
      .filter((i) => i.taskId === resolvedTask.id && i.status === 'completed')
      .sort((a, b) => String(b.completedAt || b.dueDate).localeCompare(String(a.completedAt || a.dueDate)))
      .slice(0, 4);
  }, [data.instances, resolvedTask]);

  if (!resolvedInstance && !resolvedTask) {
    return null;
  }

  const title = resolvedInstance?.taskTitle || resolvedTask?.title || 'Task';
  const visibility = resolvedInstance?.visibility || resolvedTask?.visibility || 'household';
  const categoryLabel =
    (resolvedTask?.categoryId && categoryMap.get(resolvedTask.categoryId)) ||
    resolvedInstance?.categoryPath ||
    'General';
  const isAdHoc = resolvedInstance?.triggerSource === 'ad_hoc';
  const isOneOff =
    !isAdHoc &&
    !resolvedTask?.isHabit &&
    (Boolean(project) ||
      (resolvedTask ? resolvedTask.cadenceMode !== 'weather_triggered' && resolvedTask.recurrenceType === 'once' : false));
  const isOverdue = Boolean(
    resolvedInstance &&
      (resolvedInstance.status === 'pending' || resolvedInstance.status === 'started') &&
      (resolvedInstance.windowEndDate || resolvedInstance.dueDate) < data.todayStr,
  );
  const effort = resolvedInstance?.effort ?? resolvedTask?.effort ?? 1;

  function requestClose() {
    if (isDirty && !window.confirm('Discard your unsaved status/note changes?')) return;
    onClose();
  }

  async function handleSaveUpdates(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!resolvedInstance) return;
    setSaving(true);
    setError(null);
    try {
      const notesTrimmed = notes.trim();
      const statusChangedToDone = status === 'completed' && resolvedInstance.status !== 'completed';
      const otherFieldsChanged =
        dueDate !== (resolvedInstance.dueDate || '') ||
        assigneeId !== (resolvedInstance.assigneeId || '') ||
        notesTrimmed !== (resolvedInstance.notes || '').trim();

      if (statusChangedToDone) {
        if (dueDate !== (resolvedInstance.dueDate || '') || assigneeId !== (resolvedInstance.assigneeId || '')) {
          await api.updateInstance(resolvedInstance.id, {
            ...(dueDate ? { dueDate } : {}),
            ...(visibility !== 'private' ? { assigneeId } : {}),
            notes: notesTrimmed,
          });
        }
        const res = await api.completeInstance(resolvedInstance.id, true, notesTrimmed);
        await onRefresh();
        onToast(
          res.nextInstance
            ? `Marked complete! Next cycle scheduled for ${res.nextInstance.dueDate}.`
            : `Completed "${title}"!`,
        );
      } else if (status !== resolvedInstance.status || otherFieldsChanged) {
        await api.updateInstance(resolvedInstance.id, {
          status,
          notes: notesTrimmed,
          ...(dueDate ? { dueDate } : {}),
          ...(visibility !== 'private' ? { assigneeId } : {}),
        });
        await onRefresh();
        const label = ALL_STATUS_OPTIONS.find((s) => s.value === status)?.label || status;
        onToast(`Updated "${title}" (${label}).`);
      }
      onClose();
    } catch (err: any) {
      setError(err.message || 'Could not update task.');
    } finally {
      setSaving(false);
    }
  }

  async function handleQuickDefer(days: number) {
    if (!resolvedInstance) return;
    setSaving(true);
    setError(null);
    try {
      const res = await api.deferInstance(resolvedInstance.id, { days });
      await onRefresh();
      onToast(`Deferred "${title}" to ${res.instance.dueDate}.`);
    } catch (err: any) {
      setError(err.message || 'Could not defer task.');
    } finally {
      setSaving(false);
    }
  }

  async function handleQuickCompleteTask() {
    if (!resolvedTask) return;
    setSaving(true);
    setError(null);
    try {
      const res = await api.quickCompleteTask(resolvedTask.id);
      await onRefresh();
      onToast(`Completed "${res.instance.taskTitle}"!`);
      onSelectTarget({ instanceId: res.instance.id, taskId: resolvedTask.id });
    } catch (err: any) {
      setError(err.message || 'Could not complete task.');
    } finally {
      setSaving(false);
    }
  }

  async function handleClaimToggle() {
    if (!resolvedInstance) return;
    const isClaimedByMe = resolvedInstance.assigneeId === data.user.id;
    setSaving(true);
    try {
      await api.claimInstance(resolvedInstance.id, isClaimedByMe);
      await onRefresh();
      onToast(isClaimedByMe ? 'Set back to Anyone.' : `Claimed "${title}"!`);
    } catch (err: any) {
      setError(err.message || 'Could not update claim.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (isAdHoc && resolvedInstance) {
      if (!window.confirm(`Delete ad-hoc record "${title}"?`)) return;
      setSaving(true);
      try {
        await api.deleteInstance(resolvedInstance.id);
        await onRefresh();
        onToast('Deleted ad-hoc record.');
        onClose();
      } finally {
        setSaving(false);
      }
      return;
    }
    if (resolvedTask) {
      if (!window.confirm(`Delete task "${title}" and its pending occurrences?`)) return;
      setSaving(true);
      try {
        await api.deleteTask(resolvedTask.id);
        await onRefresh();
        onToast(`Deleted "${title}".`);
        onClose();
      } finally {
        setSaving(false);
      }
    }
  }

  const CueIcon =
    resolvedTask?.routineCue === 'morning'
      ? Sunrise
      : resolvedTask?.routineCue === 'afternoon'
        ? Sun
        : resolvedTask?.routineCue === 'evening'
          ? Moon
          : Sparkles;

  return (
    <div className="modal-backdrop" onClick={requestClose}>
      <div className="modal-card task-detail-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="task-detail-header">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
              {resolvedTask?.isHabit ? (
                <span className="tag habit">
                  <Flame size={11} /> Habit
                  {resolvedTask.routineCue && resolvedTask.routineCue !== 'anytime'
                    ? ` · ${resolvedTask.routineCue}`
                    : ''}
                </span>
              ) : isAdHoc ? (
                <span className="tag info">
                  <BookmarkCheck size={11} /> Ad-hoc
                </span>
              ) : isOneOff ? (
                <span className="tag warning">One-off</span>
              ) : (
                <span className="tag primary">
                  <Repeat size={11} /> Recurring
                </span>
              )}

              {visibility === 'private' && (
                <span className="tag private">
                  <Lock size={11} /> Private
                </span>
              )}

              {project && (
                <button
                  type="button"
                  className="tag info"
                  style={{ border: 'none', cursor: 'pointer' }}
                  onClick={() => {
                    onClose();
                    onOpenProjects();
                  }}
                >
                  <FolderKanban size={11} /> {project.title}
                </button>
              )}

              {isOverdue && <span className="tag accent">Overdue</span>}
              {resolvedInstance?.weatherUrgency === 'urgent' && (
                <span className="tag accent">
                  <CloudRain size={11} /> Weather Urgent
                </span>
              )}
              {resolvedInstance?.weatherUrgency === 'heads_up' && (
                <span className="tag info">
                  <CloudRain size={11} /> Weather Heads-Up
                </span>
              )}
              {data.user.showEffortAndFairness && (
                <span className={`tag effort-${effort}`}>
                  {effort} {effort === 1 ? 'pt' : 'pts'}
                </span>
              )}
            </div>

            <h2 style={{ fontSize: '1.35rem', lineHeight: 1.25 }}>{title}</h2>

            {parentTask && (
              <div style={{ marginTop: 6 }}>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  style={{ padding: '2px 6px', fontSize: '0.78rem' }}
                  onClick={() => onSelectTarget({ taskId: parentTask.id })}
                >
                  <CornerDownRight size={12} /> Sub-task of {parentTask.title}
                </button>
              </div>
            )}
          </div>

          <button type="button" className="btn btn-ghost" onClick={requestClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {error && (
          <div className="banner error" style={{ marginBottom: 12 }}>
            <span>{error}</span>
          </div>
        )}

        {/* Details Metadata Summary */}
        <div className="task-detail-meta-grid">
          <div className="task-detail-meta-item">
            <span className="task-detail-meta-label">
              <Folder size={12} /> Category
            </span>
            <span className="task-detail-meta-value">{categoryLabel}</span>
          </div>

          <div className="task-detail-meta-item">
            <span className="task-detail-meta-label">
              {resolvedTask?.isHabit ? <CueIcon size={12} /> : <Repeat size={12} />} Schedule
            </span>
            <span className="task-detail-meta-value">
              {formatScheduleLabel(resolvedTask, resolvedInstance)}
            </span>
          </div>

          {!isAdHoc && (
            <div className="task-detail-meta-item">
              <span className="task-detail-meta-label">
                <Clock size={12} /> If Missed
              </span>
              <span className="task-detail-meta-value">
                {formatOverduePolicy(resolvedInstance?.overduePolicy || resolvedTask?.overduePolicy)}
              </span>
            </div>
          )}

          {resolvedInstance?.completedAt ? (
            <div className="task-detail-meta-item">
              <span className="task-detail-meta-label">
                <CheckCircle2 size={12} /> Completed
              </span>
              <span className="task-detail-meta-value">
                {resolvedInstance.completedBy || 'Member'} · {resolvedInstance.completedAt.slice(0, 10)}
              </span>
            </div>
          ) : resolvedInstance?.reason ? (
            <div className="task-detail-meta-item">
              <span className="task-detail-meta-label">
                <Sparkles size={12} /> Scheduling Note
              </span>
              <span className="task-detail-meta-value">{resolvedInstance.reason}</span>
            </div>
          ) : null}
        </div>

        {/* Task Description / Checklist */}
        {resolvedTask?.description && (
          <div className="task-detail-desc">
            <div className="task-detail-section-label">Task Notes / Checklist</div>
            <p>{resolvedTask.description}</p>
          </div>
        )}

        {/* Habit 7-Day Consistency Strip (if habit) */}
        {resolvedTask?.isHabit && habitStat && (
          <div className="task-detail-habit-box">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span className="task-detail-section-label" style={{ marginBottom: 0 }}>
                Last 7 Days Consistency
              </span>
              <div className="habit-stats-meta">
                <span className="habit-rate">{habitStat.completedLast7}/7 days</span>
                {habitStat.currentStreak > 0 && (
                  <span className="habit-streak-pill">
                    <Flame size={11} /> {habitStat.currentStreak}d streak
                  </span>
                )}
              </div>
            </div>
            <div className="habit-dots">
              {habitStat.last7Days.map((pt) => (
                <span
                  key={pt.date}
                  className={`habit-dot ${pt.done ? 'done' : ''} ${pt.isToday ? 'today' : ''}`}
                  style={{ width: 28, height: 26, fontSize: '0.72rem' }}
                  title={`${pt.weekday} (${pt.date}): ${pt.done ? 'Done' : pt.isToday ? 'Today' : 'Missed'}`}
                >
                  {pt.weekday.charAt(0)}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Interactive Status & Progress Update Form */}
        {resolvedInstance ? (
          <form onSubmit={handleSaveUpdates} className="task-detail-status-box">
            <div className="task-detail-section-label">Status</div>
            <div className="task-detail-status-grid">
              {ALL_STATUS_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={`task-detail-status-btn ${status === opt.value ? `selected ${opt.tone}` : ''}`}
                  onClick={() => setStatus(opt.value)}
                >
                  {opt.icon}
                  <span>{opt.label}</span>
                </button>
              ))}
            </div>

            <div className="form-row-2" style={{ marginTop: 12 }}>
              <div className="field">
                <label style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <Calendar size={12} /> {isAdHoc ? 'Date Done' : 'Due Date'}
                </label>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <div style={{ flex: 1 }}>
                    <CalendarDatePicker
                      value={dueDate}
                      onChange={setDueDate}
                      compact
                    />
                  </div>
                  {!isAdHoc && status !== 'completed' && status !== 'skipped' && (
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        style={{ padding: '5px 7px', fontSize: '0.74rem' }}
                        disabled={saving}
                        onClick={() => handleQuickDefer(1)}
                        title="Push due date by 1 day"
                      >
                        +1d
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        style={{ padding: '5px 7px', fontSize: '0.74rem' }}
                        disabled={saving}
                        onClick={() => handleQuickDefer(7)}
                        title="Push due date by 1 week"
                      >
                        +1w
                      </button>
                    </div>
                  )}
                </div>
                {resolvedInstance.windowEndDate &&
                  resolvedInstance.windowEndDate !== resolvedInstance.dueDate && (
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      Flexible window through {resolvedInstance.windowEndDate}
                    </span>
                  )}
              </div>

              <div className="field">
                <label style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <User size={12} /> Assigned To
                </label>
                {visibility === 'private' ? (
                  <div
                    className="input"
                    style={{
                      padding: '6px 10px',
                      fontSize: '0.84rem',
                      color: 'var(--text-muted)',
                      background: 'var(--surface-subtle)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <Lock size={12} /> {data.user.name} (Private)
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <select
                      className="select"
                      style={{ padding: '6px 10px', fontSize: '0.85rem' }}
                      value={assigneeId}
                      onChange={(e) => setAssigneeId(e.target.value)}
                    >
                      <option value="">Anyone</option>
                      {data.members.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name} ({m.memberGroup})
                        </option>
                      ))}
                    </select>
                    {!isAdHoc && status !== 'completed' && !resolvedInstance.assigneeId && (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        disabled={saving}
                        onClick={handleClaimToggle}
                        title="Claim this task for yourself"
                      >
                        <Hand size={13} /> Claim
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="field" style={{ marginTop: 12 }}>
              <label htmlFor="detail-notes">Progress / Blocker Notes</label>
              <textarea
                id="detail-notes"
                className="textarea"
                rows={3}
                placeholder="Add status updates, blockers, vendor info, or completion notes..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>

            {/* Sub-tasks inside Detail Modal */}
            {subTasks.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <div className="task-detail-section-label">Sub-tasks ({subTasks.length})</div>
                <div className="task-detail-sublist">
                  {subTasks.map(({ task: child, instance: childInst }) => {
                    const childDone = childInst?.status === 'completed';
                    return (
                      <button
                        key={child.id}
                        type="button"
                        className={`task-detail-subitem ${childDone ? 'done' : ''}`}
                        onClick={() =>
                          onSelectTarget({
                            instanceId: childInst?.id,
                            taskId: child.id,
                          })
                        }
                      >
                        <span className={`check-btn ${childDone ? 'checked' : ''}`} style={{ width: 18, height: 18 }}>
                          {childDone && <Check size={11} strokeWidth={3} />}
                        </span>
                        <span style={{ flex: 1, textAlign: 'left' }}>{child.title}</span>
                        {childInst?.dueDate && (
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                            {childInst.dueDate}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Footer */}
            <div className="task-detail-footer">
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {isAdHoc ? (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      onClose();
                      onEditAdHoc(resolvedInstance);
                    }}
                  >
                    <Edit3 size={14} /> Edit Full Record
                  </button>
                ) : resolvedTask ? (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      onClose();
                      onEditTask(resolvedTask);
                    }}
                  >
                    <Edit3 size={14} /> Edit Task Settings
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn btn-danger-ghost btn-sm"
                  disabled={saving}
                  onClick={handleDelete}
                  title="Delete"
                >
                  <Trash2 size={14} />
                </button>
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn btn-secondary" onClick={requestClose}>
                  Close
                </button>
                {isDirty ? (
                  <button type="submit" className="btn btn-primary" disabled={saving}>
                    {saving ? 'Saving...' : 'Save Updates'}
                  </button>
                ) : status !== 'completed' ? (
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={saving}
                    onClick={async () => {
                      setStatus('completed');
                      setSaving(true);
                      try {
                        const res = await api.completeInstance(resolvedInstance.id, true, notes.trim());
                        await onRefresh();
                        onToast(
                          res.nextInstance
                            ? `Done! Next cycle scheduled for ${res.nextInstance.dueDate}.`
                            : `Completed "${title}"!`,
                        );
                        onClose();
                      } catch (err: any) {
                        setError(err.message || 'Could not complete task.');
                      } finally {
                        setSaving(false);
                      }
                    }}
                  >
                    <Check size={15} /> Mark Complete
                  </button>
                ) : null}
              </div>
            </div>
          </form>
        ) : (
          /* Fallback for a Task Definition with no scheduled occurrence yet (e.g. weather task or paused task) */
          <div className="task-detail-status-box">
            <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', marginBottom: 12 }}>
              This task doesn’t have an active scheduled occurrence right now
              {resolvedTask?.active === false ? ' (currently paused)' : ''}. You can log it as done today or edit its schedule settings.
            </p>

            {recentHistory.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <div className="task-detail-section-label">Recent Completions</div>
                <div className="task-detail-sublist">
                  {recentHistory.map((h) => (
                    <div key={h.id} className="task-detail-subitem done" style={{ cursor: 'default' }}>
                      <CheckCircle2 size={14} style={{ color: 'var(--primary)' }} />
                      <span style={{ flex: 1 }}>
                        {h.completedBy || 'Member'} · {(h.completedAt || h.dueDate).slice(0, 10)}
                      </span>
                      {h.notes && <span style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>{h.notes}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="task-detail-footer">
              <div style={{ display: 'flex', gap: 6 }}>
                {resolvedTask && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      onClose();
                      onEditTask(resolvedTask);
                    }}
                  >
                    <Edit3 size={14} /> Edit Task Settings
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-danger-ghost btn-sm"
                  disabled={saving}
                  onClick={handleDelete}
                  title="Delete task"
                >
                  <Trash2 size={14} />
                </button>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn btn-secondary" onClick={requestClose}>
                  Close
                </button>
                {resolvedTask && (
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={saving}
                    onClick={handleQuickCompleteTask}
                  >
                    <Check size={15} /> Log Done Today
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
