import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Folder, Lock, Plus, X } from 'lucide-react';
import { api } from '../api';
import type { Category } from '../types';

export function buildCategoryPathOptions(categories: Category[]) {
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
      return { id: c.id, name: c.name, label: parts.join(' > '), visibility: c.visibility };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

interface Props {
  categories: Category[];
  value: string;
  onChange: (categoryId: string) => void;
  visibility?: 'household' | 'private';
  onCategoryCreated?: (created: Category) => Promise<void> | void;
  placeholder?: string;
  emptyLabel?: string;
  compact?: boolean;
  id?: string;
}

export function CategoryCombobox({
  categories,
  value,
  onChange,
  visibility = 'household',
  onCategoryCreated,
  placeholder = 'Type or select category...',
  emptyLabel = 'Uncategorized',
  compact = false,
  id,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [localCreated, setLocalCreated] = useState<Category[]>([]);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Merge prop categories with any newly created category in case parent refresh is still in flight
  const mergedCategories = useMemo(() => {
    const map = new Map<string, Category>();
    for (const c of categories) map.set(c.id, c);
    for (const c of localCreated) {
      if (!map.has(c.id)) map.set(c.id, c);
    }
    return Array.from(map.values());
  }, [categories, localCreated]);

  const options = useMemo(() => {
    return buildCategoryPathOptions(mergedCategories).filter((c) =>
      visibility === 'private' ? c.visibility === 'private' : c.visibility !== 'private',
    );
  }, [mergedCategories, visibility]);

  const selectedOption = useMemo(
    () => options.find((o) => o.id === value) || null,
    [options, value],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  const trimmedQuery = query.trim();
  const hasExactMatch = useMemo(() => {
    if (!trimmedQuery) return true;
    const lower = trimmedQuery.toLowerCase();
    return options.some(
      (o) => o.label.toLowerCase() === lower || o.name.toLowerCase() === lower,
    );
  }, [options, trimmedQuery]);

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    }
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [open]);

  async function handleCreateInline() {
    if (!trimmedQuery || creating) return;
    setCreating(true);
    try {
      // Support "Parent > Child" syntax to create a subcategory inline!
      let parentCategoryId = '';
      let finalName = trimmedQuery;
      if (trimmedQuery.includes('>')) {
        const parts = trimmedQuery
          .split('>')
          .map((s) => s.trim())
          .filter(Boolean);
        if (parts.length >= 2) {
          finalName = parts[parts.length - 1];
          const parentPath = parts.slice(0, -1).join(' > ').toLowerCase();
          const matchedParent = options.find(
            (o) => o.label.toLowerCase() === parentPath || o.name.toLowerCase() === parentPath,
          );
          if (matchedParent) parentCategoryId = matchedParent.id;
        }
      }

      const res = await api.createCategory({
        name: finalName,
        parentCategoryId,
        visibility,
      });
      setLocalCreated((prev) => [...prev, res.category]);
      onChange(res.category.id);
      setQuery('');
      setOpen(false);
      if (onCategoryCreated) {
        await onCategoryCreated(res.category);
      }
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="combo-wrap" ref={wrapRef}>
      <div
        className={`combo-input-box ${compact ? 'compact' : ''} ${open ? 'focused' : ''}`}
        onClick={() => {
          setOpen(true);
          inputRef.current?.focus();
        }}
      >
        {visibility === 'private' ? (
          <Lock size={13} style={{ color: 'var(--private)', flexShrink: 0 }} />
        ) : (
          <Folder size={13} style={{ color: 'var(--primary)', flexShrink: 0 }} />
        )}
        <input
          id={id}
          ref={inputRef}
          type="text"
          className="combo-input"
          placeholder={selectedOption ? selectedOption.label : placeholder}
          value={open ? query : selectedOption ? selectedOption.label : ''}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!open) setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setOpen(false);
              setQuery('');
            } else if (e.key === 'Enter' && open) {
              e.preventDefault();
              if (filtered.length === 1) {
                onChange(filtered[0].id);
                setQuery('');
                setOpen(false);
              } else if (trimmedQuery && !hasExactMatch) {
                handleCreateInline();
              }
            }
          }}
        />
        {value && !open ? (
          <button
            type="button"
            className="cal-clear"
            onClick={(e) => {
              e.stopPropagation();
              onChange('');
              setQuery('');
            }}
            title="Clear category"
            aria-label="Clear category"
          >
            <X size={13} />
          </button>
        ) : (
          <ChevronDown size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
        )}
      </div>

      {open && (
        <div className="combo-menu">
          {!trimmedQuery && (
            <button
              type="button"
              className={`combo-option ${value === '' ? 'selected' : ''}`}
              onClick={() => {
                onChange('');
                setQuery('');
                setOpen(false);
              }}
            >
              <span style={{ color: 'var(--text-muted)' }}>{emptyLabel}</span>
            </button>
          )}

          {filtered.map((opt) => (
            <button
              key={opt.id}
              type="button"
              className={`combo-option ${value === opt.id ? 'selected' : ''}`}
              onClick={() => {
                onChange(opt.id);
                setQuery('');
                setOpen(false);
              }}
            >
              <span>{opt.label}</span>
            </button>
          ))}

          {trimmedQuery && !hasExactMatch && (
            <button
              type="button"
              className="combo-option create"
              disabled={creating}
              onClick={handleCreateInline}
            >
              <Plus size={14} />
              <span>
                {creating
                  ? 'Creating...'
                  : `Create "${trimmedQuery}"${visibility === 'private' ? ' (Private)' : ''}`}
              </span>
            </button>
          )}

          {filtered.length === 0 && hasExactMatch && (
            <div style={{ padding: '8px 10px', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
              No matching categories
            </div>
          )}
        </div>
      )}
    </div>
  );
}
