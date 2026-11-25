import React, { useEffect, useMemo, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  CornerDownRight,
  Edit3,
  FolderKanban,
  GripVertical,
  Hand,
  Lock,
  Plus,
  Trash2,
} from 'lucide-react';
import { api } from '../api';
import type { DashboardData, Project, Task } from '../types';
import { buildCategoryOptions } from './TaskModal';
import { CalendarDatePicker } from './CalendarDatePicker';
import { CategoryCombobox } from './CategoryCombobox';
import { DeferMenu } from './DeferMenu';
import { StatusBadge, StatusNotePopover, type ActiveStatus } from './StatusNotePopover';
import type { DetailTarget } from './TaskDetailModal';

interface Props {
  data: DashboardData;
  onRefresh: () => Promise<void>;
  onToast: (msg: string) => void;
  onCompleteInstance: (id: string, completed?: boolean) => Promise<void>;
  onClaimInstance: (id: string) => Promise<void>;
  onDeferInstance: (id: string, payload: { days?: number; untilDate?: string }) => Promise<void>;
  onUpdateInstanceStatus: (
    id: string,
    payload: { status: ActiveStatus; notes: string; dueDate?: string },
  ) => Promise<void>;
  onOpenDetail: (target: DetailTarget) => void;
  onEditTask: (task: Task) => void;
  onDeleteTask: (id: string) => Promise<void>;
  onAddProjectTaskModal: (projectId: string, parentTaskId?: string, categoryId?: string) => void;
}

const PROJECT_DRAFT_KEY = 'homehub_new_project_draft';

function loadProjectDraft() {
  try {
    const raw = window.localStorage.getItem(PROJECT_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && (parsed.title || parsed.description || parsed.targetDate)) return parsed;
  } catch {
    // ignore
  }
  return null;
}

export function ProjectsView({
  data,
  onRefresh,
  onToast,
  onCompleteInstance,
  onClaimInstance,
  onDeferInstance,
  onUpdateInstanceStatus,
  onOpenDetail,
  onEditTask,
  onDeleteTask,
  onAddProjectTaskModal,
}: Props) {
  const initialDraft = useMemo(() => loadProjectDraft(), []);
  const [selectedId, setSelectedId] = useState<string>(data.projects[0]?.id || '');
  const [showNewForm, setShowNewForm] = useState(Boolean(initialDraft));
  const [saving, setSaving] = useState(false);
  const [groupMode, setGroupMode] = useState<'tree' | 'category'>('tree');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropState, setDropState] = useState<{ targetId: string; zone: 'before' | 'inside' | 'after' } | null>(null);
  const [rootDropActive, setRootDropActive] = useState(false);

  // New project fields (auto-saved as draft in localStorage so navigating away never loses work!)
  const [pTitle, setPTitle] = useState<string>(initialDraft?.title || '');
  const [pDesc, setPDesc] = useState<string>(initialDraft?.description || '');
  const [pTarget, setPTarget] = useState<string>(initialDraft?.targetDate || '');
  const [pCategoryId, setPCategoryId] = useState<string>(initialDraft?.categoryId || 'cat_projects');
  const [pLead, setPLead] = useState<string>(initialDraft?.leadMemberId ?? data.user.id);
  const [pVisibility, setPVisibility] = useState<'household' | 'private'>(
    initialDraft?.visibility === 'private' ? 'private' : 'household',
  );

  const hasProjectDraft = Boolean(pTitle.trim() || pDesc.trim() || pTarget);

  useEffect(() => {
    try {
      if (hasProjectDraft) {
        window.localStorage.setItem(
          PROJECT_DRAFT_KEY,
          JSON.stringify({
            title: pTitle,
            description: pDesc,
            targetDate: pTarget,
            categoryId: pCategoryId,
            leadMemberId: pLead,
            visibility: pVisibility,
          }),
        );
      } else {
        window.localStorage.removeItem(PROJECT_DRAFT_KEY);
      }
    } catch {
      // ignore
    }
  }, [hasProjectDraft, pTitle, pDesc, pTarget, pCategoryId, pLead, pVisibility]);

  function clearProjectDraft() {
    setPTitle('');
    setPDesc('');
    setPTarget('');
    setPCategoryId('cat_projects');
    setPLead(data.user.id);
    setPVisibility('household');
    try {
      window.localStorage.removeItem(PROJECT_DRAFT_KEY);
    } catch {
      // ignore
    }
  }

  function handleCancelNewProject() {
    if (hasProjectDraft && !window.confirm('Discard your unsaved new project draft?')) {
      return;
    }
    clearProjectDraft();
    setShowNewForm(false);
  }

  // Inline project edit state (title/description)
  const [editingProjectInfo, setEditingProjectInfo] = useState(false);
  const [editProjTitle, setEditProjTitle] = useState('');
  const [editProjDesc, setEditProjDesc] = useState('');

  // Inline quick-add step fields
  const [stepTitle, setStepTitle] = useState('');
  const [stepCategoryId, setStepCategoryId] = useState('');
  const [stepParentId, setStepParentId] = useState('');
  const [stepAssignee, setStepAssignee] = useState('');
  const [stepDue, setStepDue] = useState(data.todayStr);

  const memberMap = useMemo(() => new Map(data.members.map((m) => [m.id, m])), [data.members]);
  const categoryOptions = useMemo(() => buildCategoryOptions(data.categories), [data.categories]);
  const catLabelMap = useMemo(
    () => new Map(categoryOptions.map((c) => [c.id, c.label])),
    [categoryOptions],
  );

  const enriched = useMemo(() => {
    return data.projects.map((p) => {
      const steps = data.tasks
        .filter((t) => t.projectId === p.id)
        .sort((a, b) => (a.stepOrder || 0) - (b.stepOrder || 0));
      const instMap = new Map(
        data.instances.filter((i) => i.projectId === p.id).map((i) => [i.taskId, i]),
      );
      const doneCount = steps.filter((s) => instMap.get(s.id)?.status === 'completed').length;
      const openDueDates = steps
        .map((s) => instMap.get(s.id))
        .filter((inst) => inst && inst.status !== 'completed' && inst.status !== 'skipped' && inst.dueDate)
        .map((inst) => inst!.dueDate)
        .sort();
      const nextDueDate = openDueDates[0] || '';
      return { project: p, steps, instMap, doneCount, nextDueDate };
    });
  }, [data.projects, data.tasks, data.instances]);

  const selected = enriched.find((e) => e.project.id === selectedId) || enriched[0] || null;

  // Keep inline Add Task default category synced with the selected project's category
  useEffect(() => {
    setStepCategoryId(selected?.project.categoryId || '');
  }, [selected?.project.id, selected?.project.categoryId]);

  const projectCategories = useMemo(() => {
    if (!selected) return [];
    return categoryOptions.filter((c) =>
      selected.project.visibility === 'private'
        ? c.visibility === 'private'
        : c.visibility !== 'private',
    );
  }, [categoryOptions, selected]);

  // Used categories inside selected project for filtering
  const usedCategoryIds = useMemo(() => {
    if (!selected) return [];
    const set = new Set(selected.steps.map((s) => s.categoryId).filter(Boolean));
    return Array.from(set);
  }, [selected]);

  // Build parent -> children tree inside selected project
  const { rootSteps, childrenByParent } = useMemo(() => {
    if (!selected) return { rootSteps: [] as Task[], childrenByParent: new Map<string, Task[]>() };
    const filtered =
      categoryFilter === 'all'
        ? selected.steps
        : selected.steps.filter((s) => s.categoryId === categoryFilter);
    const idSet = new Set(filtered.map((s) => s.id));
    const byParent = new Map<string, Task[]>();
    const roots: Task[] = [];
    for (const s of filtered) {
      if (s.parentTaskId && idSet.has(s.parentTaskId)) {
        const list = byParent.get(s.parentTaskId) || [];
        list.push(s);
        byParent.set(s.parentTaskId, list);
      } else {
        roots.push(s);
      }
    }
    return { rootSteps: roots, childrenByParent: byParent };
  }, [selected, categoryFilter]);

  // Group by category for Category view mode
  const stepsByCategory = useMemo(() => {
    if (!selected) return [];
    const groups = new Map<string, Task[]>();
    for (const s of selected.steps) {
      if (categoryFilter !== 'all' && s.categoryId !== categoryFilter) continue;
      const key = s.categoryId || '__none__';
      const list = groups.get(key) || [];
      list.push(s);
      groups.set(key, list);
    }
    return Array.from(groups.entries()).map(([catId, tasks]) => ({
      catId,
      label: catId === '__none__' ? 'Uncategorized' : catLabelMap.get(catId) || 'General',
      tasks,
    }));
  }, [selected, categoryFilter, catLabelMap]);

  async function handleCreateProject(e: React.FormEvent) {
    e.preventDefault();
    if (!pTitle.trim()) return;
    setSaving(true);
    try {
      const res = await api.createProject({
        title: pTitle.trim(),
        description: pDesc.trim(),
        categoryId: pCategoryId,
        targetDate: pTarget,
        leadMemberId: pVisibility === 'private' ? data.user.id : pLead,
        visibility: pVisibility,
        status: 'active',
      });
      clearProjectDraft();
      setShowNewForm(false);
      setSelectedId(res.project.id);
      await onRefresh();
      onToast(`Created project "${res.project.title}"`);
    } catch (err: any) {
      onToast(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleAddStep(e: React.FormEvent) {
    e.preventDefault();
    if (!selected || !stepTitle.trim()) return;
    setSaving(true);
    try {
      await api.addProjectStep(selected.project.id, {
        title: stepTitle.trim(),
        categoryId: stepCategoryId || selected.project.categoryId,
        parentTaskId: stepParentId || '',
        dueDate: stepDue || selected.project.targetDate || data.todayStr,
        assignmentMode: stepAssignee ? 'fixed' : 'open_pool',
        fixedMemberId: stepAssignee || undefined,
      });
      setStepTitle('');
      setStepParentId('');
      await onRefresh();
      onToast('Added project task!');
    } catch (err: any) {
      onToast(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleStatusChange(project: Project, status: Project['status']) {
    await api.updateProject(project.id, { status });
    await onRefresh();
    onToast(`Project status set to ${status}.`);
  }

  async function handleLeadChange(project: Project, leadMemberId: string) {
    await api.updateProject(project.id, { leadMemberId });
    await onRefresh();
    const m = leadMemberId ? memberMap.get(leadMemberId) : null;
    onToast(m ? `Project lead set to ${m.name.split(' ')[0]}.` : 'Project set to shared (no lead).');
  }

  async function handleTargetDateChange(project: Project, targetDate: string) {
    await api.updateProject(project.id, { targetDate });
    await onRefresh();
    onToast(targetDate ? `Target date updated to ${targetDate}.` : 'Cleared project target date.');
  }

  async function handleProjectCategoryChange(project: Project, categoryId: string) {
    await api.updateProject(project.id, { categoryId });
    await onRefresh();
    onToast('Updated project default category.');
  }

  async function handleSaveProjectInfo(e: React.FormEvent) {
    e.preventDefault();
    if (!selected || !editProjTitle.trim()) return;
    setSaving(true);
    try {
      await api.updateProject(selected.project.id, {
        title: editProjTitle.trim(),
        description: editProjDesc.trim(),
      });
      setEditingProjectInfo(false);
      await onRefresh();
      onToast('Updated project details.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteProject(id: string) {
    await api.deleteProject(id);
    await onRefresh();
    onToast('Deleted project and its tasks.');
  }

  function isDescendant(candidateId: string, ancestorId: string): boolean {
    if (!selected) return false;
    const byId = new Map(selected.steps.map((s) => [s.id, s]));
    let cur = byId.get(candidateId);
    const seen = new Set<string>();
    while (cur && !seen.has(cur.id)) {
      if (cur.id === ancestorId) return true;
      seen.add(cur.id);
      cur = cur.parentTaskId ? byId.get(cur.parentTaskId) : undefined;
    }
    return false;
  }

  async function handleDropTask(targetTask: Task, zone: 'before' | 'inside' | 'after') {
    if (!selected || !draggedId || draggedId === targetTask.id) return;
    if (isDescendant(targetTask.id, draggedId)) {
      onToast('Cannot move a task inside one of its own sub-tasks.');
      return;
    }

    const newParentId = zone === 'inside' ? targetTask.id : targetTask.parentTaskId || '';
    const siblings = selected.steps
      .filter((s) => (s.parentTaskId || '') === newParentId && s.id !== draggedId)
      .sort((a, b) => (a.stepOrder || 0) - (b.stepOrder || 0));

    let insertIdx = siblings.length;
    if (zone !== 'inside') {
      const targetIdx = siblings.findIndex((s) => s.id === targetTask.id);
      if (targetIdx !== -1) insertIdx = zone === 'before' ? targetIdx : targetIdx + 1;
    }

    const draggedTask = selected.steps.find((s) => s.id === draggedId);
    if (!draggedTask) return;
    siblings.splice(insertIdx, 0, draggedTask);

    const updates = siblings.map((s, idx) => ({
      id: s.id,
      parentTaskId: newParentId,
      stepOrder: idx + 1,
    }));

    setDraggedId(null);
    setDropState(null);
    await api.reorderTasks(updates);
    if (zone === 'inside') {
      setCollapsed((p) => ({ ...p, [targetTask.id]: false }));
    }
    await onRefresh();
    onToast(
      zone === 'inside'
        ? `Nested "${draggedTask.title}" under "${targetTask.title}".`
        : `Reordered "${draggedTask.title}".`,
    );
  }

  async function handleDropToRoot() {
    if (!selected || !draggedId) return;
    const draggedTask = selected.steps.find((s) => s.id === draggedId);
    if (!draggedTask) return;
    const roots = selected.steps
      .filter((s) => !s.parentTaskId && s.id !== draggedId)
      .sort((a, b) => (a.stepOrder || 0) - (b.stepOrder || 0));
    roots.unshift(draggedTask);
    const updates = roots.map((s, idx) => ({
      id: s.id,
      parentTaskId: '',
      stepOrder: idx + 1,
    }));
    setDraggedId(null);
    setDropState(null);
    setRootDropActive(false);
    await api.reorderTasks(updates);
    await onRefresh();
    onToast(`Moved "${draggedTask.title}" to top level.`);
  }

  function renderStepNode(step: Task, depth = 0) {
    if (!selected) return null;
    const inst = selected.instMap.get(step.id);
    const isDone = inst?.status === 'completed';
    const children = childrenByParent.get(step.id) || [];
    const isCollapsed = collapsed[step.id];
    const catLabel = catLabelMap.get(step.categoryId) || '';
    const isDragging = draggedId === step.id;
    const activeZone = dropState?.targetId === step.id ? dropState.zone : null;

    return (
      <div key={step.id}>
        <div
          draggable
          onDragStart={(e) => {
            setDraggedId(step.id);
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', step.id);
          }}
          onDragEnd={() => {
            setDraggedId(null);
            setDropState(null);
            setRootDropActive(false);
          }}
          onDragOver={(e) => {
            if (!draggedId || draggedId === step.id || isDescendant(step.id, draggedId)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            const rect = e.currentTarget.getBoundingClientRect();
            const ratio = (e.clientY - rect.top) / rect.height;
            const zone: 'before' | 'inside' | 'after' =
              ratio < 0.28 ? 'before' : ratio > 0.72 ? 'after' : 'inside';
            if (dropState?.targetId !== step.id || dropState?.zone !== zone) {
              setDropState({ targetId: step.id, zone });
            }
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) {
              if (dropState?.targetId === step.id) setDropState(null);
            }
          }}
          onDrop={(e) => {
            e.preventDefault();
            if (dropState && dropState.targetId === step.id) {
              handleDropTask(step, dropState.zone);
            }
          }}
          className={`assignment-row ${isDone ? 'completed' : ''} ${isDragging ? 'dragging' : ''} ${activeZone ? `drop-${activeZone}` : ''}`}
          style={{
            marginLeft: depth * 26,
            borderLeft: depth > 0 ? '3px solid var(--border-strong)' : undefined,
          }}
        >
          <span className="drag-handle" title="Drag to reorder or drop onto a task to nest">
            <GripVertical size={15} />
          </span>

          {children.length > 0 ? (
            <button
              type="button"
              className="btn btn-ghost"
              style={{ padding: 2 }}
              onClick={() => setCollapsed((p) => ({ ...p, [step.id]: !p[step.id] }))}
              title={isCollapsed ? 'Expand sub-tasks' : 'Collapse sub-tasks'}
            >
              {isCollapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
            </button>
          ) : null}

          <button
            type="button"
            className={`check-btn ${isDone ? 'checked' : ''}`}
            onClick={() => inst && onCompleteInstance(inst.id, !isDone)}
            disabled={!inst}
          >
            {isDone && <Check size={14} strokeWidth={3} />}
          </button>

          <div
            className="assignment-main clickable-main"
            onClick={() => onOpenDetail({ instanceId: inst?.id, taskId: step.id })}
            title="Click to view details & update status"
          >
            <div className="assignment-title">
              <span className="clickable-title">{step.title}</span>
              {inst && <StatusBadge status={inst.status} />}
              {catLabel && <span className="tag">{catLabel}</span>}
              {children.length > 0 && (
                <span className="tag primary">
                  {children.filter((c) => selected.instMap.get(c.id)?.status === 'completed').length}/
                  {children.length} sub-tasks
                </span>
              )}
            </div>
            {inst?.notes && <div className="instance-note">{inst.notes}</div>}
            {step.description && (
              <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: 2 }}>
                {step.description}
              </p>
            )}
            <div className="assignment-meta">
              {inst?.dueDate && <span>Due {inst.dueDate}</span>}
              {inst?.assigneeName ? (
                <span>&middot; Assigned to {inst.assigneeName}</span>
              ) : (
                <span>&middot; Anyone</span>
              )}
              {isDone && inst?.completedBy && <span>&middot; Done by {inst.completedBy}</span>}
            </div>
          </div>

          <div className="assignment-controls">
            {inst && !isDone && !inst.assigneeId && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => onClaimInstance(inst.id)}
              >
                <Hand size={13} /> Claim
              </button>
            )}
            {inst && !isDone && (
              <>
                <StatusNotePopover
                  instance={inst}
                  onSave={(payload) => onUpdateInstanceStatus(inst.id, payload)}
                />
                <DeferMenu
                  minDate={data.todayStr}
                  onDefer={(payload) => onDeferInstance(inst.id, payload)}
                />
              </>
            )}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() =>
                onAddProjectTaskModal(selected.project.id, step.id, step.categoryId || selected.project.categoryId)
              }
              title="Add sub-task under this task"
            >
              <CornerDownRight size={14} /> Sub-task
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => onEditTask(step)}
              title="Edit task"
            >
              <Edit3 size={14} /> Edit
            </button>
            <button
              type="button"
              className="btn btn-danger-ghost btn-sm"
              onClick={() => onDeleteTask(step.id)}
              title="Delete task"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>

        {!isCollapsed && children.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
            {children.map((child) => renderStepNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Projects</h1>
          <p className="page-subtitle">
            Break large non-recurring initiatives into nested tasks &amp; categories that flow into
            your Daily Cockpit &amp; reminders.
          </p>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setShowNewForm((v) => !v)}
          >
            <Plus size={16} /> {hasProjectDraft && !showNewForm ? 'Resume Project Draft' : 'New Project'}
          </button>
        </div>
      </div>

      {showNewForm && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3>Create Project</h3>
            {hasProjectDraft && <span className="tag primary">Draft auto-saved</span>}
          </div>
          <form onSubmit={handleCreateProject} className="form-grid">
            <div className="form-row-2">
              <div className="field">
                <label htmlFor="proj-title">Project Name</label>
                <input
                  id="proj-title"
                  className="input"
                  placeholder="e.g., Plan Summer Camping Trip"
                  value={pTitle}
                  onChange={(e) => setPTitle(e.target.value)}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="proj-target">Target Completion Date (optional)</label>
                <CalendarDatePicker
                  id="proj-target"
                  value={pTarget}
                  onChange={setPTarget}
                  placeholder="Pick target date"
                  clearable
                  align="right"
                />
              </div>
            </div>
            <div className="form-row-2">
              <div className="field">
                <label htmlFor="proj-cat">Default Category</label>
                <CategoryCombobox
                  id="proj-cat"
                  categories={data.categories}
                  value={pCategoryId}
                  onChange={setPCategoryId}
                  visibility={pVisibility}
                  onCategoryCreated={async () => {
                    await onRefresh();
                  }}
                  placeholder="Type or select category..."
                />
              </div>

              {pVisibility === 'household' ? (
                <div className="field">
                  <label htmlFor="proj-lead">Project Lead</label>
                  <select
                    id="proj-lead"
                    className="select"
                    value={pLead}
                    onChange={(e) => setPLead(e.target.value)}
                  >
                    <option value="">No Lead (Shared)</option>
                    {data.members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} ({m.memberGroup})
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="field">
                  <label htmlFor="proj-desc">Description</label>
                  <input
                    id="proj-desc"
                    className="input"
                    placeholder="Goal, notes, or key outcome"
                    value={pDesc}
                    onChange={(e) => setPDesc(e.target.value)}
                  />
                </div>
              )}
            </div>

            {pVisibility === 'household' && (
              <div className="field">
                <label htmlFor="proj-desc">Description</label>
                <input
                  id="proj-desc"
                  className="input"
                  placeholder="Goal, notes, or key outcome"
                  value={pDesc}
                  onChange={(e) => setPDesc(e.target.value)}
                />
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
              <div className="pill-group">
                <button
                  type="button"
                  className={`pill ${pVisibility === 'household' ? 'active' : ''}`}
                  onClick={() => {
                    setPVisibility('household');
                    setPCategoryId('cat_projects');
                  }}
                >
                  Shared Household Project
                </button>
                <button
                  type="button"
                  className={`pill ${pVisibility === 'private' ? 'active' : ''}`}
                  onClick={() => {
                    setPVisibility('private');
                    const firstPriv = data.categories.find((c) => c.visibility === 'private');
                    setPCategoryId(firstPriv?.id || '');
                  }}
                >
                  <Lock size={12} /> Private (Personal Sheet)
                </button>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn btn-secondary" onClick={handleCancelNewProject}>
                  {hasProjectDraft ? 'Discard Draft' : 'Cancel'}
                </button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  Create Project
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {enriched.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
          No projects yet. Create one to break a big goal into steps!
        </div>
      ) : (
        <>
          <div className="project-grid">
            {enriched.map(({ project, steps, doneCount, nextDueDate }) => {
              const pct = steps.length > 0 ? Math.round((doneCount / steps.length) * 100) : 0;
              const lead = memberMap.get(project.leadMemberId);
              const nextIsOverdue = Boolean(nextDueDate && nextDueDate < data.todayStr);
              return (
                <div
                  key={project.id}
                  className={`project-card ${selected?.project.id === project.id ? 'selected' : ''}`}
                  onClick={() => {
                    setSelectedId(project.id);
                    setCategoryFilter('all');
                    setEditingProjectInfo(false);
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <FolderKanban size={18} style={{ color: 'var(--primary)', flexShrink: 0 }} />
                      <h3 style={{ fontSize: '1.08rem' }}>{project.title}</h3>
                    </div>
                    <span className={`tag ${project.status === 'active' ? 'primary' : project.status === 'completed' ? 'info' : ''}`}>
                      {project.status}
                    </span>
                  </div>
                  {project.description && (
                    <p style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>{project.description}</p>
                  )}
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', marginBottom: 5 }}>
                      <span>
                        {doneCount} of {steps.length} {steps.length === 1 ? 'task' : 'tasks'} complete
                      </span>
                      <strong>{pct}%</strong>
                    </div>
                    <div className="bar-track">
                      <div className="bar-fill" style={{ width: `${pct}%`, background: 'var(--primary)' }} />
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, fontSize: '0.78rem', color: 'var(--text-muted)', flexWrap: 'wrap' }}>
                    <span>Lead: {lead ? lead.name.split(' ')[0] : 'Shared'}</span>
                    {nextDueDate && (
                      <span style={nextIsOverdue ? { color: 'var(--accent)', fontWeight: 700 } : undefined}>
                        &middot; {nextIsOverdue ? 'Overdue' : 'Next due'}: {nextDueDate}
                      </span>
                    )}
                    {project.targetDate && <span>&middot; Target: {project.targetDate}</span>}
                    {project.visibility === 'private' && (
                      <span className="tag private">
                        <Lock size={11} /> Private
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {selected && (
            <div className="card">
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 12,
                  marginBottom: 14,
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ flex: 1, minWidth: 220 }}>
                  {!editingProjectInfo ? (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <h2>{selected.project.title}</h2>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => {
                            setEditProjTitle(selected.project.title);
                            setEditProjDesc(selected.project.description || '');
                            setEditingProjectInfo(true);
                          }}
                          title="Edit project title & description"
                        >
                          <Edit3 size={14} />
                        </button>
                      </div>
                      {selected.project.description && (
                        <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', marginTop: 3 }}>
                          {selected.project.description}
                        </p>
                      )}
                      {selected.nextDueDate && (
                        <div style={{ fontSize: '0.8rem', color: selected.nextDueDate < data.todayStr ? 'var(--accent)' : 'var(--text-muted)', marginTop: 4, fontWeight: selected.nextDueDate < data.todayStr ? 600 : 400 }}>
                          {selected.nextDueDate < data.todayStr ? 'Earliest overdue task' : 'Next task due'}: {selected.nextDueDate}
                        </div>
                      )}
                    </>
                  ) : (
                    <form onSubmit={handleSaveProjectInfo} className="form-grid" style={{ maxWidth: 460 }}>
                      <input
                        className="input"
                        value={editProjTitle}
                        onChange={(e) => setEditProjTitle(e.target.value)}
                        required
                      />
                      <input
                        className="input"
                        placeholder="Project description"
                        value={editProjDesc}
                        onChange={(e) => setEditProjDesc(e.target.value)}
                      />
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
                          Save
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => setEditingProjectInfo(false)}
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <div style={{ width: 195 }} title="Project Default Category">
                    <CategoryCombobox
                      categories={data.categories}
                      value={selected.project.categoryId || ''}
                      onChange={(cid) => handleProjectCategoryChange(selected.project, cid)}
                      visibility={selected.project.visibility}
                      onCategoryCreated={async () => {
                        await onRefresh();
                      }}
                      placeholder="Project category..."
                      compact
                    />
                  </div>
                  <div style={{ width: 170 }} title="Project Target Date">
                    <CalendarDatePicker
                      value={selected.project.targetDate || ''}
                      onChange={(iso) => handleTargetDateChange(selected.project, iso)}
                      placeholder="Set target date"
                      clearable
                      compact
                      align="right"
                    />
                  </div>
                  <div className="pill-group">
                    <button
                      type="button"
                      className={`pill ${groupMode === 'tree' ? 'active' : ''}`}
                      onClick={() => setGroupMode('tree')}
                    >
                      Hierarchy Tree
                    </button>
                    <button
                      type="button"
                      className={`pill ${groupMode === 'category' ? 'active' : ''}`}
                      onClick={() => setGroupMode('category')}
                    >
                      By Category
                    </button>
                  </div>
                  {selected.project.visibility !== 'private' && (
                    <select
                      className="inline-select"
                      value={selected.project.leadMemberId || ''}
                      onChange={(e) => handleLeadChange(selected.project, e.target.value)}
                      aria-label="Project Lead"
                    >
                      <option value="">Lead: Shared (None)</option>
                      {data.members.map((m) => (
                        <option key={m.id} value={m.id}>
                          Lead: {m.name.split(' ')[0]}
                        </option>
                      ))}
                    </select>
                  )}
                  <select
                    className="inline-select"
                    value={selected.project.status}
                    onChange={(e) => handleStatusChange(selected.project, e.target.value as Project['status'])}
                  >
                    <option value="planning">Planning</option>
                    <option value="active">Active</option>
                    <option value="on_hold">On Hold</option>
                    <option value="completed">Completed</option>
                  </select>
                  <button
                    type="button"
                    className="btn btn-danger-ghost btn-sm"
                    onClick={() => handleDeleteProject(selected.project.id)}
                  >
                    <Trash2 size={14} /> Delete
                  </button>
                </div>
              </div>

              {/* Category filter pills within project */}
              {usedCategoryIds.length > 1 && (
                <div className="pill-group" style={{ marginBottom: 14 }}>
                  <button
                    type="button"
                    className={`pill ${categoryFilter === 'all' ? 'active' : ''}`}
                    onClick={() => setCategoryFilter('all')}
                  >
                    All Categories ({selected.steps.length})
                  </button>
                  {usedCategoryIds.map((cid) => (
                    <button
                      key={cid}
                      type="button"
                      className={`pill ${categoryFilter === cid ? 'active' : ''}`}
                      onClick={() => setCategoryFilter(cid)}
                    >
                      {catLabelMap.get(cid) || cid}
                    </button>
                  ))}
                </div>
              )}

              {/* Quick-Add Project Task with Category & Parent Task Hierarchy */}
              <form
                onSubmit={handleAddStep}
                style={{
                  display: 'flex',
                  gap: 8,
                  flexWrap: 'wrap',
                  marginBottom: 16,
                  padding: 12,
                  background: 'var(--surface-subtle)',
                  borderRadius: 12,
                }}
              >
                <input
                  className="input"
                  style={{ flex: 2, minWidth: 200 }}
                  placeholder="Add a task or sub-task to this project..."
                  value={stepTitle}
                  onChange={(e) => setStepTitle(e.target.value)}
                  required
                />
                <div style={{ width: 195 }}>
                  <CategoryCombobox
                    categories={data.categories}
                    value={stepCategoryId}
                    onChange={setStepCategoryId}
                    visibility={selected.project.visibility}
                    onCategoryCreated={async () => {
                      await onRefresh();
                    }}
                    placeholder="Task category..."
                    compact
                  />
                </div>
                <select
                  className="select"
                  style={{ width: 175 }}
                  value={stepParentId}
                  onChange={(e) => setStepParentId(e.target.value)}
                  aria-label="Parent task"
                >
                  <option value="">Top-level Task</option>
                  {selected.steps.map((s) => (
                    <option key={s.id} value={s.id}>
                      Under: {s.title}
                    </option>
                  ))}
                </select>
                {selected.project.visibility !== 'private' && (
                  <select
                    className="select"
                    style={{ width: 135 }}
                    value={stepAssignee}
                    onChange={(e) => setStepAssignee(e.target.value)}
                  >
                    <option value="">Anyone</option>
                    {data.members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name.split(' ')[0]}
                      </option>
                    ))}
                  </select>
                )}
                <div style={{ width: 158 }}>
                  <CalendarDatePicker
                    value={stepDue}
                    onChange={setStepDue}
                    placeholder="Due date"
                    compact
                    align="right"
                  />
                </div>
                <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
                  <Plus size={14} /> Add Task
                </button>
              </form>

              {groupMode === 'tree' ? (
                <>
                  {draggedId && selected.steps.find((s) => s.id === draggedId)?.parentTaskId && (
                    <div
                      className={`drop-root-zone ${rootDropActive ? 'active' : ''}`}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setRootDropActive(true);
                      }}
                      onDragLeave={() => setRootDropActive(false)}
                      onDrop={(e) => {
                        e.preventDefault();
                        handleDropToRoot();
                      }}
                    >
                      Drop here to promote back to top-level project task
                    </div>
                  )}
                  <div className="chore-list">
                    {rootSteps.map((step) => renderStepNode(step, 0))}
                  </div>
                </>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                  {stepsByCategory.map((group) => (
                    <div key={group.catId}>
                      <div className="section-heading">
                        <span>{group.label}</span>
                        <span className="tag">{group.tasks.length}</span>
                      </div>
                      <div className="chore-list">
                        {group.tasks.map((step) => renderStepNode(step, 0))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
