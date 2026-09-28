import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * A searchable replacement for a long native <select> on parent screens.
 *
 * WHY. Quick Add's chore dropdown held ~73 options and the expense one ~30. On
 * a tablet a native <select> opens a system wheel the parent has to flick
 * through; typing "mow" is faster than scrolling to M.
 *
 * MATCHING: prefix matches first, then substring matches, each group in the
 * caller's original order — so "mow" ranks "Mow Lawn" above "Remove lawn
 * clippings". Only `label` is searched; `detail` is display-only, so typing
 * "daily" does not match every daily chore by its frequency suffix.
 *
 * NOT A PRIMARY ELEMENT. It is a utility control: the only gold it carries is
 * antique, on the currently selected option. The screen's gold budget belongs
 * to its submit action.
 *
 * shrink-0 ON THE ROOT, first — see the SHRINK-0 TRAP in CLAUDE.md. Any
 * `flex flex-col` parent that overflows would otherwise squash it silently.
 */
export interface SearchableOption {
  value: string
  label: string
  /** Muted secondary text on the right of the option (price, frequency). Not searched. */
  detail?: string
}

interface SearchableSelectProps {
  options: SearchableOption[]
  value: string | null
  onChange: (value: string) => void
  placeholder: string
  disabled?: boolean
  id?: string
  'aria-label'?: string
}

export function rankOptions(options: SearchableOption[], query: string): SearchableOption[] {
  const q = query.trim().toLowerCase()
  if (!q) return options
  const starts: SearchableOption[] = []
  const contains: SearchableOption[] = []
  for (const o of options) {
    const label = o.label.toLowerCase()
    if (label.startsWith(q)) starts.push(o)
    else if (label.includes(q)) contains.push(o)
  }
  return [...starts, ...contains]
}

export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder,
  disabled,
  id,
  'aria-label': ariaLabel,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const listId = useId()

  const selected = options.find((o) => o.value === value) ?? null
  const filtered = useMemo(() => rankOptions(options, query), [options, query])

  // Outside click closes. pointerdown rather than click so a tap elsewhere on a
  // tablet closes the panel before whatever it landed on reacts.
  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) close()
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  // Keep the keyboard-highlighted option in view as arrows move it.
  useEffect(() => {
    if (!open) return
    const el = listRef.current?.children[active] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  function openPanel() {
    if (disabled) return
    setQuery('')
    // Start on the current selection so Enter without typing keeps it.
    const idx = selected ? options.findIndex((o) => o.value === selected.value) : 0
    setActive(Math.max(0, idx))
    setOpen(true)
  }

  function close() {
    setOpen(false)
    setQuery('')
  }

  function choose(option: SearchableOption) {
    onChange(option.value)
    close()
    inputRef.current?.blur()
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!open) return openPanel()
      setActive((i) => Math.min(i + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) return openPanel()
      setActive((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      if (!open) return
      e.preventDefault()
      const option = filtered[active]
      if (option) choose(option)
    } else if (e.key === 'Escape') {
      if (!open) return
      e.preventDefault()
      close()
    } else if (e.key === 'Tab') {
      close()
    }
  }

  return (
    <div ref={rootRef} className="relative w-full shrink-0">
      <input
        ref={inputRef}
        id={id}
        type="text"
        role="combobox"
        aria-label={ariaLabel ?? placeholder}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && filtered[active] ? `${listId}-${active}` : undefined}
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        // Closed: the input shows the selection. Open: it is a search box, with
        // the current selection kept visible as the placeholder.
        value={open ? query : (selected?.label ?? '')}
        placeholder={open && selected ? selected.label : placeholder}
        onFocus={openPanel}
        onClick={() => {
          if (!open) openPanel()
        }}
        onChange={(e) => {
          setQuery(e.target.value)
          setActive(0)
          if (!open) setOpen(true)
        }}
        onKeyDown={onKeyDown}
        className={cn(
          'min-h-touch w-full rounded-input border border-line bg-deep py-3 pl-3 pr-10 text-text',
          'placeholder:text-text-muted focus:border-antique focus:outline-none',
          'disabled:cursor-not-allowed disabled:opacity-50'
        )}
      />
      <ChevronDown
        aria-hidden
        className={cn(
          'pointer-events-none absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-text-muted',
          'transition-transform duration-150',
          open && 'rotate-180'
        )}
      />

      {open && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          className={cn(
            'scroll-panel absolute left-0 right-0 top-full z-30 mt-1 max-h-48 overflow-y-auto',
            'rounded-input border border-line bg-card py-1 shadow-2xl'
          )}
        >
          {filtered.length === 0 ? (
            <li className="flex h-10 items-center px-3 text-sm text-text-muted">No results</li>
          ) : (
            filtered.map((o, i) => {
              const isSelected = o.value === value
              return (
                <li
                  key={o.value}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={isSelected}
                  // Keep focus in the input so the outside-click and blur
                  // paths never race the selection.
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => choose(o)}
                  onMouseMove={() => {
                    if (active !== i) setActive(i)
                  }}
                  className={cn(
                    'flex h-10 cursor-pointer items-center justify-between gap-3 px-3 text-sm',
                    i === active && 'bg-wash',
                    isSelected ? 'text-antique' : 'text-text'
                  )}
                >
                  <span className="truncate">{o.label}</span>
                  {o.detail && (
                    <span className="shrink-0 text-xs text-text-muted">{o.detail}</span>
                  )}
                </li>
              )
            })
          )}
        </ul>
      )}
    </div>
  )
}
