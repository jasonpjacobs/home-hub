import React, { useEffect, useRef, useState } from 'react';
import { Calendar, Clock } from 'lucide-react';
import { CalendarDatePicker } from './CalendarDatePicker';

interface Props {
  onDefer: (payload: { days?: number; untilDate?: string }) => Promise<void>;
  minDate?: string;
}

export function DeferMenu({ onDefer, minDate }: Props) {
  const [open, setOpen] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        setShowCalendar(false);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  async function pick(payload: { days?: number; untilDate?: string }) {
    setOpen(false);
    setShowCalendar(false);
    await onDefer(payload);
  }

  return (
    <div className="defer-wrap" ref={wrapRef}>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() => {
          setOpen((o) => !o);
          setShowCalendar(false);
        }}
        title="Defer to a later date"
      >
        <Clock size={14} /> Defer
      </button>

      {open && (
        <div className={`defer-popover ${showCalendar ? 'wide' : ''}`}>
          <div className="defer-title">Defer task until...</div>
          {!showCalendar ? (
            <>
              <button type="button" className="defer-opt" onClick={() => pick({ days: 1 })}>
                Tomorrow (+1 day)
              </button>
              <button type="button" className="defer-opt" onClick={() => pick({ days: 3 })}>
                In 3 days
              </button>
              <button type="button" className="defer-opt" onClick={() => pick({ days: 7 })}>
                Next week (+7 days)
              </button>
              <button type="button" className="defer-opt" onClick={() => pick({ days: 30 })}>
                Next month (+30 days)
              </button>
              <div style={{ borderTop: '1px solid var(--border)', marginTop: 4, paddingTop: 4 }}>
                <button
                  type="button"
                  className="defer-opt"
                  style={{ display: 'flex', alignItems: 'center', gap: 7, fontWeight: 600, color: 'var(--primary)' }}
                  onClick={() => setShowCalendar(true)}
                >
                  <Calendar size={14} /> Pick date on calendar...
                </button>
              </div>
            </>
          ) : (
            <CalendarDatePicker
              inline
              value=""
              minDate={minDate}
              onChange={(iso) => iso && pick({ untilDate: iso })}
            />
          )}
        </div>
      )}
    </div>
  );
}
