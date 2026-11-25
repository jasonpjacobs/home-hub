import React, { useMemo, useState } from 'react';
import { Flame, Lock, Moon, Sparkles, Star, Sun, Sunrise, X } from 'lucide-react';
import type { Category, Member, Project, Task } from '../types';
import { CalendarDatePicker } from './CalendarDatePicker';
import { CategoryCombobox } from './CategoryCombobox';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const EFFORT_LEVELS = [
  { value: 1, label: 'Quick (1 pt) ~5m' },
  { value: 2, label: 'Light (2 pts) ~15m' },
  { value: 3, label: 'Medium (3 pts) ~30m' },
  { value: 5, label: 'Heavy (5 pts) ~60m' },
];

interface Props {
  task?: Task | null;
  defaultCategoryId?: string;
  defaultProjectId?: string;
  defaultParentTaskId?: string;
  defaultIsHabit?: boolean;
  activeDueDate?: string;
  categories: Category[];
  projects: Project[];
  allTasks: Task[];
  members: Member[];
  currentUser: Member;
  weatherTriggers: Array<{ id: string; label: string }>;
  todayStr: string;
  onClose: () => void;
  onCategoryCreated?: (cat: Category) => Promise<void> | void;
  onSave: (
    payload: Partial<Omit<Task, 'eligibleMemberIds'>> & {
      eligibleMemberIds?: string[];
      firstDueDate?: string;
    },
  ) => Promise<void>;
}

export function buildCategoryOptions(categories: Category[]) {
  const byId = new Map(categories.map((c) => [c.id, c]));
  return categories
    .map((c) => {
      const parts: string[] = [];
      let cur: Category | undefined = c;
      const seen = new Set<string>();
      while (cur && !seen.has(cur.id)) {
        seen.add(cur.id);
        parts.unshift(cur.name);
        cur = cur.parentCategoryId ? byId.get(cur.parentCategoryId) : undefined;
      }
      return { id: c.id, label: parts.join(' > '), visibility: c.visibility };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function TaskModal({
  task,
  defaultCategoryId,
  defaultProjectId,
  defaultParentTaskId,
  defaultIsHabit,
  activeDueDate,
  categories,
  projects,
  allTasks,
  members,
  currentUser,
  weatherTriggers,
  todayStr,
  onClose,
  onCategoryCreated,
  onSave,
}: Props) {
  const initialProject = !task && defaultProjectId
    ? projects.find((p) => p.id === defaultProjectId)
    : undefined;
  const initialCategory = !task && defaultCategoryId
    ? categories.find((c) => c.id === defaultCategoryId)
    : undefined;
  const initialIsHabit = Boolean(
    task ? task.isHabit : defaultIsHabit || (initialCategory && /habit/i.test(initialCategory.name)),
  );

  const initialVisibility: 'household' | 'private' =
    task?.visibility ||
    (initialProject?.visibility === 'private' ||
    initialCategory?.visibility === 'private' ||
    initialIsHabit
      ? 'private'
      : 'household');

  const existingHabitCat = categories.find(
    (c) =>
      (initialVisibility === 'private' ? c.visibility === 'private' : c.visibility !== 'private') &&
      /habit/i.test(c.name),
  );
  const fallbackCategory = categories.find((c) =>
    initialVisibility === 'private' ? c.visibility === 'private' : c.visibility !== 'private',
  );

  const initialCategoryId =
    task?.categoryId ||
    initialCategory?.id ||
    initialProject?.categoryId ||
    (initialIsHabit ? existingHabitCat?.id || '' : fallbackCategory?.id || '');

  const [title, setTitle] = useState(task?.title || '');
  const [description, setDescription] = useState(task?.description || '');
  const [visibility, setVisibility] = useState<'household' | 'private'>(initialVisibility);
  const [categoryId, setCategoryId] = useState(initialCategoryId);
  const [projectId, setProjectId] = useState(task?.projectId || initialProject?.id || '');
  const [parentTaskId, setParentTaskId] = useState(task?.parentTaskId || defaultParentTaskId || '');
  const [isFavorite, setIsFavorite] = useState(Boolean(task?.isFavorite));
  const [isHabit, setIsHabit] = useState(initialIsHabit);
  const [routineCue, setRoutineCue] = useState<NonNullable<Task['routineCue']>>(
    task?.routineCue || (initialIsHabit ? 'anytime' : ''),
  );
  const [effort, setEffort] = useState<number>(task?.effort || (initialIsHabit ? 1 : 2));

  const [cadenceMode, setCadenceMode] = useState<Task['cadenceMode']>(
    task?.cadenceMode || (initialProject || initialIsHabit ? 'strict_date' : 'flexible_window'),
  );
  const [recurrenceType, setRecurrenceType] = useState<Task['recurrenceType']>(
    task?.recurrenceType || (initialProject ? 'once' : initialIsHabit ? 'daily' : 'weekly'),
  );
  const [recurrenceInterval, setRecurrenceInterval] = useState<number>(
    task?.recurrenceInterval || 1,
  );
  const [selectedDays, setSelectedDays] = useState<string[]>(
    task?.recurrenceDays ? task.recurrenceDays.split(',').filter(Boolean) : ['Sat'],
  );
  const [targetSeason, setTargetSeason] = useState<Task['targetSeason']>(
    task?.targetSeason || 'fall',
  );
  const [weatherTrigger, setWeatherTrigger] = useState(task?.weatherTrigger || 'none');
  const [overduePolicy, setOverduePolicy] = useState<Task['overduePolicy']>(
    task?.overduePolicy || (initialIsHabit ? 'auto_skip' : 'carry_over'),
  );
  const [assignmentMode, setAssignmentMode] = useState<Task['assignmentMode']>(
    task?.assignmentMode || 'open_pool',
  );
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>(() => {
    if (task?.assignmentMode === 'fixed' && task.fixedMemberId) {
      return [task.fixedMemberId];
    }
    return task?.eligibleMemberIds ? task.eligibleMemberIds.split(',').filter(Boolean) : [];
  });
  const [dueDate, setDueDate] = useState(activeDueDate || initialProject?.targetDate || todayStr);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const categoryOptions = useMemo(() => {
    return buildCategoryOptions(categories).filter((c) =>
      visibility === 'private' ? c.visibility === 'private' : c.visibility !== 'private',
    );
  }, [categories, visibility]);

  const projectOptions = useMemo(() => {
    return projects.filter((p) =>
      visibility === 'private' ? p.visibility === 'private' : p.visibility !== 'private',
    );
  }, [projects, visibility]);

  // Prevent circular nesting by excluding self and descendants
  const parentTaskOptions = useMemo(() => {
    const blocked = new Set<string>();
    if (task) {
      blocked.add(task.id);
      let added = true;
      while (added) {
        added = false;
        for (const t of allTasks) {
          if (t.parentTaskId && blocked.has(t.parentTaskId) && !blocked.has(t.id)) {
            blocked.add(t.id);
            added = true;
          }
        }
      }
    }
    return allTasks.filter((t) => {
      if (blocked.has(t.id)) return false;
      if (visibility === 'private' ? t.visibility !== 'private' : t.visibility === 'private') {
        return false;
      }
      if (projectId) return t.projectId === projectId;
      return !t.projectId;
    });
  }, [allTasks, task, visibility, projectId]);

  function toggleDay(day: string) {
    setSelectedDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day],
    );
  }

  function toggleMember(id: string) {
    setSelectedMemberIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  const isProjectTask = Boolean(projectId);
  const isNonRecurring =
    isProjectTask || (cadenceMode !== 'weather_triggered' && recurrenceType === 'once');

  const isSingleSelected = selectedMemberIds.length === 1;
  const effectivePoolSize =
    selectedMemberIds.length === 0 ? members.filter((m) => m.active !== false).length : selectedMemberIds.length;
  const showDistributionRule = !isSingleSelected && effectivePoolSize >= 2 && !isNonRecurring;

  const effectiveAssignmentMode: Task['assignmentMode'] = isSingleSelected
    ? 'fixed'
    : isNonRecurring
      ? 'open_pool'
      : assignmentMode === 'fixed'
        ? 'open_pool'
        : assignmentMode;

  const effectiveFixedMemberId = isSingleSelected ? selectedMemberIds[0] : '';

  const selectionSummary = (() => {
    if (isSingleSelected) {
      const m = members.find((x) => x.id === selectedMemberIds[0]);
      return `Assigned directly to ${m ? m.name : 'selected member'}.`;
    }
    const poolLabel =
      selectedMemberIds.length === 0
        ? 'everyone in the household'
        : selectedMemberIds
            .map((id) => members.find((m) => m.id === id)?.name.split(' ')[0])
            .filter(Boolean)
            .join(', ');
    if (isNonRecurring) {
      return `Open to ${poolLabel} — anyone eligible can claim or complete it.`;
    }
    return `Applies to ${poolLabel}.`;
  })();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError('Task title is required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const finalIsHabit = !isProjectTask && isHabit;
      const finalCadenceMode: Task['cadenceMode'] = isProjectTask
        ? 'strict_date'
        : finalIsHabit
          ? 'strict_date'
          : cadenceMode;
      const finalRecurrenceType: Task['recurrenceType'] = isProjectTask
        ? 'once'
        : finalCadenceMode === 'weather_triggered'
          ? 'once'
          : finalIsHabit && recurrenceType === 'once'
            ? 'daily'
            : recurrenceType;
      const finalAssignMode: Task['assignmentMode'] =
        visibility === 'private' ? 'fixed' : effectiveAssignmentMode;

      await onSave({
        title: title.trim(),
        description: description.trim(),
        visibility,
        categoryId,
        projectId: finalIsHabit ? '' : projectId,
        parentTaskId,
        isFavorite,
        isHabit: finalIsHabit,
        routineCue: finalIsHabit ? routineCue || 'anytime' : '',
        needsDetails: false,
        effort,
        cadenceMode: finalCadenceMode,
        recurrenceType: finalRecurrenceType,
        recurrenceInterval,
        recurrenceDays:
          !isProjectTask &&
          finalCadenceMode === 'strict_date' &&
          (finalRecurrenceType === 'weekly' || finalRecurrenceType === 'biweekly')
            ? selectedDays.join(',')
            : '',
        targetSeason: !isProjectTask && finalRecurrenceType === 'seasonal' ? targetSeason : '',
        weatherTrigger:
          !isProjectTask && finalCadenceMode === 'weather_triggered' ? weatherTrigger : 'none',
        overduePolicy,
        assignmentMode: finalAssignMode,
        eligibleMemberIds: visibility === 'private' ? [currentUser.id] : selectedMemberIds,
        fixedMemberId:
          visibility === 'private' ? currentUser.id : effectiveFixedMemberId,
        firstDueDate: finalCadenceMode === 'strict_date' ? dueDate : undefined,
      });
      onClose();
    } catch (err: any) {
      setError(err.message || 'Could not save task.');
    } finally {
      setSaving(false);
    }
  }

  const isDirty = Boolean(
    title !== (task?.title || '') ||
      description !== (task?.description || '') ||
      categoryId !== initialCategoryId,
  );

  function activateHabitMode() {
    setIsHabit(true);
    setProjectId('');
    setWeatherTrigger('none');
    setCadenceMode('strict_date');
    setRecurrenceType('daily');
    setOverduePolicy('auto_skip');
    if (!routineCue) setRoutineCue('anytime');
    if (!task) {
      setVisibility('private');
      const privHabitCat = categories.find(
        (c) => c.visibility === 'private' && /habit/i.test(c.name),
      );
      setCategoryId(privHabitCat?.id || '');
    }
  }

  function handleCategoryChange(nextCatId: string) {
    setCategoryId(nextCatId);
    if (!task && nextCatId) {
      const matched = categories.find((c) => c.id === nextCatId);
      if (matched && /habit/i.test(matched.name) && !isHabit) {
        setIsHabit(true);
        setProjectId('');
        setWeatherTrigger('none');
        setCadenceMode('strict_date');
        setRecurrenceType('daily');
        setOverduePolicy('auto_skip');
        if (!routineCue) setRoutineCue('anytime');
      }
    }
  }

  function requestClose() {
    if (isDirty && !window.confirm('You have unsaved changes in this task. Discard them?')) {
      return;
    }
    onClose();
  }

  return (
    <div className="modal-backdrop" onClick={requestClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 16,
          }}
        >
          <h2>
            {task
              ? isHabit
                ? 'Edit Habit'
                : 'Edit Task'
              : isHabit
                ? 'Create Habit'
                : 'Create Task'}
          </h2>
          <button type="button" className="btn btn-ghost" onClick={requestClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {error && (
          <div className="banner error" style={{ marginBottom: 12 }}>
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="form-grid">
          <div className="field">
            <label htmlFor="task-title">{isHabit ? 'Habit Name' : 'Task Name'}</label>
            <input
              id="task-title"
              className="input"
              placeholder={
                isHabit
                  ? 'e.g., Use skin care product before bed'
                  : 'e.g., Clear irrigation lines before first snow'
              }
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              autoFocus
            />
          </div>

          <div className="field">
            <label htmlFor="task-desc">Notes / Checklist (optional)</label>
            <textarea
              id="task-desc"
              className="textarea"
              rows={2}
              placeholder="Helpful instructions for anyone doing this task"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {/* Visibility & Favorite */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div className="pill-group">
              <button
                type="button"
                className={`pill ${visibility === 'household' ? 'active' : ''}`}
                disabled={Boolean(task)}
                onClick={() => {
                  setVisibility('household');
                  setProjectId('');
                  setParentTaskId('');
                  const currentCat = categories.find((c) => c.id === categoryId);
                  if (!currentCat || currentCat.visibility === 'private') {
                    const firstShared = categories.find((c) => c.visibility !== 'private');
                    setCategoryId(firstShared?.id || '');
                  }
                }}
              >
                Shared Household
              </button>
              <button
                type="button"
                className={`pill ${visibility === 'private' ? 'active' : ''}`}
                disabled={Boolean(task)}
                onClick={() => {
                  setVisibility('private');
                  setProjectId('');
                  setParentTaskId('');
                  const currentCat = categories.find((c) => c.id === categoryId);
                  if (!currentCat || currentCat.visibility !== 'private') {
                    const firstPriv = categories.find((c) => c.visibility === 'private');
                    setCategoryId(firstPriv?.id || '');
                  }
                }}
              >
                <Lock size={12} /> Private (Personal Sheet)
              </button>
            </div>

            <button
              type="button"
              className={`pill ${isFavorite ? 'active' : ''}`}
              onClick={() => setIsFavorite((f) => !f)}
            >
              <Star size={12} /> {isFavorite ? 'Pinned on Cockpit' : 'Pin as Favorite'}
            </button>
          </div>

          {/* Category & Project (or Routine Cue for Habits) */}
          <div className="form-row-2">
            <div className="field">
              <label htmlFor="task-cat">Category</label>
              <CategoryCombobox
                id="task-cat"
                categories={categories}
                value={categoryId}
                onChange={handleCategoryChange}
                visibility={visibility}
                onCategoryCreated={onCategoryCreated}
                placeholder={
                  isHabit ? 'Habit Building (auto-created if blank)' : 'Type or select category...'
                }
                emptyLabel={isHabit ? 'Habit Building (auto)' : 'No category'}
              />
            </div>

            {isHabit ? (
              <div className="field">
                <label>Routine Cue</label>
                <div className="pill-group" style={{ paddingTop: 2 }}>
                  {(
                    [
                      ['morning', 'Morning', <Sunrise key="m" size={12} />],
                      ['afternoon', 'Afternoon', <Sun key="a" size={12} />],
                      ['evening', 'Evening', <Moon key="e" size={12} />],
                      ['anytime', 'Anytime', <Sparkles key="x" size={12} />],
                    ] as Array<[NonNullable<Task['routineCue']>, string, React.ReactNode]>
                  ).map(([val, label, icon]) => (
                    <button
                      key={val}
                      type="button"
                      className={`pill ${(routineCue || 'anytime') === val ? 'active' : ''}`}
                      style={{ padding: '5px 9px', fontSize: '0.78rem' }}
                      onClick={() => setRoutineCue(val)}
                    >
                      {icon} {label}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="field">
                <label htmlFor="task-proj">Project (optional)</label>
                <select
                  id="task-proj"
                  className="select"
                  value={projectId}
                  onChange={(e) => {
                    const nextProjId = e.target.value;
                    setProjectId(nextProjId);
                    setParentTaskId('');
                    const matchedProj = projects.find((p) => p.id === nextProjId);
                    if (matchedProj?.categoryId) {
                      setCategoryId(matchedProj.categoryId);
                    }
                    if (nextProjId && !task) {
                      setCadenceMode('strict_date');
                      setRecurrenceType('once');
                    }
                  }}
                >
                  <option value="">None (Standalone Task)</option>
                  {projectOptions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Parent Task Hierarchy & Optional Effort */}
          <div className={currentUser.showEffortAndFairness ? 'form-row-2' : undefined}>
            <div className="field">
              <label htmlFor="task-parent">Parent Task (optional sub-task nesting)</label>
              <select
                id="task-parent"
                className="select"
                value={parentTaskId}
                onChange={(e) => setParentTaskId(e.target.value)}
              >
                <option value="">Top-level {projectId ? 'Project Task' : 'Task'}</option>
                {parentTaskOptions.map((pt) => (
                  <option key={pt.id} value={pt.id}>
                    Under: {pt.title}
                  </option>
                ))}
              </select>
            </div>

            {currentUser.showEffortAndFairness && (
              <div className="field">
                <label htmlFor="task-effort">Effort Weight</label>
                <select
                  id="task-effort"
                  className="select"
                  value={effort}
                  onChange={(e) => setEffort(Number(e.target.value))}
                >
                  {EFFORT_LEVELS.map((e) => (
                    <option key={e.value} value={e.value}>
                      {e.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Task Kind & Schedule (only for standalone tasks; Project tasks are non-recurring) */}
          {!isProjectTask && (
            <>
              <div className="field">
                <label>Task Type</label>
                <div className="tabs-bar" style={{ marginBottom: 0 }}>
                  <button
                    type="button"
                    className={`tab-btn ${!isHabit && cadenceMode !== 'weather_triggered' && recurrenceType === 'once' ? 'active' : ''}`}
                    onClick={() => {
                      setIsHabit(false);
                      setCadenceMode('strict_date');
                      setRecurrenceType('once');
                      setWeatherTrigger('none');
                      if (!task && overduePolicy === 'auto_skip') setOverduePolicy('carry_over');
                    }}
                  >
                    One-Off Task
                  </button>
                  <button
                    type="button"
                    className={`tab-btn ${!isHabit && cadenceMode !== 'weather_triggered' && recurrenceType !== 'once' ? 'active' : ''}`}
                    onClick={() => {
                      setIsHabit(false);
                      if (cadenceMode === 'weather_triggered') setCadenceMode('flexible_window');
                      if (recurrenceType === 'once') setRecurrenceType('weekly');
                      setWeatherTrigger('none');
                    }}
                  >
                    Recurring Task
                  </button>
                  <button
                    type="button"
                    className={`tab-btn ${isHabit ? 'active' : ''}`}
                    onClick={activateHabitMode}
                  >
                    <Flame size={13} style={{ verticalAlign: '-2px', marginRight: 3 }} />
                    Habit
                  </button>
                  <button
                    type="button"
                    className={`tab-btn ${!isHabit && cadenceMode === 'weather_triggered' ? 'active' : ''}`}
                    onClick={() => {
                      setIsHabit(false);
                      setCadenceMode('weather_triggered');
                      if (weatherTrigger === 'none') setWeatherTrigger('rain_soon');
                    }}
                  >
                    Weather-Triggered
                  </button>
                </div>
                {isHabit && (
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 6 }}>
                    Habits appear in your <strong>Daily Habits</strong> check-in strip with a 7-day consistency bar &amp; streak, and auto-skip cleanly if missed.
                  </div>
                )}
              </div>

              {isHabit ? (
                <div className="form-row-2">
                  <div className="field">
                    <label htmlFor="task-rec">Habit Cadence</label>
                    <select
                      id="task-rec"
                      className="select"
                      value={recurrenceType}
                      onChange={(e) => setRecurrenceType(e.target.value as Task['recurrenceType'])}
                    >
                      <option value="daily">Every Day</option>
                      <option value="weekly">Specific Days of Week</option>
                      <option value="custom_days">Every N Days</option>
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="task-overdue">If Missed</label>
                    <select
                      id="task-overdue"
                      className="select"
                      value={overduePolicy}
                      onChange={(e) => setOverduePolicy(e.target.value as Task['overduePolicy'])}
                    >
                      <option value="auto_skip">Auto-Skip (recommended — no overdue guilt)</option>
                      <option value="roll_forward">Roll Forward to Today</option>
                      <option value="carry_over">Carry Over (mark overdue)</option>
                    </select>
                  </div>
                </div>
              ) : cadenceMode === 'weather_triggered' ? (
                <div className="field">
                  <label htmlFor="task-weather">Weather Condition</label>
                  <select
                    id="task-weather"
                    className="select"
                    value={weatherTrigger}
                    onChange={(e) => setWeatherTrigger(e.target.value)}
                  >
                    {weatherTriggers
                      .filter((w) => w.id !== 'none')
                      .map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.label}
                        </option>
                      ))}
                  </select>
                </div>
              ) : recurrenceType !== 'once' ? (
                <div className="form-row-2">
                  <div className="field">
                    <label htmlFor="task-cadence">Scheduling Style</label>
                    <select
                      id="task-cadence"
                      className="select"
                      value={cadenceMode}
                      onChange={(e) => setCadenceMode(e.target.value as Task['cadenceMode'])}
                    >
                      <option value="flexible_window">Flexible Window (anytime in period)</option>
                      <option value="strict_date">Strict Due Date(s)</option>
                    </select>
                  </div>

                  <div className="field">
                    <label htmlFor="task-rec">Recurrence Cadence</label>
                    <select
                      id="task-rec"
                      className="select"
                      value={recurrenceType}
                      onChange={(e) => setRecurrenceType(e.target.value as Task['recurrenceType'])}
                    >
                      <option value="daily">Daily</option>
                      <option value="weekly">Weekly</option>
                      <option value="biweekly">Every 2 Weeks</option>
                      <option value="monthly">Monthly</option>
                      <option value="quarterly">Quarterly</option>
                      <option value="seasonal">Seasonal (Spring/Summer/Fall/Winter)</option>
                      <option value="yearly">Yearly</option>
                      <option value="custom_days">Every N Days</option>
                    </select>
                  </div>
                </div>
              ) : null}

              {cadenceMode === 'strict_date' &&
                (recurrenceType === 'weekly' || recurrenceType === 'biweekly') && (
                  <div className="field">
                    <label>Days of Week</label>
                    <div className="day-chips">
                      {WEEKDAYS.map((day) => (
                        <button
                          key={day}
                          type="button"
                          className={`day-chip ${selectedDays.includes(day) ? 'selected' : ''}`}
                          onClick={() => toggleDay(day)}
                        >
                          {day}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

              {cadenceMode !== 'weather_triggered' && recurrenceType === 'seasonal' && (
                <div className="field">
                  <label htmlFor="task-season">Target Season</label>
                  <select
                    id="task-season"
                    className="select"
                    value={targetSeason}
                    onChange={(e) => setTargetSeason(e.target.value as Task['targetSeason'])}
                  >
                    <option value="spring">Spring (Mar–May)</option>
                    <option value="summer">Summer (Jun–Aug)</option>
                    <option value="fall">Fall (Sep–Nov)</option>
                    <option value="winter">Winter (Dec–Feb)</option>
                  </select>
                </div>
              )}

              {cadenceMode !== 'weather_triggered' &&
                (recurrenceType === 'custom_days' || recurrenceType === 'monthly') && (
                  <div className="field">
                    <label htmlFor="task-int">
                      {recurrenceType === 'monthly' ? 'Day of Month (1–28)' : 'Repeat Every (Days)'}
                    </label>
                    <input
                      id="task-int"
                      type="number"
                      min={1}
                      max={recurrenceType === 'monthly' ? 28 : 180}
                      className="input"
                      value={recurrenceInterval}
                      onChange={(e) => setRecurrenceInterval(Number(e.target.value))}
                    />
                  </div>
                )}
            </>
          )}

          {!isHabit && (
            <div className={isProjectTask || cadenceMode === 'strict_date' ? 'form-row-2' : undefined}>
              <div className="field">
                <label htmlFor="task-overdue">If Missed / Overdue Behavior</label>
                <select
                  id="task-overdue"
                  className="select"
                  value={overduePolicy}
                  onChange={(e) => setOverduePolicy(e.target.value as Task['overduePolicy'])}
                >
                  <option value="carry_over">Carry Over (Must be done — e.g. Pay mortgage)</option>
                  <option value="roll_forward">Roll Forward (Slide cleanly to next window)</option>
                  <option value="auto_skip">Auto-Skip (Skip if missed — e.g. Shoulder PT)</option>
                </select>
              </div>

              {(isProjectTask || cadenceMode === 'strict_date') && (
                <div className="field">
                  <label htmlFor="task-due">{task || isProjectTask ? 'Due Date' : 'First Due Date'}</label>
                  <CalendarDatePicker
                    id="task-due"
                    value={dueDate}
                    onChange={setDueDate}
                    align="right"
                    placement="up"
                  />
                </div>
              )}
            </div>
          )}

          {visibility === 'household' && (
            <>
              <div className="field">
                <label>Who Can Do This</label>
                <div className="day-chips">
                  <button
                    type="button"
                    className={`day-chip ${selectedMemberIds.length === 0 ? 'selected' : ''}`}
                    onClick={() => setSelectedMemberIds([])}
                  >
                    Everyone
                  </button>
                  {members.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      className={`day-chip ${selectedMemberIds.includes(m.id) ? 'selected' : ''}`}
                      onClick={() => toggleMember(m.id)}
                    >
                      {m.name.split(' ')[0]} ({m.memberGroup})
                    </button>
                  ))}
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 6 }}>
                  {selectionSummary}
                </div>
              </div>

              {showDistributionRule && (
                <div className="field">
                  <label htmlFor="task-assign">How to Assign Each Cycle</label>
                  <select
                    id="task-assign"
                    className="select"
                    value={effectiveAssignmentMode}
                    onChange={(e) => setAssignmentMode(e.target.value as Task['assignmentMode'])}
                  >
                    <option value="open_pool">Anyone (any eligible person can claim or complete)</option>
                    <option value="round_robin">Round-Robin Rotation (take turns in order)</option>
                    {currentUser.showEffortAndFairness && (
                      <option value="auto_balanced">Fair Effort Auto-Balance (lowest load gets next)</option>
                    )}
                  </select>
                </div>
              )}
            </>
          )}

          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 10,
              marginTop: 6,
              paddingTop: 14,
              borderTop: '1px solid var(--border)',
            }}
          >
            <button type="button" className="btn btn-secondary" onClick={requestClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving
                ? 'Saving...'
                : task
                  ? isHabit
                    ? 'Save Habit'
                    : 'Save Task'
                  : isHabit
                    ? 'Create Habit'
                    : 'Create Task'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
