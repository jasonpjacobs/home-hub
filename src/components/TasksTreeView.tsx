import React, { useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  CloudRain,
  CornerDownRight,
  Edit3,
  Flame,
  Folder,
  FolderKanban,
  FolderPlus,
  GripVertical,
  Lock,
  PauseCircle,
  PlayCircle,
  Plus,
  Repeat,
  Search,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import { api } from '../api';
import type { Category, DashboardData, Task } from '../types';
import type { DetailTarget } from './TaskDetailModal';
import { buildCategoryOptions } from './TaskModal';

interface Props {
  data: DashboardData;
  onAddTask: (categoryId?: string) => void;
  onOpenDetail: (target: DetailTarget) => void;
  onEditTask: (task: Task) => void;
  onToggleFavorite: (task: Task) => Promise<void>;
  onToggleActive: (task: Task) => Promise<void>;
  onDeleteTask: (id: string) => Promise<void>;
  onRefresh: () => Promise<void>;
  onToast: (msg: string) => void;
}

type QuickFilter =
  | 'all'
  | 'habits'
  | 'recurring'
  | 'one_off'
  | 'unscheduled'
  | 'favorites'
  | 'private'
  | 'weather'
  | 'radar'
  | 'needs_details';

export function TasksTreeView({
  data,
  onAddTask,
  onOpenDetail,
  onEditTask,
  onToggleFavorite,
  onToggleActive,
  onDeleteTask,
  onRefresh,
  onToast,
}: Props) {
  const [selectedCatId, setSelectedCatId] = useState<string>('all');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [taskCollapsed, setTaskCollapsed] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState('');
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('all');

  // Drag & drop hierarchy state
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [taskDropState, setTaskDropState] = useState<{
    targetId: string;
    zone: 'before' | 'inside' | 'after';
  } | null>(null);
  const [catDropTargetId, setCatDropTargetId] = useState<string | null>(null);
  const [rootDropActive, setRootDropActive] = useState(false);

  // Category Create / Edit Modal state
  const [catModalOpen, setCatModalOpen] = useState(false);
  const [editingCat, setEditingCat] = useState<Category | null>(null);
  const [catName, setCatName] = useState('');
  const [catParentId, setCatParentId] = useState('');
  const [catPrivate, setCatPrivate] = useState(false);
  const [savingCat, setSavingCat] = useState(false);

  const memberMap = useMemo(() => new Map(data.members.map((m) => [m.id, m])), [data.members]);
  const projectMap = useMemo(() => new Map(data.projects.map((p) => [p.id, p])), [data.projects]);
  const taskTitleMap = useMemo(() => new Map(data.tasks.map((t) => [t.id, t.title])), [data.tasks]);
  const categoryOptions = useMemo(() => buildCategoryOptions(data.categories), [data.categories]);

  const { childrenMap, rootCategories, descendantsMap } = useMemo(() => {
    const chMap = new Map<string, Category[]>();
    const roots: Category[] = [];
    for (const c of data.categories) {
      if (!c.parentCategoryId) {
        roots.push(c);
      } else {
        const list = chMap.get(c.parentCategoryId) || [];
        list.push(c);
        chMap.set(c.parentCategoryId, list);
      }
    }
    const descMap = new Map<string, Set<string>>();
    function collect(id: string): Set<string> {
      if (descMap.has(id)) return descMap.get(id)!;
      const set = new Set<string>([id]);
      for (const child of chMap.get(id) || []) {
        for (const d of collect(child.id)) set.add(d);
      }
      descMap.set(id, set);
      return set;
    }
    for (const c of data.categories) collect(c.id);
    return { childrenMap: chMap, rootCategories: roots, descendantsMap: descMap };
  }, [data.categories]);

  const allVisibleTasks = data.tasks;

  const scheduledTaskIds = useMemo(() => {
    const set = new Set<string>();
    for (const inst of data.instances) {
      if (
        inst.taskId &&
        (inst.status === 'pending' ||
          inst.status === 'started' ||
          inst.status === 'on_hold' ||
          inst.status === 'gated') &&
        Boolean(inst.windowEndDate || inst.dueDate)
      ) {
        set.add(inst.taskId);
      }
    }
    return set;
  }, [data.instances]);

  const isTaskUnscheduled = (t: Task) =>
    t.active !== false &&
    !t.isHabit &&
    t.cadenceMode !== 'weather_triggered' &&
    !scheduledTaskIds.has(t.id);

  const countForCategory = (catId: string) => {
    const allowed = descendantsMap.get(catId) || new Set([catId]);
    return allVisibleTasks.filter((t) => allowed.has(t.categoryId)).length;
  };

  const filteredTasks = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allVisibleTasks
      .filter((t) => {
        if (selectedCatId !== 'all') {
          const allowed = descendantsMap.get(selectedCatId) || new Set([selectedCatId]);
          if (!allowed.has(t.categoryId)) return false;
        }
        if (quickFilter === 'habits' && !t.isHabit) return false;
        if (quickFilter === 'recurring') {
          if (t.projectId || (t.cadenceMode !== 'weather_triggered' && t.recurrenceType === 'once')) {
            return false;
          }
        }
        if (quickFilter === 'one_off') {
          if (!t.projectId && (t.cadenceMode === 'weather_triggered' || t.recurrenceType !== 'once')) {
            return false;
          }
        }
        if (quickFilter === 'unscheduled' && !isTaskUnscheduled(t)) return false;
        if (quickFilter === 'favorites' && !t.isFavorite) return false;
        if (quickFilter === 'private' && t.visibility !== 'private') return false;
        if (quickFilter === 'weather' && (!t.weatherTrigger || t.weatherTrigger === 'none')) return false;
        if (quickFilter === 'radar' && t.assignmentMode !== 'open_pool') return false;
        if (quickFilter === 'needs_details' && !t.needsDetails) return false;
        if (q && !`${t.title} ${t.description}`.toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) => (a.stepOrder || 0) - (b.stepOrder || 0));
  }, [allVisibleTasks, selectedCatId, descendantsMap, quickFilter, search]);

  const { rootTaskNodes, childTasksByParent } = useMemo(() => {
    const visibleIds = new Set(filteredTasks.map((t) => t.id));
    const byParent = new Map<string, Task[]>();
    const roots: Task[] = [];
    for (const t of filteredTasks) {
      if (t.parentTaskId && visibleIds.has(t.parentTaskId)) {
        const list = byParent.get(t.parentTaskId) || [];
        list.push(t);
        byParent.set(t.parentTaskId, list);
      } else {
        roots.push(t);
      }
    }
    return { rootTaskNodes: roots, childTasksByParent: byParent };
  }, [filteredTasks]);

  function isTaskDescendant(candidateId: string, ancestorId: string): boolean {
    const byId = new Map(data.tasks.map((t) => [t.id, t]));
    let cur = byId.get(candidateId);
    const seen = new Set<string>();
    while (cur && !seen.has(cur.id)) {
      if (cur.id === ancestorId) return true;
      seen.add(cur.id);
      cur = cur.parentTaskId ? byId.get(cur.parentTaskId) : undefined;
    }
    return false;
  }

  async function handleDropOnTask(targetTask: Task, zone: 'before' | 'inside' | 'after') {
    if (!draggedTaskId || draggedTaskId === targetTask.id) return;
    const dragged = data.tasks.find((t) => t.id === draggedTaskId);
    if (!dragged) return;
    if (dragged.visibility !== targetTask.visibility) {
      onToast('Cannot nest a private task inside a shared task (or vice versa).');
      return;
    }
    if (isTaskDescendant(targetTask.id, draggedTaskId)) {
      onToast('Cannot move a task inside one of its own sub-tasks.');
      return;
    }

    const newParentId = zone === 'inside' ? targetTask.id : targetTask.parentTaskId || '';
    const newCategoryId = targetTask.categoryId || dragged.categoryId;
    const siblings = filteredTasks
      .filter((t) => (t.parentTaskId || '') === newParentId && t.id !== draggedTaskId)
      .sort((a, b) => (a.stepOrder || 0) - (b.stepOrder || 0));

    let insertIdx = siblings.length;
    if (zone !== 'inside') {
      const targetIdx = siblings.findIndex((s) => s.id === targetTask.id);
      if (targetIdx !== -1) insertIdx = zone === 'before' ? targetIdx : targetIdx + 1;
    }
    siblings.splice(insertIdx, 0, dragged);

    const updates = siblings.map((s, idx) => ({
      id: s.id,
      parentTaskId: newParentId,
      stepOrder: idx + 1,
      ...(s.id === dragged.id ? { categoryId: newCategoryId } : {}),
    }));

    setDraggedTaskId(null);
    setTaskDropState(null);
    await api.reorderTasks(updates);
    if (zone === 'inside') {
      setTaskCollapsed((p) => ({ ...p, [targetTask.id]: false }));
    }
    await onRefresh();
    onToast(
      zone === 'inside'
        ? `Nested "${dragged.title}" under "${targetTask.title}".`
        : `Moved "${dragged.title}".`,
    );
  }

  async function handleDropTaskToRoot() {
    if (!draggedTaskId) return;
    const dragged = data.tasks.find((t) => t.id === draggedTaskId);
    if (!dragged) return;
    const roots = rootTaskNodes.filter((t) => t.id !== draggedTaskId);
    roots.unshift(dragged);
    const updates = roots.map((t, idx) => ({
      id: t.id,
      parentTaskId: '',
      stepOrder: idx + 1,
    }));
    setDraggedTaskId(null);
    setTaskDropState(null);
    setRootDropActive(false);
    await api.reorderTasks(updates);
    await onRefresh();
    onToast(`Promoted "${dragged.title}" to top level.`);
  }

  async function handleDropOnCategory(cat: Category) {
    if (!draggedTaskId) return;
    const dragged = data.tasks.find((t) => t.id === draggedTaskId);
    setDraggedTaskId(null);
    setCatDropTargetId(null);
    if (!dragged) return;
    if (dragged.visibility !== cat.visibility) {
      onToast(
        cat.visibility === 'private'
          ? 'Shared tasks cannot be moved into a Private category.'
          : 'Private tasks cannot be moved into a Shared category.',
      );
      return;
    }
    await api.reorderTasks([{ id: dragged.id, categoryId: cat.id, parentTaskId: '' }]);
    await onRefresh();
    onToast(`Moved "${dragged.title}" into ${cat.name}.`);
  }

  // Valid parent choices inside the category modal (same visibility, no self/descendants)
  const availableParentOptions = useMemo(() => {
    const blocked = editingCat ? descendantsMap.get(editingCat.id) || new Set([editingCat.id]) : new Set<string>();
    return categoryOptions.filter((opt) => {
      if (blocked.has(opt.id)) return false;
      return catPrivate ? opt.visibility === 'private' : opt.visibility !== 'private';
    });
  }, [categoryOptions, editingCat, descendantsMap, catPrivate]);

  function openCreateCategory(parentId = '') {
    const parent = parentId ? data.categories.find((c) => c.id === parentId) : undefined;
    setEditingCat(null);
    setCatName('');
    setCatParentId(parent?.id || '');
    setCatPrivate(parent?.visibility === 'private');
    setCatModalOpen(true);
  }

  function openEditCategory(cat: Category) {
    setEditingCat(cat);
    setCatName(cat.name);
    setCatParentId(cat.parentCategoryId || '');
    setCatPrivate(cat.visibility === 'private');
    setCatModalOpen(true);
  }

  async function handleSaveCategory(e: React.FormEvent) {
    e.preventDefault();
    if (!catName.trim()) return;
    setSavingCat(true);
    try {
      if (editingCat) {
        await api.updateCategory(editingCat.id, {
          name: catName.trim(),
          parentCategoryId: catParentId,
        });
        onToast(`Updated category "${catName.trim()}".`);
      } else {
        const res = await api.createCategory({
          name: catName.trim(),
          parentCategoryId: catParentId,
          visibility: catPrivate ? 'private' : 'household',
        });
        setSelectedCatId(res.category.id);
        onToast(`Created category "${res.category.name}".`);
      }
      setCatModalOpen(false);
      setEditingCat(null);
      await onRefresh();
    } catch (err: any) {
      onToast(err.message || 'Could not save category.');
    } finally {
      setSavingCat(false);
    }
  }

  async function handleDeleteCategory(cat: Category) {
    const childCount = (childrenMap.get(cat.id) || []).length;
    const directTasks = data.tasks.filter((t) => t.categoryId === cat.id).length;
    const msg =
      childCount > 0 || directTasks > 0
        ? `Delete "${cat.name}"? Its ${childCount} subcategory(ies) and ${directTasks} direct task(s) will move up to its parent category.`
        : `Delete category "${cat.name}"?`;
    if (!window.confirm(msg)) return;
    try {
      await api.deleteCategory(cat.id);
      if (selectedCatId === cat.id) {
        setSelectedCatId(cat.parentCategoryId || 'all');
      }
      setCatModalOpen(false);
      setEditingCat(null);
      await onRefresh();
      onToast(`Deleted category "${cat.name}".`);
    } catch (err: any) {
      onToast(err.message || 'Could not delete category.');
    }
  }

  function renderTreeBranch(cat: Category, depth = 0) {
    const kids = childrenMap.get(cat.id) || [];
    const isCollapsed = collapsed[cat.id];
    const count = countForCategory(cat.id);

    return (
      <div key={cat.id}>
        <div className="tree-row" style={{ paddingLeft: depth * 12 }}>
          {kids.length > 0 ? (
            <button
              type="button"
              className="btn btn-ghost"
              style={{ padding: 3 }}
              onClick={() => setCollapsed((p) => ({ ...p, [cat.id]: !p[cat.id] }))}
              aria-label={isCollapsed ? 'Expand' : 'Collapse'}
            >
              {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
            </button>
          ) : (
            <span style={{ width: 19, flexShrink: 0 }} />
          )}

          <button
            type="button"
            className={`tree-node ${selectedCatId === cat.id ? 'active' : ''} ${catDropTargetId === cat.id ? 'drop-target' : ''}`}
            onClick={() => setSelectedCatId(cat.id)}
            onDragOver={(e) => {
              if (!draggedTaskId) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              if (catDropTargetId !== cat.id) setCatDropTargetId(cat.id);
            }}
            onDragLeave={() => {
              if (catDropTargetId === cat.id) setCatDropTargetId(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              handleDropOnCategory(cat);
            }}
          >
            {cat.visibility === 'private' ? (
              <Lock size={13} style={{ color: 'var(--private)', flexShrink: 0 }} />
            ) : (
              <Folder size={13} style={{ flexShrink: 0 }} />
            )}
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {cat.name}
            </span>
            <span style={{ fontSize: '0.72rem', opacity: 0.7 }}>{count}</span>
          </button>

          <div className="tree-actions">
            <button
              type="button"
              className="tree-icon-btn"
              onClick={() => openCreateCategory(cat.id)}
              title={`Add subcategory inside ${cat.name}`}
              aria-label={`Add subcategory inside ${cat.name}`}
            >
              <Plus size={12} />
            </button>
            <button
              type="button"
              className="tree-icon-btn"
              onClick={() => openEditCategory(cat)}
              title={`Edit ${cat.name}`}
              aria-label={`Edit ${cat.name}`}
            >
              <Edit3 size={12} />
            </button>
            <button
              type="button"
              className="tree-icon-btn danger"
              onClick={() => handleDeleteCategory(cat)}
              title={`Delete ${cat.name}`}
              aria-label={`Delete ${cat.name}`}
            >
              <Trash2 size={12} />
            </button>
          </div>
        </div>
        {!isCollapsed && kids.map((child) => renderTreeBranch(child, depth + 1))}
      </div>
    );
  }

  const selectedCategory =
    selectedCatId !== 'all' ? data.categories.find((c) => c.id === selectedCatId) : null;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Tasks Hierarchy</h1>
          <p className="page-subtitle">
            Organize household &amp; private tasks into nested categories and subcategories.
          </p>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => openCreateCategory(selectedCatId !== 'all' ? selectedCatId : '')}
          >
            <FolderPlus size={15} /> {selectedCategory ? 'Add Subcategory' : 'Add Category'}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => onAddTask(selectedCatId !== 'all' ? selectedCatId : undefined)}
          >
            <Plus size={16} /> New Task
          </button>
        </div>
      </div>

      <div className="tree-layout">
        <aside className="tree-panel">
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 8,
            }}
          >
            <span
              style={{
                fontSize: '0.76rem',
                fontWeight: 700,
                textTransform: 'uppercase',
                color: 'var(--text-muted)',
              }}
            >
              Categories
            </span>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ padding: '3px 6px', fontSize: '0.75rem' }}
              onClick={() => openCreateCategory('')}
              title="Add top-level category"
            >
              <Plus size={13} /> New
            </button>
          </div>

          <button
            type="button"
            className={`tree-node ${selectedCatId === 'all' ? 'active' : ''}`}
            onClick={() => setSelectedCatId('all')}
          >
            <span style={{ flex: 1 }}>All Tasks</span>
            <span style={{ fontSize: '0.73rem', opacity: 0.7 }}>{allVisibleTasks.length}</span>
          </button>
          {rootCategories.map((c) => renderTreeBranch(c, 0))}
        </aside>

        <div>
          {selectedCategory && (
            <div
              className="card"
              style={{
                padding: '12px 16px',
                marginBottom: 14,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 10,
                flexWrap: 'wrap',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {selectedCategory.visibility === 'private' ? (
                  <Lock size={15} style={{ color: 'var(--private)' }} />
                ) : (
                  <Folder size={15} style={{ color: 'var(--primary)' }} />
                )}
                <strong>
                  {categoryOptions.find((c) => c.id === selectedCategory.id)?.label ||
                    selectedCategory.name}
                </strong>
                {selectedCategory.visibility === 'private' && (
                  <span className="tag private">Private Sheet</span>
                )}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => openCreateCategory(selectedCategory.id)}
                >
                  <Plus size={13} /> Subcategory
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => openEditCategory(selectedCategory)}
                >
                  <Edit3 size={13} /> Edit Category
                </button>
                <button
                  type="button"
                  className="btn btn-danger-ghost btn-sm"
                  onClick={() => handleDeleteCategory(selectedCategory)}
                >
                  <Trash2 size={13} /> Delete
                </button>
              </div>
            </div>
          )}

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
                placeholder="Search tasks..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="pill-group">
              {(
                [
                  ['all', 'All'],
                  ['habits', 'Habits'],
                  ['recurring', 'Recurring'],
                  ['one_off', 'One-Off'],
                  ['unscheduled', 'No Due Date'],
                  ['favorites', 'Favorites'],
                  ['private', 'Private'],
                  ['weather', 'Weather'],
                  ['radar', 'Anyone'],
                  ['needs_details', 'Needs Details'],
                ] as Array<[QuickFilter, string]>
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  className={`pill ${quickFilter === k ? 'active' : ''}`}
                  onClick={() => setQuickFilter(k)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {filteredTasks.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: 36, color: 'var(--text-muted)' }}>
              No tasks match this category or filter.
            </div>
          ) : (
            <>
              {draggedTaskId && data.tasks.find((t) => t.id === draggedTaskId)?.parentTaskId && (
                <div
                  className={`drop-root-zone ${rootDropActive ? 'active' : ''}`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setRootDropActive(true);
                  }}
                  onDragLeave={() => setRootDropActive(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    handleDropTaskToRoot();
                  }}
                >
                  Drop here to promote back to top level
                </div>
              )}

              <div className="chore-list">
                {(() => {
                  const renderTaskNode = (t: Task, depth = 0): React.ReactNode => {
                    const fixedMember = t.fixedMemberId ? memberMap.get(t.fixedMemberId) : null;
                    const children = childTasksByParent.get(t.id) || [];
                    const isCollapsed = taskCollapsed[t.id];
                    const isDragging = draggedTaskId === t.id;
                    const activeZone = taskDropState?.targetId === t.id ? taskDropState.zone : null;

                    return (
                      <div key={t.id}>
                        <div
                          draggable
                          onDragStart={(e) => {
                            setDraggedTaskId(t.id);
                            e.dataTransfer.effectAllowed = 'move';
                            e.dataTransfer.setData('text/plain', t.id);
                          }}
                          onDragEnd={() => {
                            setDraggedTaskId(null);
                            setTaskDropState(null);
                            setCatDropTargetId(null);
                            setRootDropActive(false);
                          }}
                          onDragOver={(e) => {
                            if (!draggedTaskId || draggedTaskId === t.id || isTaskDescendant(t.id, draggedTaskId)) {
                              return;
                            }
                            e.preventDefault();
                            e.dataTransfer.dropEffect = 'move';
                            const rect = e.currentTarget.getBoundingClientRect();
                            const ratio = (e.clientY - rect.top) / rect.height;
                            const zone: 'before' | 'inside' | 'after' =
                              ratio < 0.28 ? 'before' : ratio > 0.72 ? 'after' : 'inside';
                            if (taskDropState?.targetId !== t.id || taskDropState?.zone !== zone) {
                              setTaskDropState({ targetId: t.id, zone });
                            }
                          }}
                          onDragLeave={(e) => {
                            if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                              if (taskDropState?.targetId === t.id) setTaskDropState(null);
                            }
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            if (taskDropState && taskDropState.targetId === t.id) {
                              handleDropOnTask(t, taskDropState.zone);
                            }
                          }}
                          className={`assignment-row ${t.visibility === 'private' ? 'private-row' : ''} ${isDragging ? 'dragging' : ''} ${activeZone ? `drop-${activeZone}` : ''}`}
                          style={{
                            opacity: t.active ? 1 : 0.6,
                            marginLeft: depth * 26,
                            borderLeft:
                              depth > 0 && t.visibility !== 'private'
                                ? '3px solid var(--border-strong)'
                                : undefined,
                          }}
                        >
                          <span
                            className="drag-handle"
                            title="Drag to reorder, drop onto another task to nest, or drop onto a category"
                          >
                            <GripVertical size={15} />
                          </span>

                          {children.length > 0 && (
                            <button
                              type="button"
                              className="btn btn-ghost"
                              style={{ padding: 2 }}
                              onClick={() =>
                                setTaskCollapsed((p) => ({ ...p, [t.id]: !p[t.id] }))
                              }
                            >
                              {isCollapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
                            </button>
                          )}

                          <button
                            type="button"
                            className="btn btn-ghost"
                            style={{ padding: 4, color: t.isFavorite ? '#d97706' : 'var(--border-strong)' }}
                            onClick={() => onToggleFavorite(t)}
                            title="Toggle Cockpit favorite"
                          >
                            <Star size={17} fill={t.isFavorite ? '#d97706' : 'none'} />
                          </button>

                          <div
                            className="assignment-main clickable-main"
                            onClick={() => onOpenDetail({ taskId: t.id })}
                            title="Click to view details & update status"
                          >
                            <div className="assignment-title">
                              <span className="clickable-title">{t.title}</span>
                              {t.isHabit ? (
                                <span className="tag habit">
                                  <Flame size={11} /> Habit{t.routineCue && t.routineCue !== 'anytime' ? ` · ${t.routineCue}` : ''}
                                </span>
                              ) : t.projectId || (t.cadenceMode !== 'weather_triggered' && t.recurrenceType === 'once') ? (
                                <span className="tag warning">One-off</span>
                              ) : (
                                <span className="tag primary">
                                  <Repeat size={11} /> Recurring
                                </span>
                              )}
                              {t.projectId && projectMap.has(t.projectId) && (
                                <span className="tag info">
                                  <FolderKanban size={11} /> {projectMap.get(t.projectId)!.title}
                                </span>
                              )}
                              {depth === 0 && t.parentTaskId && taskTitleMap.has(t.parentTaskId) && (
                                <span className="tag">
                                  <CornerDownRight size={11} /> {taskTitleMap.get(t.parentTaskId)}
                                </span>
                              )}
                              {children.length > 0 && (
                                <span className="tag primary">{children.length} sub</span>
                              )}
                              {t.visibility === 'private' && (
                                <span className="tag private">
                                  <Lock size={11} /> Private
                                </span>
                              )}
                              {t.needsDetails && <span className="tag warning">Needs details</span>}
                              {isTaskUnscheduled(t) && (
                                <span className="tag" style={{ color: 'var(--text-muted)' }}>
                                  No due date
                                </span>
                              )}
                              {t.cadenceMode === 'weather_triggered' && (
                                <span className="tag info">
                                  <CloudRain size={11} /> {t.weatherTrigger.replace('_', ' ')}
                                </span>
                              )}
                              <span className="tag">
                                {t.overduePolicy === 'auto_skip'
                                  ? 'Auto-skip'
                                  : t.overduePolicy === 'roll_forward'
                                    ? 'Roll forward'
                                    : 'Carry over'}
                              </span>
                              {data.user.showEffortAndFairness && (
                                <span className={`tag effort-${t.effort}`}>
                                  {t.effort} {t.effort === 1 ? 'pt' : 'pts'}
                                </span>
                              )}
                            </div>
                            {t.description && (
                              <p style={{ fontSize: '0.84rem', color: 'var(--text-muted)', marginTop: 3 }}>
                                {t.description}
                              </p>
                            )}
                            <div className="assignment-meta">
                              {t.projectId ? (
                                <span>One-time project task</span>
                              ) : (
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                  <Repeat size={12} />
                                  {t.cadenceMode === 'weather_triggered'
                                    ? 'Weather-triggered'
                                    : (() => {
                                        const pref = t.cadenceMode === 'flexible_window' ? 'Flexible ' : '';
                                        if (t.recurrenceType === 'times_per_week') {
                                          return `${t.recurrenceInterval || 3}x / week`;
                                        }
                                        if (t.recurrenceType === 'custom_days') {
                                          const n = t.recurrenceInterval || 1;
                                          return `${pref}every ${n} ${n === 1 ? 'day' : 'days'}`;
                                        }
                                        if (t.recurrenceType === 'custom_months') {
                                          const n = t.recurrenceInterval || 1;
                                          return `${pref}every ${n} ${n === 1 ? 'month' : 'months'}`;
                                        }
                                        if (t.recurrenceType === 'yearly' && t.targetMonth && t.targetMonth >= 1 && t.targetMonth <= 12) {
                                          const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
                                          return `${pref}yearly (${months[t.targetMonth - 1]})`;
                                        }
                                        return `${pref}${t.recurrenceType}${t.targetSeason ? ` (${t.targetSeason})` : ''}`;
                                      })()}
                                </span>
                              )}
                              <span>&middot;</span>
                              <span>
                                {t.assignmentMode === 'fixed' && fixedMember
                                  ? `Fixed: ${fixedMember.name.split(' ')[0]}`
                                  : t.assignmentMode === 'open_pool'
                                    ? 'Anyone'
                                    : t.assignmentMode === 'round_robin'
                                      ? 'Round-robin'
                                      : 'Fair Auto-Balance'}
                              </span>
                            </div>
                          </div>

                          <div className="assignment-controls">
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() => onToggleActive(t)}
                            >
                              {t.active ? <PauseCircle size={15} /> : <PlayCircle size={15} />}
                            </button>
                            <button type="button" className="btn btn-secondary btn-sm" onClick={() => onEditTask(t)}>
                              <Edit3 size={14} /> Edit
                            </button>
                            <button
                              type="button"
                              className="btn btn-danger-ghost btn-sm"
                              onClick={() => onDeleteTask(t.id)}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>

                        {!isCollapsed && children.length > 0 && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                            {children.map((child) => renderTaskNode(child, depth + 1))}
                          </div>
                        )}
                      </div>
                    );
                  };

                  return rootTaskNodes.map((t) => renderTaskNode(t, 0));
                })()}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Category / Subcategory Create & Edit Modal */}
      {catModalOpen && (
        <div className="modal-backdrop" onClick={() => setCatModalOpen(false)}>
          <div className="modal-card" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 16,
              }}
            >
              <h2>{editingCat ? 'Edit Category' : catParentId ? 'Add Subcategory' : 'Add Category'}</h2>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setCatModalOpen(false)}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveCategory} className="form-grid">
              <div className="field">
                <label htmlFor="cat-modal-name">Category Name</label>
                <input
                  id="cat-modal-name"
                  className="input"
                  placeholder="e.g., Lawn & Garden"
                  value={catName}
                  onChange={(e) => setCatName(e.target.value)}
                  required
                  autoFocus
                />
              </div>

              {!editingCat && (
                <div className="field">
                  <label>Storage / Visibility</label>
                  <div className="pill-group">
                    <button
                      type="button"
                      className={`pill ${!catPrivate ? 'active' : ''}`}
                      onClick={() => {
                        setCatPrivate(false);
                        setCatParentId('');
                      }}
                    >
                      Shared Household
                    </button>
                    <button
                      type="button"
                      className={`pill ${catPrivate ? 'active' : ''}`}
                      onClick={() => {
                        setCatPrivate(true);
                        setCatParentId('');
                      }}
                    >
                      <Lock size={12} /> Private (Personal Sheet)
                    </button>
                  </div>
                </div>
              )}

              <div className="field">
                <label htmlFor="cat-modal-parent">Parent Category</label>
                <select
                  id="cat-modal-parent"
                  className="select"
                  value={catParentId}
                  onChange={(e) => setCatParentId(e.target.value)}
                >
                  <option value="">None (Top-level Category)</option>
                  {availableParentOptions.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div
                style={{
                  display: 'flex',
                  justifyContent: editingCat ? 'space-between' : 'flex-end',
                  alignItems: 'center',
                  gap: 8,
                  marginTop: 6,
                  paddingTop: 14,
                  borderTop: '1px solid var(--border)',
                }}
              >
                {editingCat && (
                  <button
                    type="button"
                    className="btn btn-danger-ghost btn-sm"
                    onClick={() => handleDeleteCategory(editingCat)}
                  >
                    <Trash2 size={14} /> Delete Category
                  </button>
                )}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setCatModalOpen(false)}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={savingCat}>
                    {savingCat ? 'Saving...' : editingCat ? 'Save Changes' : 'Create Category'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
