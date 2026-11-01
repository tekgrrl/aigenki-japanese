"use client";

import React from "react";

interface ArrayFieldEditorProps<T> {
  items: T[];
  onChange: (items: T[]) => void;
  renderRow: (item: T, index: number, update: (patch: Partial<T>) => void) => React.ReactNode;
  emptyItem: () => T;
  addLabel?: string;
  label?: string;
}

export default function ArrayFieldEditor<T>({
  items,
  onChange,
  renderRow,
  emptyItem,
  addLabel = "+ Add",
  label,
}: ArrayFieldEditorProps<T>) {
  const updateAt = (index: number) => (patch: Partial<T>) => {
    onChange(items.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };

  const removeAt = (index: number) => {
    onChange(items.filter((_, i) => i !== index));
  };

  const addItem = () => {
    onChange([...items, emptyItem()]);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        {label ? (
          <label className="block text-xs font-bold text-shodo-ink-light uppercase tracking-wide">
            {label}
          </label>
        ) : (
          <span />
        )}
        <button
          type="button"
          onClick={addItem}
          className="text-xs text-shodo-indigo hover:text-shodo-indigo/70 transition-colors"
        >
          {addLabel}
        </button>
      </div>

      <div className="space-y-2">
        {items.map((item, index) => (
          <div
            key={index}
            className="flex gap-2 items-start border border-shodo-mist rounded p-3 bg-white dark:bg-shodo-paper-warm"
          >
            <div className="flex-1 space-y-2">{renderRow(item, index, updateAt(index))}</div>
            <button
              type="button"
              onClick={() => removeAt(index)}
              className="text-shodo-ink-light hover:text-shodo-stamp-red transition-colors px-1 shrink-0"
              aria-label="Remove item"
            >
              ✕
            </button>
          </div>
        ))}
        {items.length === 0 && (
          <p className="text-xs text-shodo-ink-light italic">No items yet.</p>
        )}
      </div>
    </div>
  );
}
