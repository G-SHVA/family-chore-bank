# Family Chore Bank — Design System

Premium bespoke aesthetic. Dark, restrained, editorial. Structure comes from
hairlines and typography, not from fills and glow. Gold is a scarce resource.

Tablet kiosk first. Dark theme only.

---

## 1. Color tokens

Declared as CSS custom properties in `src/styles/globals.css` and mirrored as
Tailwind names in `tailwind.config.ts`.

| CSS variable            | Value                      | Tailwind    | Role |
| ----------------------- | -------------------------- | ----------- | ---- |
| `--color-bg-primary`    | `#1C1C1E`                  | `bg-bg`     | Page background |
| `--color-bg-deep`       | `#0D0D0F`                  | `bg-deep`   | Recessed chrome: sidebar, nav bars, input wells, tab strips, modal scrim |
| `--color-bg-card`       | `#1C1C1E`                  | `bg-card`   | Card fill |
| `--color-bg-wash`       | `rgba(224,188,132,0.06)`   | `bg-wash`   | Antique-gold tint for hover / selected states |
| `--color-gold-primary`  | `#E6B800`                  | `text-gold` `bg-gold` | The one primary action per screen |
| `--color-gold-antique`  | `#E0BC84`                  | `text-antique` `border-antique` | All other gold: borders, labels, currency, accents |
| `--color-green`         | `#4A9B6F`                  | `text-green` | Money earned, positive state |
| `--color-text-primary`  | `#D4D0C8`                  | `text-text` | Body copy, headings |
| `--color-text-secondary`| `#8A8680`                  | `text-text-muted` | Labels, captions, meta |
| `--color-border`        | `rgba(224,188,132,0.15)`   | `border-line` | Standard hairline on cards, inputs, chips |
| `--color-spine`         | `rgba(224,188,132,0.3)`    | `border-spine` | Structural spine under headers and nav |

`danger` (`#E05252`) is retained for destructive actions and error states.

### Cards are defined by their hairline, not by fill

`--color-bg-primary` and `--color-bg-card` are deliberately the same value. A
card does not float above the page on a lighter fill — it is drawn by its
`border-line` hairline. Depth in the interface comes from `--color-bg-deep`,
which recesses the chrome *behind* the content plane.

**Never** put a gold fill on a card or a page background. Antique gold appears
as line, text, and the 6%-opacity `bg-wash` only.

---

## 2. Typography

Loaded in `index.html` from Google Fonts:
`Cormorant+Garamond:wght@600` and `Inter:wght@400;500;600;700`.

### Display — Cormorant Garamond 600

Applied automatically to `h1`, `h2`, `h3` via an `@layer base` rule. Use the
`.display` class for non-heading elements that need the serif.

Where it appears:

- All `h1` / `h2` / `h3` headings on every page
- Page titles — Parent Dashboard, Manage, Settings, My Chores
- Large balance figures on both parent and child dashboards (`BalanceDisplay`
  carries `.display` by default)
- Stat figures, member names, record titles
- KioskSelect family name, clock, welcome text, and member names

### UI / body — Inter

`font-sans`, set on `body`. Default weight 400; 500–600 for emphasis.

### `.label-caps`

Inter, `text-transform: uppercase`, `letter-spacing: 0.08em`, weight 600.
Sizes run small — `text-[10px]` to `text-xs`.

Applied to:

- All label text and stat captions
- Category tags, value badges, status pills, chips
- Navigation items (both layouts)
- **All button text** (baked into the `Button` component)

Never use `uppercase tracking-wide` ad hoc — use `.label-caps` so the letter
spacing stays consistent.

---

## 3. Geometry

Radius is driven by CSS variables, so a component never needs to know which
context it is rendered in.

```css
:root                     { --radius-card: 0px; --radius-input: 0px; }
[data-surface='child']    { --radius-card: 4px; --radius-input: 4px; }
```

`ChildLayout` sets `data-surface="child"` on its root element. Every descendant
card, button, input, modal and chip inherits 4px automatically.

| Context | Radius |
| ------- | ------ |
| Parent / admin views — cards, buttons, inputs, modals | **0px**, squared throughout |
| Child views — dashboard, chores, bank, achievements | **4px** |
| KioskSelect avatar cards | **4px** (explicit `rounded-[4px]`) |
| Login, KioskSelect chrome | 0px (root default) |

Avatars and PIN dots stay `rounded-full` — circular portraiture is not a "card,
button, input, or modal" and reads as intentional against the squared frame.

Use `rounded-card` / `rounded-input`, never a hardcoded radius.

---

## 4. Structural spine

A single hairline anchors every header and nav bar:

```css
.spine     { border-bottom: 1px solid var(--color-spine); }  /* rgba(224,188,132,0.3) */
.spine-top { border-top:    1px solid var(--color-spine); }
```

Applied to:

- `ParentLayout` — sidebar brand block (`.spine`)
- `ChildLayout` — header (`.spine`); bottom nav uses `.spine-top`, because a
  bottom-docked bar meets content at its **top** edge. Same weight, same color.
- `KioskSelect` — header (`.spine`)
- `Login` — logo/title header block (`.spine`)
- `Modal` — title row (`.spine`), **only when the modal has a title**; a
  close-only header (the PIN pad) would otherwise draw an empty banded row
- Parent page titles — Parent Dashboard, Manage, Settings (`.spine`)

---

## 5. Gold discipline

The rule that makes the aesthetic work. Primary gold is an event, not a texture.

### Parent and admin views

- **Exactly one primary-gold element per screen**, and it is always the primary
  action button — Approve, Save, Assign, Create, Sign In.
- Everything else that used to be gold is now **antique** (`#E0BC84`): borders,
  labels, currency symbols, streak flames, avatar rings, structural accents.
- No gold fills on cards or backgrounds.

Where two actions competed for the one gold slot, the dominant action won and
the other stepped down to the `accent` variant:

| Screen | Primary gold | Stepped down to antique |
| ------ | ------------ | ----------------------- |
| Parent Dashboard | Approve (`primaryList`) | Quick Add submit |
| Rewards tab | Approve / Mark fulfilled (`primaryList`) | Create Reward |

### Child views

- Balance amount display — **primary gold**
- Mark Complete button — **primary gold**
- Everything else antique: streak badge, value badges on chore cards, nav,
  filter tabs, reward figures.

### KioskSelect

- **No primary gold at all.**
- Antique borders on the avatar cards only.
- Active / selected card: antique border, 2px.

### `Button` variants

| Variant | Use |
| ------- | --- |
| `primary` | Solid gold fill. A **singular** dominant action — Sign In, Save, Create, Add Member. |
| `primaryList` | Gold **outline**. A primary action that **repeats down a list** — Approve, Mark Complete, redemption queue. |
| `accent` | Antique outline. Affirmative actions that lost the gold slot. |
| `secondary`| Neutral card fill with hairline. Cancel, toggle, navigate. |
| `ghost` | Text only. Tertiary. |
| `danger` | Destructive. Reject, Delete, Remove. |

All variants render text as `.label-caps`.

### Fill is for singular actions only

A solid gold block is the loudest thing on any screen, so it is spent on an
action that appears **once**. When the primary action repeats — five pending
approvals, eight open chores — it renders as `primaryList`: same `#E6B800`,
outlined instead of filled.

This was settled by looking at the real screen: five solid gold Approve buttons
stacked down the parent dashboard swamped everything else and defeated the
point of the palette. Outlined, they pair naturally with the outlined `danger`
Reject beside them, and the 64px kiosk touch target is unchanged.

The rule is about **visual mass, not hue** — a list action is still primary gold
and still the one gold role on its screen.

---

## 6. Kiosk constraints

Unchanged by this revision:

- Minimum touch target 64px (`min-h-touch` / `min-w-touch`)
- Support both landscape and portrait
- Bottom nav on child views
- Minimum body text 16px; balance figures 48px+ (currently 56px)
- Lucide React icons only — never emoji as icons


---

## 7. Verified screen audit

Measured in Chrome against the running app (computed styles, not inspection).
"Solid" = `background-color: #E6B800`; "outline" = gold text + gold border.

| Screen | Solid gold | Gold outline | Radius | Header spine |
| ------ | ---------- | ------------ | ------ | ------------ |
| Login | 1 — Sign In | 0 | 0px | yes |
| KioskSelect | 0 | 0 | 4px cards | yes |
| Parent Dashboard | 0 | N — Approve | 0px | yes |
| Chore Management | 1 — Create Chore | 0 | 0px | yes |
| Child Dashboard | 0 | balance is gold **text** | 4px | yes + nav top |
| Child Bank | 0 | balance is gold **text** | 4px | yes + nav top |
| Achievements | 0 | 0 | 4px | yes + nav top |

Achievements carries no gold because it has neither a balance figure nor a
Mark Complete button — the only two gold roles defined for child views.

The logo PNG is primary gold on Login and KioskSelect. It is a raster brand
asset outside the token system and is deliberately exempt from the gold budget.
