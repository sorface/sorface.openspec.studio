"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

export interface CustomSelectOption {
  label: string;
  value: string;
}

interface CustomSelectProps {
  ariaLabel: string;
  onChange: (value: string) => void;
  options: CustomSelectOption[];
  value: string;
}

export function CustomSelect({ ariaLabel, onChange, options, value }: CustomSelectProps) {
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(value);
  const rootRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  const selected = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, [open]);

  const moveHighlight = (direction: 1 | -1) => {
    const currentIndex = Math.max(0, options.findIndex((option) => option.value === highlighted));
    const nextIndex = (currentIndex + direction + options.length) % options.length;
    setHighlighted(options[nextIndex]?.value ?? "");
  };

  const select = (nextValue: string) => {
    onChange(nextValue);
    setHighlighted(nextValue);
    setOpen(false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setHighlighted(value || options[0]?.value || "");
      } else {
        moveHighlight(event.key === "ArrowDown" ? 1 : -1);
      }
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (open && highlighted !== value) select(highlighted);
      else setOpen((current) => !current);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div className={`custom-select ${open ? "open" : ""}`} ref={rootRef}>
      <button
        className="custom-select-trigger"
        type="button"
        aria-label={ariaLabel}
        aria-controls={listboxId}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => {
          setHighlighted(value || options[0]?.value || "");
          setOpen((current) => !current);
        }}
        onKeyDown={handleKeyDown}
      >
        <span>{selected?.label ?? "Не выбрано"}</span>
        <svg className="custom-select-chevron" aria-hidden="true" viewBox="0 0 16 16">
          <path d="m4 6.5 4 4 4-4" />
        </svg>
      </button>
      {open && (
        <div className="custom-select-menu" id={listboxId} role="listbox" aria-label={ariaLabel}>
          {options.map((option) => (
            <button
              className={`${option.value === value ? "selected" : ""} ${option.value === highlighted ? "highlighted" : ""}`}
              key={option.value || "default"}
              type="button"
              role="option"
              aria-selected={option.value === value}
              onPointerEnter={() => setHighlighted(option.value)}
              onClick={() => select(option.value)}
            >
              <span>{option.label}</span>
              {option.value === value && <em aria-hidden="true">✓</em>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
