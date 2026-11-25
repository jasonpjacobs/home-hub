import React, { useMemo, useState } from 'react';
import { Lock, Trash2, X } from 'lucide-react';
import type { Category, Member, TaskInstance } from '../types';
import { CalendarDatePicker } from './CalendarDatePicker';
import { CategoryCombobox } from './CategoryCombobox';
import { buildCategoryOptions } from './TaskModal';

interface Props {
  instance: TaskInstance;
  categories: Category[];
  members: Member[];
  showEffort: boolean;
  onClose: () => void;
  onCategoryCreated?: () => Promise<void>;
  onSave: (
    id: string,
    payload: {
      taskTitle: string;
      categoryId: string;
      dueDate: string;
      assigneeId?: string;
      notes: string;
      effort?: number;
    },
  ) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

export function AdHocEditModal({
  instance,
  categories,
  members,
  showEffort,
  onClose,
  onCategoryCreated,
  onSave,
  onDelete,
}: Props) {
  const isPrivate = instance.visibility === 'private';
  const categoryOptions = useMemo(
    () =>
      buildCategoryOptions(categories).filter((c) =>
        isPrivate ? c.visibility === 'private' : c.visibility !== 'private',
      ),
    [categories, isPrivate],
  );

  const initialCatId =
    categoryOptions.find((c) => c.label === instance.categoryPath)?.id || '';

  const [title, setTitle] = useState(instance.taskTitle || '');
  const [categoryId, setCategoryId] = useState(initialCatId);
  const [date, setDate] = useState(instance.dueDate || '');
  const [assigneeId, setAssigneeId] = useState(instance.assigneeId || '');
  const [notes, setNotes] = useState(instance.notes || '');
  const [effort, setEffort] = useState(instance.effort || 1);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    try {
      await onSave(instance.id, {
        taskTitle: title.trim(),
        categoryId,
        dueDate: date,
        assigneeId: isPrivate ? undefined : assigneeId,
        notes: notes.trim(),
        ...(showEffort ? { effort } : {}),
      });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  const isDirty =
    title !== (instance.taskTitle || '') ||
    categoryId !== initialCatId ||
    date !== (instance.dueDate || '') ||
    notes !== (instance.notes || '');

  function requestClose() {
    if (isDirty && !window.confirm('Discard your unsaved changes to this ad-hoc record?')) {
      return;
    }
    onClose();
  }

  return (
    <div className="modal-backdrop" onClick={requestClose}>
      <div className="modal-card" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 16,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h2>Edit Ad-Hoc Record</h2>
            {isPrivate && (
              <span className="tag private">
                <Lock size={11} /> Private
              </span>
            )}
          </div>
          <button type="button" className="btn btn-ghost" onClick={requestClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="form-grid">
          <div className="field">
            <label htmlFor="adhoc-title">What Was Done</label>
            <input
              id="adhoc-title"
              className="input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              autoFocus
            />
          </div>

          <div className="form-row-2">
            <div className="field">
              <label htmlFor="adhoc-cat">Category</label>
              <CategoryCombobox
                id="adhoc-cat"
                categories={categories}
                value={categoryId}
                onChange={setCategoryId}
                visibility={isPrivate ? 'private' : 'household'}
                onCategoryCreated={onCategoryCreated}
                placeholder="Type or select category..."
                emptyLabel="General"
              />
            </div>

            <div className="field">
              <label htmlFor="adhoc-date">Date Completed</label>
              <CalendarDatePicker
                id="adhoc-date"
                value={date}
                onChange={setDate}
                align="right"
              />
            </div>
          </div>

          {(!isPrivate || showEffort) && (
            <div className={!isPrivate && showEffort ? 'form-row-2' : undefined}>
              {!isPrivate && (
                <div className="field">
                  <label htmlFor="adhoc-member">Completed By</label>
                  <select
                    id="adhoc-member"
                    className="select"
                    value={assigneeId}
                    onChange={(e) => setAssigneeId(e.target.value)}
                  >
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {showEffort && (
                <div className="field">
                  <label htmlFor="adhoc-effort">Effort</label>
                  <select
                    id="adhoc-effort"
                    className="select"
                    value={effort}
                    onChange={(e) => setEffort(Number(e.target.value))}
                  >
                    <option value={1}>Quick (1 pt)</option>
                    <option value={2}>Light (2 pts)</option>
                    <option value={3}>Medium (3 pts)</option>
                    <option value={5}>Heavy (5 pts)</option>
                  </select>
                </div>
              )}
            </div>
          )}

          <div className="field">
            <label htmlFor="adhoc-notes">Notes (optional)</label>
            <textarea
              id="adhoc-notes"
              className="textarea"
              rows={2}
              placeholder="Part number, vendor, cost, or any helpful record details..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginTop: 6,
              paddingTop: 14,
              borderTop: '1px solid var(--border)',
            }}
          >
            <button
              type="button"
              className="btn btn-danger-ghost btn-sm"
              onClick={async () => {
                await onDelete(instance.id);
                onClose();
              }}
            >
              <Trash2 size={14} /> Delete Record
            </button>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn btn-secondary" onClick={requestClose}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
