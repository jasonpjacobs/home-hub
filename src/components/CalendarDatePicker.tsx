import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Calendar, ChevronLeft, ChevronRight, X } from 'lucide-react';

interface Props {
  value: string;
  onChange: (nextDate: string) => void;
  minDate?: string;
  placeholder?: string;
  clearable?: boolean;
  inline?: boolean;
  align?: 'left' | 'right';
  placement?: 'down' | 'up';
  compact?: boolean;
  id?: string;
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const DAY_HEADERS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

function parseISO(str: string): { year: number; month: number; day: number } | null {
  if (!str || !/^\d{4}-\d{2}-\d{2}$/.test(str)) return null;
  const [year, month, day] = str.split('-').map(Number);
  return { year, month: month - 1, day };
}

function toISO(year: number, month: number, day: number) {
  const dt = new Date(Date.UTC(year, month, day, 12));
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getLocalTodayISO() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function formatDisplay(str: string) {
  const parsed = parseISO(str);
  if (!parsed) return '';
  const dt = new Date(Date.UTC(parsed.year, parsed.month, parsed.day, 12));
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(dt);
}

export function CalendarDatePicker({
  value,
  onChange,
  minDate,
  placeholder = 'Select date',
  clearable = false,
  inline = false,
  align = 'left',
  placement = 'down',
  compact = false,
  id,
}: Props) {
  const todayISO = useMemo(() => getLocalTodayISO(), []);
  const initial = parseISO(value) || parseISO(minDate || '') || parseISO(todayISO)!;

  const [open, setOpen] = useState(inline);
  const [viewYear, setViewYear] = useState(initial.year);
  const [viewMonth, setViewMonth] = useState(initial.month);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const parsed = parseISO(value);
    if (parsed) {
      setViewYear(parsed.year);
      setViewMonth(parsed.month);
    }
  }, [value]);

  useEffect(() => {
    if (inline || !open) return;
    function onDocMouseDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [inline, open]);

  const cells = useMemo(() => {
    const firstDow = new Date(Date.UTC(viewYear, viewMonth, 1, 12)).getUTCDay();
    const daysInMonth = new Date(Date.UTC(viewYear, viewMonth + 1, 0, 12)).getUTCDate();
    const out: Array<{ iso: string; day: number; outside: boolean }> = [];

    // Leading days from previous month
    const prevMonthDays = new Date(Date.UTC(viewYear, viewMonth, 0, 12)).getUTCDate();
    for (let i = firstDow - 1; i >= 0; i--) {
      const d = prevMonthDays - i;
      out.push({ iso: toISO(viewYear, viewMonth - 1, d), day: d, outside: true });
    }
    // Current month days
    for (let d = 1; d <= daysInMonth; d++) {
      out.push({ iso: toISO(viewYear, viewMonth, d), day: d, outside: false });
    }
    // Trailing days to complete the week row
    let nextDay = 1;
    while (out.length % 7 !== 0) {
      out.push({ iso: toISO(viewYear, viewMonth + 1, nextDay), day: nextDay, outside: true });
      nextDay++;
    }
    return out;
  }, [viewYear, viewMonth]);

  function shiftMonth(delta: number) {
    const next = new Date(Date.UTC(viewYear, viewMonth + delta, 1, 12));
    setViewYear(next.getUTCFullYear());
    setViewMonth(next.getUTCMonth());
  }

  function selectDate(iso: string) {
    onChange(iso);
    if (!inline) setOpen(false);
  }

  function quickOffset(days: number) {
    const base = parseISO(todayISO)!;
    const iso = toISO(base.year, base.month, base.day + days);
    selectDate(iso);
  }

  const calendarCard = (
    <div
      className={
        inline
          ? 'cal-inline'
          : `cal-popover ${align === 'right' ? 'align-right' : ''} ${placement === 'up' ? 'place-up' : ''}`
      }
    >
      <div className="cal-header">
        <button
          type="button"
          className="cal-nav-btn"
          onClick={() => shiftMonth(-1)}
          aria-label="Previous month"
        >
          <ChevronLeft size={16} />
        </button>
        <span className="cal-month-label">
          {MONTH_NAMES[viewMonth]} {viewYear}
        </span>
        <button
          type="button"
          className="cal-nav-btn"
          onClick={() => shiftMonth(1)}
          aria-label="Next month"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      <div className="cal-grid">
        {DAY_HEADERS.map((h) => (
          <div key={h} className="cal-dow">
            {h}
          </div>
        ))}
        {cells.map((cell) => {
          const isSelected = value === cell.iso;
          const isToday = todayISO === cell.iso;
          const isDisabled = Boolean(minDate && cell.iso < minDate);
          return (
            <button
              key={cell.iso}
              type="button"
              disabled={isDisabled}
              className={`cal-day ${cell.outside ? 'outside' : ''} ${isSelected ? 'selected' : ''} ${isToday ? 'today' : ''}`}
              onClick={() => selectDate(cell.iso)}
            >
              {cell.day}
            </button>
          );
        })}
      </div>

      <div className="cal-footer">
        <button
          type="button"
          className="cal-quick-btn"
          disabled={Boolean(minDate && todayISO < minDate)}
          onClick={() => quickOffset(0)}
        >
          Today
        </button>
        <button type="button" className="cal-quick-btn" onClick={() => quickOffset(1)}>
          Tomorrow
        </button>
        <button type="button" className="cal-quick-btn" onClick={() => quickOffset(7)}>
          +1 Week
        </button>
      </div>
    </div>
  );

  if (inline) return calendarCard;

  return (
    <div className="cal-wrap" ref={wrapRef}>
      <button
        id={id}
        type="button"
        className={`cal-trigger ${compact ? 'compact' : ''}`}
        onClick={() => setOpen((o) => !o)}
      >
        <Calendar size={15} style={{ color: 'var(--primary)', flexShrink: 0 }} />
        <span style={{ flex: 1, textAlign: 'left', color: value ? 'var(--text)' : 'var(--text-muted)' }}>
          {value ? formatDisplay(value) : placeholder}
        </span>
        {clearable && value && (
          <span
            role="button"
            tabIndex={0}
            className="cal-clear"
            onClick={(e) => {
              e.stopPropagation();
              onChange('');
              setOpen(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.stopPropagation();
                onChange('');
                setOpen(false);
              }
            }}
            aria-label="Clear date"
          >
            <X size={13} />
          </span>
        )}
      </button>

      {open && calendarCard}
    </div>
  );
}
