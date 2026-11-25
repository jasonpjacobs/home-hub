import React, { useEffect, useRef, useState } from 'react';
import { CircleDot, Clock, MessageSquareText, PauseCircle, ShieldAlert } from 'lucide-react';
import type { TaskInstance } from '../types';
import { CalendarDatePicker } from './CalendarDatePicker';

export type ActiveStatus = 'pending' | 'started' | 'on_hold' | 'gated';

export function isOpenStatus(status: TaskInstance['status']): boolean {
  return status === 'pending' || status === 'started' || status === 'on_hold' || status === 'gated';
}

export const STATUS_OPTIONS: Array<{
  value: ActiveStatus;
  label: string;
  tagClass: string;
  hint: string;
}> = [
  { value: 'pending', label: 'Not Started', tagClass: '', hint: 'Ready to begin' },
  { value: 'started', label: 'Started', tagClass: 'info', hint: 'In progress' },
  { value: 'on_hold', label: 'On Hold', tagClass: 'warning', hint: 'Paused for now' },
  { value: 'gated', label: 'Gated', tagClass: 'gated', hint: 'Waiting on someone or something' },
];

export function StatusBadge({ status }: { status: TaskInstance['status'] }) {
  if (status === 'started') {
    return (
      <span className="tag info">
        <CircleDot size={11} /> Started
      </span>
    );
  }
  if (status === 'on_hold') {
    return (
      <span className="tag warning">
        <PauseCircle size={11} /> On Hold
      </span>
    );
  }
  if (status === 'gated') {
    return (
      <span className="tag gated">
        <ShieldAlert size={11} /> Gated
      </span>
    );
  }
  return null;
}

interface Props {
  instance: TaskInstance;
  onSave: (payload: { status: ActiveStatus; notes: string; dueDate?: string }) => Promise<void>;
}

export function StatusNotePopover({ instance, onSave }: Props) {
  const initialStatus: ActiveStatus =
    instance.status === 'started' || instance.status === 'on_hold' || instance.status === 'gated'
      ? instance.status
      : 'pending';

  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<ActiveStatus>(initialStatus);
  const [notes, setNotes] = useState(instance.notes || '');
  const [followUpDate, setFollowUpDate] = useState('');
  const [saving, setSaving] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (open) {
      setStatus(initialStatus);
      setNotes(instance.notes || '');
      setFollowUpDate('');
    }
  }, [open, initialStatus, instance.notes]);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave({
        status,
        notes: notes.trim(),
        ...(followUpDate ? { dueDate: followUpDate } : {}),
      });
      setOpen(false);
    } finally {
      setSaving(false);
    }
  }

  const hasCustomState = initialStatus !== 'pending' || Boolean(instance.notes);

  return (
    <div className="defer-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`btn btn-sm ${hasCustomState ? 'btn-secondary' : 'btn-ghost'}`}
        onClick={() => setOpen((o) => !o)}
        title="Set status (Started, On Hold, Gated) or add a progress note"
      >
        <MessageSquareText size={13} />
        {initialStatus === 'pending'
          ? instance.notes
            ? 'Note'
            : 'Status'
          : STATUS_OPTIONS.find((s) => s.value === initialStatus)?.label}
      </button>

      {open && (
        <form className="status-popover" onSubmit={handleSubmit}>
          <div className="defer-title">Task Status &amp; Notes</div>

          <div className="status-grid">
            {STATUS_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`status-choice ${status === opt.value ? 'selected' : ''}`}
                onClick={() => setStatus(opt.value)}
              >
                <span>{opt.label}</span>
              </button>
            ))}
          </div>

          <div className="field" style={{ marginTop: 8 }}>
            <label htmlFor={`note-${instance.id}`} style={{ fontSize: '0.76rem' }}>
              Progress / Blocker Note
            </label>
            <textarea
              id={`note-${instance.id}`}
              className="textarea"
              rows={2}
              style={{ fontSize: '0.83rem', padding: '7px 9px' }}
              placeholder="e.g., Dr. Sims is OOO until Aug 15th"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <div className="field" style={{ marginTop: 6 }}>
            <label style={{ fontSize: '0.76rem', display: 'flex', alignItems: 'center', gap: 4 }}>
              <Clock size={11} /> Optional Follow-Up Date
            </label>
            <CalendarDatePicker
              value={followUpDate}
              onChange={setFollowUpDate}
              placeholder="Keep current date"
              clearable
              compact
              align="right"
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 10 }}>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
