# ARCHITECTURE MAP — §2 SHARED FOUNDATION / DESIGN SYSTEM

Scope: the 36 files that make up the design-system foundation — the token source
(`app/globals.css`), every `components/ui/*` primitive, the shared shell components, the
chart infrastructure, and the format/util libs. Every claim below cites `file:line` and
quotes the actual code. Evidence is the file, never CLAUDE.md.

Coverage: **36 of 36 files documented, 0 SKIPPED.**

---

## 2a. DESIGN TOKENS — `app/globals.css` (302 lines, read in full)

### Tailwind v4 wiring (top of file)

```css
1  @import "tailwindcss";
2  @import "tw-animate-css";
3  @import "shadcn/tailwind.css";
5  @custom-variant dark (&:is(.dark *));
```

- Tailwind v4 is pulled in via `@import "tailwindcss"` (line 1), not a config file.
- `tw-animate-css` (line 2) supplies the `data-open:animate-in` / `data-closed:animate-out`
  / `zoom-in-95` / `slide-in-from-*` utilities the dialog/select/dropdown popups use.
- **Dark-mode mechanism (line 5):** `@custom-variant dark (&:is(.dark *))` — the `dark:`
  variant matches when any ancestor carries the `.dark` CLASS. There is **no
  `:root[data-theme]` selector**; theme is a class on an ancestor. The `.dark` block
  (lines 139–207) redefines every token. **Divergence note:** the print block comments
  "The app has no reachable dark mode; pin light for print" (`app/globals.css:227`), i.e.
  `.dark` is defined but not currently toggled by any reachable UI in this app. `sonner.tsx`
  is the only assigned file that reads a theme (`useTheme()` from `next-themes`,
  `components/ui/sonner.tsx:3,8`), implying `next-themes` is the intended toggle mechanism.

### `@theme inline` — token→utility bridge (lines 7–52)

Maps the raw `--*` custom properties to Tailwind's `--color-*` / `--radius-*` utility
namespace so `bg-card`, `text-muted-foreground`, `rounded-xl` etc. resolve. Every entry:

| Utility var (line) | Points at |
|---|---|
| `--color-background` (8) / `--color-foreground` (9) | `var(--background)` / `var(--foreground)` |
| `--font-sans` (10) / `--font-mono` (11) / `--font-heading` (12) | `var(--font-sans)` / `var(--font-geist-mono)` / `var(--font-sans)` |
| `--color-sidebar-*` (13–20) | 8 sidebar tokens (`--sidebar-ring`,`-border`,`-accent-foreground`,`-accent`,`-primary-foreground`,`-primary`,`-foreground`,`--sidebar`) |
| `--color-chart-1..8` (21–28) | `var(--chart-1..8)` (reverse order in source) |
| `--color-ring`/`-input`/`-border`/`-destructive` (29–32) | matching tokens |
| `--color-accent[-foreground]`/`-muted[-foreground]`/`-secondary[-foreground]`/`-primary[-foreground]`/`-popover[-foreground]`/`-card[-foreground]` (33–44) | matching tokens |

**Radius scale (lines 45–51)** — all derived from one base `--radius`:

```css
45  --radius-sm: calc(var(--radius) * 0.6);
46  --radius-md: calc(var(--radius) * 0.8);
47  --radius-lg: var(--radius);
48  --radius-xl: calc(var(--radius) * 1.4);
49  --radius-2xl: calc(var(--radius) * 1.8);
50  --radius-3xl: calc(var(--radius) * 2.2);
51  --radius-4xl: calc(var(--radius) * 2.6);
```

`--radius` itself is `0.625rem` (`app/globals.css:128`). So `rounded-xl` (used by Card,
DialogContent) = `0.875rem`; `rounded-4xl` (used by Badge, line 8 of badge.tsx) = `1.625rem`
(pill).

### Color token groups — LIGHT (`:root`, 54–137) vs DARK (`.dark`, 139–207)

**Base shadcn semantic tokens** (Slate base, oklch):

| Token | Light (line) | Dark (line) |
|---|---|---|
| `--background` | `oklch(1 0 0)` (55) | `oklch(0.129 0.042 264.695)` (140) |
| `--foreground` | `oklch(0.129 0.042 264.695)` (56) | `oklch(0.984 0.003 247.858)` (141) |
| `--card` | `oklch(1 0 0)` (57) | `oklch(0.208 0.042 265.755)` (142) |
| `--card-foreground` | `oklch(0.129 0.042 264.695)` (58) | `oklch(0.984 0.003 247.858)` (143) |
| `--popover` | `oklch(1 0 0)` (59) | `oklch(0.208 0.042 265.755)` (144) |
| `--popover-foreground` | `oklch(0.129 …)` (60) | `oklch(0.984 …)` (145) |
| `--primary` | `oklch(0.208 0.042 265.755)` (61) | `oklch(0.929 0.013 255.508)` (146) |
| `--primary-foreground` | `oklch(0.984 0.003 247.858)` (62) | `oklch(0.208 0.042 265.755)` (147) |
| `--secondary` | `oklch(0.968 0.007 247.896)` (63) | `oklch(0.279 0.041 260.031)` (148) |
| `--secondary-foreground` | `oklch(0.208 …)` (64) | `oklch(0.984 …)` (149) |
| `--muted` | `oklch(0.968 0.007 247.896)` (65) | `oklch(0.279 0.041 260.031)` (150) |
| `--muted-foreground` | `oklch(0.554 0.046 257.417)` (66) | `oklch(0.704 0.04 256.788)` (151) |
| `--accent` | `oklch(0.968 0.007 247.896)` (67) | `oklch(0.279 0.041 260.031)` (152) |
| `--accent-foreground` | `oklch(0.208 …)` (68) | `oklch(0.984 …)` (153) |
| `--destructive` | `oklch(0.577 0.245 27.325)` (69) | `oklch(0.704 0.191 22.216)` (154) |
| `--border` | `oklch(0.929 0.013 255.508)` (70) | `oklch(1 0 0 / 10%)` (155) |
| `--input` | `oklch(0.929 0.013 255.508)` (71) | `oklch(1 0 0 / 15%)` (156) |
| `--ring` | `oklch(0.704 0.04 256.788)` (72) | `oklch(0.551 0.027 264.364)` (157) |

Note: there is **no `--secondary`/`--accent` divergence** — they share the same oklch as
`--muted` in both themes.

**Chart palette `--chart-1..8` + `--chart-line`** (light 76–85, dark 159–167). Light = the
prior hardcoded hex (comment lines 73–75: "light values preserve the prior hardcoded
CHART_COLORS"); dark = brightened ≈Tailwind *-400 (comment 158).

| Token | Light | Dark |
|---|---|---|
| `--chart-1` | `#3b82f6` (76) | `#60a5fa` (159) |
| `--chart-2` | `#10b981` (77) | `#34d399` (160) |
| `--chart-3` | `#f59e0b` (78) | `#fbbf24` (161) |
| `--chart-4` | `#ef4444` (79) | `#f87171` (162) |
| `--chart-5` | `#8b5cf6` (80) | `#a78bfa` (163) |
| `--chart-6` | `#06b6d4` (81) | `#22d3ee` (164) |
| `--chart-7` | `#ec4899` (82) | `#f472b6` (165) |
| `--chart-8` | `#84cc16` (83) | `#a3e635` (166) |
| `--chart-line` (Pareto cumulative overlay, comment 84) | `#334155` (85) | `#94a3b8` (167) |

**Semantic analysis colors** — ABC / Kraljic quadrant / performance zone. Comment (86–87):
"--abc-a and --quadrant-strategic intentionally share red — separate tokens."

| Token | Light | Dark |
|---|---|---|
| `--abc-a` | `#ef4444` (88) | `#f87171` (168) |
| `--abc-b` | `#f59e0b` (89) | `#fbbf24` (169) |
| `--abc-c` | `#84cc16` (90) | `#a3e635` (170) |
| `--quadrant-strategic` | `#ef4444` (91) | `#f87171` (171) |
| `--quadrant-leverage` | `#10b981` (92) | `#34d399` (172) |
| `--quadrant-bottleneck` | `#f59e0b` (93) | `#fbbf24` (173) |
| `--quadrant-routine` | `#3b82f6` (94) | `#60a5fa` (174) |
| `--zone-stars` | `#10b981` (95) | `#34d399` (175) |
| `--zone-critical` | `#ef4444` (96) | `#f87171` (176) |
| `--zone-hidden-gems` | `#8b5cf6` (97) | `#a78bfa` (177) |
| `--zone-long-tail` | `#94a3b8` (98) | `#cbd5e1` (178) |

**StatBlock accent helpers** (comment 99): `--warning` `#f59e0b`(100)/`#fbbf24`(179);
`--success` `#84cc16`(101)/`#a3e635`(180). (`--destructive` reused from the base tokens.)

**Cross-Analysis Anomaly Hub temporal accent** (comment 102–103): `--temporal`
`#0891b2`(104, "Light ≈ cyan-600") / `#22d3ee`(181, "dark ≈ cyan-400 (brighter)").

**Action Priorities category colors `--priority-*`** — one per recommendation bucket
(comment 105–113):

| Token | Light (line) | Dark (line) | Meaning (source comment) |
|---|---|---|---|
| `--priority-engage` | `#ef4444` (107) | `#f87171` (183) | red |
| `--priority-mitigate` | `#f59e0b` (108) | `#fbbf24` (184) | amber |
| `--priority-promote` | `#10b981` (109) | `#34d399` (185) | green |
| `--priority-improve` | `#3b82f6` (110) | `#60a5fa` (186) | blue |
| `--priority-concentrate` | `#8b5cf6` (111) | `#a78bfa` (187) | violet |
| `--priority-steward` | `#0891b2` (114) | `#22d3ee` (188) | cyan — critical_spend |
| `--priority-consolidate` | `#0d9488` (115) | `#2dd4bf` (189) | teal — tail_spend |
| `--priority-slowstage` | `#6366f1` (116) | `#818cf8` (190) | indigo — slow_stage (NOT improve's blue — they share the Process group) |

All 8 `--priority-*` tokens named in the spec are present and accounted for.

**Category palette `--category-1..8`** — deliberately a separate family from `--abc-*` /
`--quadrant-*` (comment 117–119: "no pure red/amber/lime/green … Blues/violets/cyans/magentas"):

| Token | Light | Dark |
|---|---|---|
| `--category-1` | `#2563eb` (120) | `#60a5fa` (191) |
| `--category-2` | `#7c3aed` (121) | `#a78bfa` (192) |
| `--category-3` | `#0891b2` (122) | `#22d3ee` (193) |
| `--category-4` | `#db2777` (123) | `#f472b6` (194) |
| `--category-5` | `#4f46e5` (124) | `#818cf8` (195) |
| `--category-6` | `#9333ea` (125) | `#c084fc` (196) |
| `--category-7` | `#0e7490` (126) | `#67e8f9` (197) |
| `--category-8` | `#64748b` (127) | `#94a3b8` (198) |

**Sidebar tokens** (light 129–136, dark 199–206): `--sidebar` `oklch(0.984…)`(129)/`oklch(0.208…)`(199);
`--sidebar-foreground` (130/200); `--sidebar-primary` `oklch(0.208…)`(131)/`oklch(0.488 0.243 264.376)`(201);
`--sidebar-primary-foreground` (132/202); `--sidebar-accent` (133/203); `--sidebar-accent-foreground`
(134/204); `--sidebar-border` `oklch(0.929…)`(135)/`oklch(1 0 0 / 10%)`(205); `--sidebar-ring` (136/206).

### Spacing / radius / base layer

- `--radius: 0.625rem` (`app/globals.css:128`) — the single source of the radius scale above.
- **Card spacing** is NOT a global token — it is a card-local `[--card-spacing:--spacing(4)]`
  set inside `card.tsx:15` (see 2b). No other custom spacing var exists in globals.css.
- `@layer base` (209–219): `* { @apply border-border outline-ring/50 }` (default border
  color + focus ring), `body { @apply bg-background text-foreground }`, `html { @apply
  font-sans }`.

### `@media print` block (lines 221–302) — how PDF export works

`window.print()` (per CLAUDE.md; `DownloadPdfButton` not in scope) is styled entirely by
this block. Every rule quoted:

- **`@page` (221–224):** `size: A4; margin: 14mm;`.
- **Force light for print (226–230):** `@media print { :root { color-scheme: light } }` —
  comment (227): "The app has no reachable dark mode; pin light for print regardless."
- **Keep backgrounds/fills (234–239):** `*, *::before, *::after { -webkit-print-color-adjust:
  exact !important; print-color-adjust: exact !important }` — otherwise browsers drop chart
  fills / chip tints / card backgrounds.
- **Hide chrome (245–251):**
  ```css
  aside, header, .no-print, [data-sonner-toaster], [data-slot="select-trigger"] {
    display: none !important;
  }
  ```
  Comment (241–244): `aside` covers BOTH the dashboard sidebar AND the report-editor
  settings panel; `header` covers the top bar. (`SortArrow` wraps itself in `.no-print`,
  `RankingCells.tsx:45`, so sort glyphs never print.)
- **Sticky → static (255–257):** `.sticky { position: static !important }` — comment
  (253–254): otherwise sticky section headers/TOC render at the bottom of their section
  and overlap ("the old export bug").
- **Collapsed reveal (259–263):** a COMMENT ONLY — reveal is done via `print:flex` /
  `print:block` utilities on the elements (the native `hidden` attribute can't be
  overridden by an author rule), not a rule in this block.
- **Report owns the page (265–274):** `main { max-width: none !important; padding: 0
  !important }` and `#report-root { max-width: none !important; width: 100% !important;
  margin: 0 !important }`.
- **Card border for print (280–283):** `[data-slot="card"] { border: 1px solid #e2e8f0
  !important; box-shadow: none !important }` — comment (276–279): the ring-based card edge
  (`ring-1 ring-foreground/10`) does NOT reliably print, so a crisp plain-hex border
  (≈ light `--border`) replaces it.
- **Pagination (287–301):** `.pdf-page-break { break-after: auto; page-break-after: auto }`
  (drops the old `page-break-after: always`); `[data-slot="card"], table, .recharts-wrapper,
  .recharts-responsive-container { break-inside: avoid }`; `h1, h2, h3 { break-after: avoid }`.

---

## 2b. UI PRIMITIVES (`components/ui/*`)

Base library: this app wraps **`@base-ui/react`** (Base UI, the shadcn "base-nova" style),
NOT Radix — except `form.tsx` which still uses `@radix-ui/react-label` + `@radix-ui/react-slot`.
Every primitive tags a `data-slot="…"` for print/CSS targeting.

### `dialog.tsx` — the modal shell reused everywhere (161 lines)

Wraps `Dialog as DialogPrimitive from "@base-ui/react/dialog"` (line 4). Exports (149–160):
`Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader,
DialogOverlay, DialogPortal, DialogTitle, DialogTrigger`.

- **`DialogOverlay` (backdrop, 26–40):** `DialogPrimitive.Backdrop`, classes:
  `"fixed inset-0 isolate z-50 bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs
  data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"`
  (line 34). Backdrop is a faint `bg-black/10` + `backdrop-blur-xs`.
- **`DialogContent` (42–81)** — the centered modal shell. `showCloseButton = true` default
  (45). Base classes (line 56):
  ```
  fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2
  -translate-y-1/2 gap-4 rounded-xl bg-popover p-4 text-sm text-popover-foreground
  ring-1 ring-foreground/10 duration-100 outline-none sm:max-w-sm
  data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95
  data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95
  ```
  So the DEFAULT max width is **`sm:max-w-sm`** (24rem), padding `p-4`, radius `rounded-xl`,
  card edge = `ring-1 ring-foreground/10`, open/close = fade + zoom-95. **The 680px detail
  panels override this** (see §2b "680px modal" below).
  When `showCloseButton` (62–77): a `DialogPrimitive.Close` rendered as
  `<Button variant="ghost" size="icon-sm" className="absolute top-2 right-2">` wrapping an
  `<XIcon />` + `<span className="sr-only">Close</span>`.
- **`DialogHeader` (83–91):** `flex flex-col gap-2`.
- **`DialogFooter` (93–118):** `-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t
  bg-muted/50 p-4 sm:flex-row sm:justify-end` (line 105); own `showCloseButton = false`
  default → optional outline "Close" button.
- **`DialogTitle` (120–131):** `font-heading text-base leading-none font-medium` (124).
- **`DialogDescription` (133–147):** `text-sm text-muted-foreground` + anchor styling (141).

### `card.tsx` — the base surface (104 lines)

Plain `<div>`s (no base library). Exports (95–103): `Card, CardHeader, CardFooter, CardTitle,
CardAction, CardDescription, CardContent`.

- **`Card` (5–21):** prop `size?: "default" | "sm"` (line 8). Classes (15):
  `"group/card flex flex-col gap-(--card-spacing) overflow-hidden rounded-xl bg-card
  py-(--card-spacing) text-sm text-card-foreground ring-1 ring-foreground/10
  [--card-spacing:--spacing(4)] … data-[size=sm]:[--card-spacing:--spacing(3)] …"`.
  So the card owns a local **`--card-spacing`** = `--spacing(4)` (default) / `--spacing(3)`
  (`size="sm"`); it applies `py-(--card-spacing)` and `gap-(--card-spacing)` — **vertical
  padding only, no horizontal padding** (that is why StatBlock adds explicit `px-*`, see
  stat-block.tsx). `overflow-hidden` + `rounded-xl` + `ring-1 ring-foreground/10`.
- **`CardHeader` (23–34):** `… grid auto-rows-min items-start gap-1 rounded-t-xl
  px-(--card-spacing) has-data-[slot=card-action]:grid-cols-[1fr_auto] …` (28) — horizontal
  padding via `px-(--card-spacing)`.
- **`CardTitle` (36–47):** `font-heading text-base leading-snug font-medium
  group-data-[size=sm]/card:text-sm` (41).
- **`CardDescription` (49–57):** `text-sm text-muted-foreground`.
- **`CardAction` (59–70):** `col-start-2 row-span-2 row-start-1 self-start justify-self-end`.
- **`CardContent` (72–80):** `px-(--card-spacing)` — horizontal padding only.
- **`CardFooter` (82–93):** `flex items-center rounded-b-xl border-t bg-muted/50
  p-(--card-spacing)`.

### `stat-block.tsx` — the shared stat callout (94 lines)

Exports (30,32,55): type `StatBlockSize`, type `StatBlockProps`, `StatBlock`. Built ON `Card`
(imported line 4). Replaces the divergent KPI cards / ABC boxes / panel header stats
(comment 6–9).

- **Props (32–39):** `label: string`, `value: React.ReactNode`, `sublabel?: React.ReactNode`,
  `accent?: "default"|"primary"|"destructive"|"warning"|"success"`, `size?: StatBlockSize`,
  `className?`.
- **Accent (22–28, applied 71–75):** `ACCENT_COLORS` maps to `var(--primary)` / `var(--destructive)`
  / `var(--warning)` / `var(--success)` (default → undefined). Rendered as an inline
  `style={{ borderLeft: '4px solid ${accentColor}' }}` (73) — a 4px left border.
- **Size → padding (`PADDING`, 41–46):**
  `compact: "gap-0.5 px-2.5 py-2"`, `default: "gap-0.5 px-3.5 py-3"`,
  `comfortable: "gap-1 px-5 py-5"`, `lg: "gap-1 px-5 py-5"` (lg is a comfortable alias).
  **Confirms CLAUDE.md's "p-3 default / p-4 lg" loosely but the ACTUAL values are
  `px-3.5 py-3` default and `px-5 py-5` lg/comfortable — FLAG: CLAUDE.md's "p-3/p-4"
  is imprecise vs the real `px-3.5 py-3` / `px-5 py-5`.**
- **Size → value type scale (`VALUE_SIZE`, 48–53):** `compact: text-xl`, `default: text-2xl`,
  `comfortable: text-3xl`, `lg: text-3xl`.
- **Body (64–91):** passes `data-size={size === "compact" ? "sm" : "default"}` to Card (66);
  label `text-muted-foreground text-xs|text-sm`; value `font-semibold leading-tight
  tracking-tight tabular-nums` + VALUE_SIZE (81–84); sublabel `text-xs text-muted-foreground`.

### `button.tsx` — cva variants (58 lines)

Wraps `Button as ButtonPrimitive from "@base-ui/react/button"` (1). Exports `Button,
buttonVariants` (58). Base cva string (6–7) includes `rounded-lg border border-transparent
… text-sm font-medium … focus-visible:ring-3 focus-visible:ring-ring/50
active:not-aria-[haspopup]:translate-y-px disabled:opacity-50 …` and icon sizing
`[&_svg:not([class*='size-'])]:size-4`.

- **Variants (10–21):**
  - `default`: `bg-primary text-primary-foreground hover:bg-primary/80`
  - `outline`: `border-border bg-background hover:bg-muted … dark:border-input dark:bg-input/30 …`
  - `secondary`: `bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] …`
  - `ghost`: `hover:bg-muted hover:text-foreground … dark:hover:bg-muted/50`
  - `destructive`: `bg-destructive/10 text-destructive hover:bg-destructive/20 …`
  - `link`: `text-primary underline-offset-4 hover:underline`
- **Sizes (22–34):** `default: h-8 gap-1.5 px-2.5 …`, `xs: h-6 … px-2 text-xs …`,
  `sm: h-7 … px-2.5 text-[0.8rem] …`, `lg: h-9 … px-2.5 …`, `icon: size-8`,
  `icon-xs: size-6 …`, `icon-sm: size-7 …`, `icon-lg: size-9`.
- **Defaults (36–39):** `variant: "default", size: "default"`.

### `badge.tsx` — cva pill (53 lines)

Wraps Base UI `useRender` + `mergeProps` (1–2); renders as `<span>` by default (37). Exports
`Badge, badgeVariants` (52). Base (8): `h-5 w-fit … rounded-4xl border … px-2 py-0.5 text-xs
font-medium …` — a fully-rounded pill (`rounded-4xl` = `1.625rem`). Variants (11–22):
`default` (`bg-primary text-primary-foreground`), `secondary`, `destructive`
(`bg-destructive/10 text-destructive`), `outline` (`border-border text-foreground`),
`ghost`, `link`. Default variant `default` (24). (Header uses `destructive`/`secondary`
by role, `Header.tsx:34`.)

### `input.tsx` (21 lines)

Wraps `Input as InputPrimitive from "@base-ui/react/input"` (2). Single `Input` export.
Classes (12): `h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1
text-base … placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3
focus-visible:ring-ring/50 disabled:opacity-50 … md:text-sm dark:bg-input/30 …`. Height `h-8`,
radius `rounded-lg`.

### `label.tsx` (21 lines)

Plain `<label>` (no base lib). Classes (12): `flex items-center gap-2 text-sm leading-none
font-medium select-none group-data-[disabled=true]:… peer-disabled:…`. `"use client"`.

### `form.tsx` — react-hook-form bridge (179 lines)

The one Radix hold-out: `@radix-ui/react-label` + `@radix-ui/react-slot` (4–5) + `react-hook-form`
(6–13). Exports (169–178): `useFormField, Form, FormItem, FormLabel, FormControl,
FormDescription, FormMessage, FormField`.
- `Form = FormProvider` (18); `FormField` wraps `Controller` in a `FormFieldContext` carrying
  `{ name }` (29–40).
- `useFormField` (42–67): throws if used outside `<FormField>` / `<FormItem>`; returns
  `id`, `name`, `formItemId`, `formDescriptionId`, `formMessageId` + `getFieldState`.
- `FormItem` (75–87): `forwardRef` div `className={cn("space-y-2", …)}`, provides `useId()`.
- `FormLabel` (89–104): reuses `Label`, adds `error && "text-destructive"`.
- `FormControl` (106–126): `Slot` wiring `aria-describedby` + `aria-invalid={!!error}`.
- `FormDescription` (128–143): `<p className="text-[0.8rem] text-muted-foreground">`.
- `FormMessage` (145–167): `<p className="text-[0.8rem] font-medium text-destructive">`,
  renders `error.message` else children, returns `null` when empty.

### `alert.tsx` — cva (77 lines)

Plain `<div role="alert">`. Exports `Alert, AlertTitle, AlertDescription, AlertAction` (76).
Base cva (6–7): `relative grid w-full gap-0.5 rounded-lg border px-2.5 py-2 text-left text-sm
… has-[>svg]:grid-cols-[auto_1fr] …`. Variants (10–14): `default` (`bg-card text-card-foreground`),
`destructive` (`bg-card text-destructive *:data-[slot=alert-description]:text-destructive/90`).
`AlertAction` (66–74): `absolute top-2 right-2`.

### `separator.tsx` (26 lines)

Wraps `Separator as SeparatorPrimitive from "@base-ui/react/separator"` (3). `orientation =
"horizontal"` default. Classes (16): `shrink-0 bg-border data-horizontal:h-px
data-horizontal:w-full data-vertical:w-px data-vertical:self-stretch`.

### `skeleton.tsx` (14 lines)

Plain div. Classes (8): `animate-pulse rounded-md bg-muted`. Single `Skeleton` export.

### `sonner.tsx` — toast host (50 lines)

Wraps `Toaster as Sonner from "sonner"` (4) — NOT shadcn `toast` (CLAUDE.md: `toast` removed
upstream, `sonner` used instead). Reads `useTheme()` from `next-themes` (3,8) → passes
`theme` to Sonner. Custom lucide icons per level (14–30): success `CircleCheckIcon`, info
`InfoIcon`, warning `TriangleAlertIcon`, error `OctagonXIcon`, loading `Loader2Icon
animate-spin`. CSS-var theming (31–38): `--normal-bg: var(--popover)`, `--normal-text:
var(--popover-foreground)`, `--normal-border: var(--border)`, `--border-radius: var(--radius)`.
`toastOptions.classNames.toast: "cn-toast"` (40–42).

### `tabs.tsx` — cva (83 lines)

Wraps `Tabs as TabsPrimitive from "@base-ui/react/tabs"` (3). Exports `Tabs, TabsList,
TabsTrigger, TabsContent, tabsListVariants` (82).
- `Tabs` (8–24): `group/tabs flex gap-2 data-horizontal:flex-col`.
- `tabsListVariants` (26–39): base `inline-flex w-fit … rounded-lg p-[3px] text-muted-foreground
  group-data-horizontal/tabs:h-8 …`; variants `default: "bg-muted"`, `line: "gap-1 bg-transparent"`.
- `TabsTrigger` (56–70): long class list — active state `data-active:bg-background
  data-active:text-foreground` (63), an `after:` underline for the `line` variant (64),
  base text `text-foreground/60` (61).
- `TabsContent` (72–79): `flex-1 text-sm outline-none`.

### `select.tsx` (202 lines)

Wraps `Select as SelectPrimitive from "@base-ui/react/select"` (4). Exports (190–201):
`Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectScrollDownButton,
SelectScrollUpButton, SelectSeparator, SelectTrigger, SelectValue`.
- `SelectTrigger` (31–57): prop `size?: "sm" | "default"` (37); classes (44) include
  `flex w-fit items-center justify-between gap-1.5 rounded-lg border border-input …
  data-[size=default]:h-8 data-[size=sm]:h-7 …`; renders a trailing `ChevronDownIcon` (50–54).
  Note the `data-slot="select-trigger"` (42) is hidden in print (globals.css:249).
- `SelectContent` (59–96): portal + positioner (`side="bottom" sideOffset=4 align="center"
  alignItemWithTrigger`); popup classes (86) `max-h-(--available-height) w-(--anchor-width)
  min-w-36 … rounded-lg bg-popover … shadow-md ring-1 ring-foreground/10 …` + slide/zoom anims.
- `SelectItem` (111–137): `rounded-md py-1 pr-8 pl-1.5 text-sm … focus:bg-accent
  focus:text-accent-foreground …` + a right-aligned `CheckIcon` indicator.
- `SelectLabel` (98–109): `px-1.5 py-1 text-xs text-muted-foreground`.
- `SelectSeparator` (139–150): `-mx-1 my-1 h-px bg-border`.
- `SelectScrollUpButton`/`SelectScrollDownButton` (152–188): chevron scroll arrows on
  `bg-popover`.

### `dropdown-menu.tsx` (269 lines)

Wraps `Menu as MenuPrimitive from "@base-ui/react/menu"` (4). Exports 15 symbols (252–268):
`DropdownMenu, DropdownMenuPortal, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuGroup,
DropdownMenuLabel, DropdownMenuItem, DropdownMenuCheckboxItem, DropdownMenuRadioGroup,
DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuSub,
DropdownMenuSubTrigger, DropdownMenuSubContent`.
- `DropdownMenuContent` (21–50): positioner `align="start" side="bottom" sideOffset=4`; popup
  (44) `max-h-(--available-height) w-(--anchor-width) min-w-32 … rounded-lg bg-popover p-1 …
  shadow-md ring-1 ring-foreground/10 …` + slide/zoom anims.
- `DropdownMenuItem` (76–97): prop `variant?: "default"|"destructive"` + `inset?`; classes
  (91) `rounded-md px-1.5 py-1 text-sm … focus:bg-accent … data-[variant=destructive]:text-destructive …`.
- `DropdownMenuLabel` (56–74): `px-1.5 py-1 text-xs font-medium text-muted-foreground`.
- `DropdownMenuCheckboxItem` (148–180) / `DropdownMenuRadioItem` (191–221): right-aligned
  `CheckIcon` indicators.
- `DropdownMenuSeparator` (223–234): `-mx-1 my-1 h-px bg-border`.
- `DropdownMenuShortcut` (236–250): `ml-auto text-xs tracking-widest text-muted-foreground`.
- `DropdownMenuSubTrigger` (103–125) adds a trailing `ChevronRightIcon`; `DropdownMenuSubContent`
  (127–146) shadow-lg variant.

### `table.tsx` (117 lines)

Plain HTML table elements. Exports (107–116): `Table, TableHeader, TableBody, TableFooter,
TableHead, TableRow, TableCell, TableCaption`.
- `Table` (7–20): wraps `<table>` in `<div data-slot="table-container" className="relative
  w-full overflow-x-auto">`; table `w-full caption-bottom text-sm`.
- `TableHeader` (22–30): `[&_tr]:border-b`. `TableBody` (32–40): `[&_tr:last-child]:border-0`.
- `TableRow` (55–66): `border-b transition-colors hover:bg-muted/50 has-aria-expanded:bg-muted/50
  data-[state=selected]:bg-muted`.
- `TableHead` (68–79): `h-10 px-2 text-left align-middle font-medium whitespace-nowrap
  text-foreground`.
- `TableCell` (81–92): `p-2 align-middle whitespace-nowrap`.
- `TableFooter` (42–53): `border-t bg-muted/50 font-medium`. `TableCaption` (94–105):
  `mt-4 text-sm text-muted-foreground`.

### `roster-table.tsx` — import-page table chrome (148 lines)

**Not a base-lib wrapper** — bespoke helpers shared by the Suppliers + Purchases roster
tables (comment 8–9). Exports (11,19,58,73,122): `ROSTER_PAGE_SIZE = 25`, `RowCheckbox`,
`usePagination`, `PaginationFooter`, `SelectionBar`.
- `ROSTER_PAGE_SIZE = 25` (11).
- `RowCheckbox` (19–50): `appearance-none` styled checkbox — `size-4 … rounded-[4px] border
  border-input bg-background … checked:border-primary checked:bg-primary …`, hidden at rest
  (`opacity-0 group-hover:opacity-100`) unless checked (39); overlays a lucide `Check`
  (`text-primary-foreground strokeWidth={3}`, 42–47).
- `usePagination<T>(items, pageSize, resetKey)` (58–70): client-side pager; resets to page 0
  when `resetKey` changes (61–64, render-time state sync — no effect), clamps `safePage`,
  returns `{ page, setPage, pageCount, start, pageItems }`.
- `PaginationFooter` (73–118): "Showing X–Y of N" + "Page P of T" + Prev/Next `Button
  variant="outline" size="sm"`.
- `SelectionBar` (122–147): "N selected" + Clear link + `Button variant="destructive"
  size="sm"` "Delete selected".

### `typeable-combobox.tsx` — filter-as-you-type combobox (208 lines)

**Bespoke** — comment (14–15): "the repo has no Command/Popover primitive." Exports (7,20):
type `ComboOption` (`{ value; label; keywords? }`) + `TypeableCombobox`.
- Props (20–50): `value`, `onChange`, `options`, `placeholder`, `creatable = false`,
  `renderOption?`, `leading?` (adornment, e.g. a flag), `emptyText = "No matches"`,
  `maxVisible?` (caps list, shows "N more"), `disabled = false`, `id`, `aria-label`.
- Filters `options` by `label`/`value`/`keywords` substring (62–69); `showCreate` adds a
  `+ Add "<query>"` row when creatable and no exact label match (72–75).
- Keyboard nav ↑/↓/Enter/Esc (99–117); closes on outside mousedown (79–86).
- Input classes (133–136): `h-9 w-full rounded-md border border-input bg-transparent px-3
  py-1 text-sm shadow-sm … focus-visible:ring-1 focus-visible:ring-ring …`; floating list
  (157–160) uses `panelElevation` + `ring-1 ring-foreground/10`. **This is the one `ui/*`
  file that imports `panelElevation`** (line 5).

---

## The 680px detail-panel modal + elevation helpers (cross-cutting)

- **`cardElevation` / `panelElevation`** live in **`lib/utils.ts:14–17`** (see 2e), NOT in a
  component. Definitions quoted there. `panelElevation` is consumed by `typeable-combobox.tsx:5,159`
  (the only assigned file that uses it) and by the 5 detail-panel/modal components below.
- **`sm:max-w-[680px]` modal width** is NOT in `dialog.tsx` (whose base is `sm:max-w-sm`).
  It is applied by the detail-panel/modal `DialogContent` overrides — 5 sites, each
  `flex max-h-[85vh] w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-[680px]`:
  - `components/UnifiedSupplierDetailModal.tsx:194` (+ `${panelElevation}`)
  - `components/CycleTime/CycleTimeSupplierDetailPanel.tsx:729` (+ `${panelElevation}`)
  - `components/SupplierClassification/SupplierClassificationDetailPanel.tsx:534` (+ `${panelElevation}`)
  - `components/SpendOverview/SpendDecompositionPanel.tsx:331` (+ `${panelElevation}`)
  - `components/ActionInsightCard.tsx:248` (without panelElevation)

  These 5 files are OUT OF SCOPE for §2 (they belong to feature sections) — cited here only
  to locate the 680px width the spec asked for. **No divergence:** matches CLAUDE.md's
  "~680px" claim.

---

## 2c. SHELL COMPONENTS

### `Header.tsx` (43 lines)

`"use client"`. Props `{ user: SessionData, periods: PeriodOption[], selection: PeriodSelection }`
(10–18). Renders `<header className="flex h-14 shrink-0 items-center justify-between border-b
bg-background px-6">` (28) — a fixed `h-14` top bar (the `header` hidden in print,
globals.css:246). Left: `<PeriodSelector …>` (30). Right (32–39): user name span, role
`<Badge variant={user.role === "ADMIN" ? "destructive" : "secondary"}>` (34), and a Logout
`Button variant="outline" size="sm"` that POSTs `/api/auth/logout` then routes to `/login`
+ `router.refresh()` (21–25,37).

### `Sidebar.tsx` — collapsible nav (148 lines)

`"use client"`. Prop `{ role: "ADMIN" | "VIEWER" }` (72).
- **Nav items (26–34):** `/spend-overview` (LayoutDashboard, "Spend Overview"),
  `/supplier-classification` (Layers), `/process-health` (Clock, "Process Health Monitoring"),
  `/action-dashboard` (Zap, "Action Priorities"), `/import` (Upload, `adminOnly: true`),
  `/reports` (FileText), `/methodology` (BookOpen). Admin-only rows filtered by
  `!item.adminOnly || role === "ADMIN"` (74).
- **Collapse state via `useSyncExternalStore` (36–84):** a module-level localStorage store,
  key `STORAGE_KEY = "dashboard_sidebar_collapsed"` (37). `readCollapsed()` returns
  `localStorage.getItem(STORAGE_KEY) === "true"` (43–49); `subscribeCollapsed` also listens
  to cross-tab `storage` events (51–61); `setCollapsed` writes + notifies listeners (63–70).
  In the component (78–82): `useSyncExternalStore(subscribeCollapsed, readCollapsed, () => false)`
  — **server snapshot = `false` (expanded)**, hydration-safe, avoids the lint-banned
  set-state-in-effect (comment 39–40).
- **Width toggle (87–95):** `<aside className={cn("sticky top-0 flex h-screen shrink-0
  flex-col self-start border-r border-sidebar-border bg-sidebar text-sidebar-foreground
  transition-[width] duration-200 ease-in-out", collapsed ? "w-16" : "w-60")}>` — confirms
  the **`w-60 ↔ w-16`** collapse. Sticky, full-height, `self-start` (comment 89–92: keeps
  the sidebar pinned without a new scroll container).
- Header row (97–119): 📊 title (hidden when collapsed) + chevron toggle button
  (`ChevronLeft`/`ChevronRight`). Nav links (121–144): active = `pathname.startsWith(item.href)`
  (`/` exact), active gets `bg-sidebar-accent text-sidebar-accent-foreground`; collapsed hides
  the label and adds `title` tooltips.

### `PeriodSelector.tsx` — the Range/Single-Year selector (155 lines)

`"use client"`. Exports type `PeriodOption = { id: string; name: string }` (19) +
`PeriodSelector` (52). Reads `PERIOD_COOKIE`, `PeriodMode`, `PeriodSelection` from
`@/lib/period-constants` (13–17).
- **Mode toggle (90–113):** two `Button size="sm"` in a bordered pill — "Single Year"
  (`variant={mode === "single" ? "default" : "ghost"}`) and "Range". The **year OPTIONS are
  data-driven** from the `periods` prop, not hardcoded — `YearSelect` maps
  `periods.map(p => ({ value: p.id, label: p.name }))` (34, 42–46). So "2024/2025/2026" come
  from the DB periods, not this file. **Divergence note vs spec:** the spec says "quote the
  Range/2024/2025/2026 options" — they are NOT literals here; the selector renders whatever
  `periods` contains.
- **Single vs range render (115–147):** single → one `YearSelect` ("Year"); range → two
  (`From`/`To`) separated by the literal text `"to"` (136).
- **Commit (72–86):** writes the selection to `document.cookie` as
  `${PERIOD_COOKIE}=…; path=/; max-age=${60*60*24*365}; samesite=lax` then `router.refresh()`.
  **Blocks an invalid range** (`from > to`, compared via `yearById` built from `Number(p.name)`)
  both on commit (74–81) and with a visible `<span className="text-xs text-destructive">From
  must be ≤ To</span>` (149–151).

### `CountryFlag.tsx` (27 lines)

Imports `* as Flags from "country-flag-icons/react/3x2"` (1). `CountryFlag({ code, size = 14 })`
(8): upper-cases the ISO alpha-2 code, looks up `Flags[upperCode]`, returns `null` for
empty/unknown (9,11). Renders the SVG at `width: size, height: size * 0.75, display:
inline-block, verticalAlign: -1px, marginLeft: 4, borderRadius: 1` (14–24). Comment (3–6):
SVG (not Unicode emoji) so flags render on Windows.

### `EmptyState.tsx` (27 lines)

`EmptyState({ message, ctaHref = "/import", ctaLabel = "Go to Import" })` (6). Default message
"No analyses have been computed for this period yet." (8). Renders a `Card` → `CardContent`
(`flex flex-col items-center justify-center gap-4 py-16 text-center`) with a lucide `Database`
icon (`h-10 w-10 text-muted-foreground`) + the message + a `<Link className={buttonVariants()}>`
CTA (16–24). Uses `buttonVariants()` directly (not `<Button>`) for a link-as-button.

### `RankingCells.tsx` — shared table cells (56 lines)

`"use client"`. Comment (5–7): shared by the Spend Overview + Supplier Classification ranking
tables. Exports `PerfBar` (12), `SortArrow` (36).
- **`PerfBar({ score })` (12–31):** null → `<span className="text-muted-foreground">—</span>`.
  Color thresholds (14–15): `score >= 75 ? var(--success) : score >= 55 ? var(--warning) :
  var(--destructive)` (comment 11: "≥75 success · 55–74 warning · <55 destructive"). Renders
  `{score.toFixed(2)}` (2dp, tabular-nums) + a 50px×4px track
  (`h-1 w-[50px]`) whose fill = `color-mix(in srgb, var(--muted-foreground) 20%, transparent)`
  behind a colored `width: ${pct}%` bar (21–28).
- **`SortArrow({ active, dir })` (36–55):** wrapped in `.no-print` (comment 43, so it doesn't
  leak into the PDF). Inactive → `ChevronsUpDown` `opacity-30`; active asc → `ArrowUp`;
  active desc → `ArrowDown` (all `h-3 w-3`).

### `ViewToggle.tsx` (27 lines)

`"use client"`. Exports type `View = "chart" | "table"` (6) + `ViewToggle({ view, setView })`
(13). A single right-aligned button (`mb-2 flex justify-end`) that flips `view`; shows a
`TableIcon` + "View as table" when in chart mode, or `BarChart3` + "View as chart" when in
table mode (18–23). Comment (10–12): shared by Spend Overview + Process Health supplier
detail cards.

---

## 2d. CHART INFRASTRUCTURE

### `ChartFrame.tsx` (39 lines)

`"use client"`. Exports `ChartFrame`. `useHydrated()` (9–15) via `useSyncExternalStore(emptySubscribe,
() => true, () => false)` — true only after client hydration. `ChartFrame({ height = 300,
children })` (21–39): renders a `div` of `{ width: "100%", height }`; only after hydration
mounts a Recharts `<ResponsiveContainer width="100%" height={height} minHeight={height}>`
(comment 17–20: avoids SSR/hydration chart-size mismatch).

### `PinnableDot.tsx` — cross-chart pin dot (68 lines)

`"use client"`. Exports `PinnableDot`. Reads the OPTIONAL pin context via `usePin()` from
`@/components/Reports/PinContext` (3,33). Props (16–23): `cx, cy, fill, payload?: {supplier_id?},
onSelect?, dimOpacity = 0.85`. A supplier is `pinned` when `payload.supplier_id ===
pinnedSupplierId` (35); click calls `pin(id)` then `onSelect?.(id)` (37–43). Renders a `<g>`
with a `cursor: pointer` when it has an id; a pinned dot draws an outer `<circle r=9
stroke="currentColor" strokeWidth=2>` ring plus the dot itself (`r={pinned ? 5.5 : 4}`,
`fillOpacity={dimOpacity}`) (44–67). Comment (7–9): off-report (no PinProvider) it renders a
plain dot with a no-op click.

### `PortalTooltip.tsx` — body-portal cursor tooltip (59 lines)

`"use client"`. Exports `usePortalTooltip<T>()` (13) + `PortalTooltip` (31). For hand-composed
SVG charts where Recharts' Tooltip is unavailable and an in-SVG `<foreignObject>` would be
clipped (comment 6–12).
- `usePortalTooltip` (13–29): state `{ x, y, data } | null`; `show(e, data)` sets from
  `clientX/clientY`; `move(e)` updates position; `hide()` clears.
- `PortalTooltip({ x, y, children })` (31–59): `createPortal` to `document.body` (50); width
  `W = 240`, `offset = 14`; **flips left when it would overflow the right edge**
  (`overflowRight = x + offset + W > window.innerWidth`, 46–48). Classes (52):
  `pointer-events-none fixed z-50 rounded-md border bg-background p-2 text-xs shadow-md`.

### `Sparkline.tsx` — KPI inline trend (56 lines)

`"use client"`. Exports `Sparkline`. Props (8–20): `data: Array<number|null|undefined>`,
`color = "currentColor"`, `width = 64`, `height = 20`, `className`. **Graceful fallback:
fewer than 3 finite points → renders nothing** (`pts.length < 3` returns null, 21–24).
Builds a min/max-normalized `M/L` path (26–33) and renders a bare `<svg preserveAspectRatio=
"none" aria-hidden>` with one `<path stroke={color} strokeWidth={1.5} opacity={0.7}>` — no
axes/labels/interactivity (comment 3–6).

### `useAnimatedDomain.ts` (98 lines)

Exports type `Domain = [number, number]` (5), `useAnimatedDomain` (31), `paddedDomain` (85).
- `useAnimatedDomain(target, durationMs = 420)` (31–77): tweens a scatter's x/y axis domains
  toward `target` via `requestAnimationFrame`, easing `easeInOutCubic` (`ease`, 9). Returns the
  current interpolated `{x, y}` to feed Recharts `XAxis/YAxis domain`. Comment (22–30): Recharts
  can't animate a domain change itself. **Hidden-tab safety net (66–69):** rAF pauses in
  background tabs, so a `setTimeout(…, durationMs + 80)` guarantees the settled target. Expects
  the component to REMOUNT on dataset change (keyed by period).
- `paddedDomain(values, fullRange, opts)` (85–98): a padded `[min,max]` window; `frac = 0.15`
  default, single-point fallback `singleFrac = 0.06 × fullRange` (comment 79–83), optional
  `clamp` to bounds (e.g. `[0,100]`).

---

## 2e. FORMAT / UTIL LIBS

### `lib/utils.ts` (37 lines)

- **`cn(...inputs)` (4–6):** `twMerge(clsx(inputs))` — the class-merge helper used everywhere.
- **`cardElevation` (14–15):** `"shadow-[0_1px_2px_rgba(0,0,0,0.05),0_4px_12px_rgba(0,0,0,0.04)]"`.
- **`panelElevation` (16–17):** `"shadow-[0_4px_12px_rgba(0,0,0,0.08),0_16px_32px_rgba(0,0,0,0.08)]"`.
  Comment (8–13): applied SELECTIVELY to in-scope cards (not the Card primitive) so untouched
  pages stay flat; faint in dark mode by design.
- **`trimDecimal(x)` (19–22):** private — `x.toFixed(1)` with trailing `.0` stripped.
- **`formatCompactCurrency(value)` (29–36):** quoted in full —
  ```ts
  if (!Number.isFinite(value)) return "$0";
  const sign = value < 0 ? "-" : "";
  const n = Math.abs(value);
  if (n >= 1_000_000) return `${sign}$${trimDecimal(n / 1_000_000)}M`;
  if (n >= 1_000)     return `${sign}$${trimDecimal(n / 1_000)}K`;
  return `${sign}$${Math.round(n)}`;
  ```
  → `"$25.6M"` / `"$1.2K"` / `"$487"` / `"$0"` (comment 24–28). 1dp for M/K (trailing `.0`
  trimmed), whole dollars below 1000, negative sign preserved.

### `lib/chart-colors.ts` (55 lines)

All arrays are **`var(--x)` strings**, resolved by Recharts at render (comment 1–3: "Recharts
accepts `var(--x)` as fill/stroke"). So charts adapt to light/dark via the tokens in globals.css.
- **`CHART_COLORS` (4–13):** `["var(--chart-1)" … "var(--chart-8)"]` (8 general-series colors).
- **`CATEGORY_COLORS` (18–27):** `["var(--category-1)" … "var(--category-8)"]` — comment
  (15–17): distinct from ABC/quadrant so category slices never read as an ABC class.
- **`ABC_COLORS` (29–33):** `{ A: "var(--abc-a)", B: "var(--abc-b)", C: "var(--abc-c)" }`.
- **`QUADRANT_COLORS` (40–45):** keyed by `KraljicQuadrant` (imported type, 38) →
  `Strategic: var(--quadrant-strategic)` (red), `Leverage: …-leverage` (green),
  `Bottleneck: …-bottleneck` (amber), `Routine: …-routine` (blue).
- **`ZONE_COLORS` (49–54):** keyed by `PerformanceZone` → `Stars: var(--zone-stars)`,
  `"Critical Issues": var(--zone-critical)`, `"Hidden Gems": var(--zone-hidden-gems)`,
  `"Long Tail": var(--zone-long-tail)`.

### `lib/panel-format.ts` (15 lines)

Exports `periodSpanLabel(startDate, endDate)` (4) → `{ short, full }`. `short` = the year
(`sy`) when start/end years match, else `"${sy} – ${ey}"` (uses an en-dash); `full` =
`"${startDate} to ${endDate}"` (7–13). Comment (1): shared by both detail panels.

### `lib/use-table-sort.ts` (46 lines)

Exports type `SortDir = "asc" | "desc"` (3) + `useTableSort<T, K>(rows, get, initialKey,
initialDir = "desc")` (11). Mirrors the Spend Overview / Supplier Classification sort behaviour
(comment 5–10). Sort logic (22–36), **null-sort-last quoted**:
```ts
const aNull = av == null;
const bNull = bv == null;
if (aNull || bNull) return aNull === bNull ? 0 : aNull ? 1 : -1;   // nulls always last
const c = typeof av === "number" && typeof bv === "number"
    ? av - bv
    : String(av).localeCompare(String(bv));
return sort.dir === "asc" ? c : -c;
```
So null/undefined always sort LAST regardless of direction (comment 25); both-numeric compares
numerically, else lexical. `toggle(key, defaultDir = "desc")` (38–44) flips direction on the
active key or switches to a new key at `defaultDir`. Returns `{ sorted, sort, toggle }`.

> **`SortHead` is NOT a shared primitive.** The spec pairs "useTableSort + SortHead/SortArrow".
> `SortArrow` is the shared cell in `RankingCells.tsx:36` (documented in 2c). `SortHead` is
> **locally re-defined in FOUR non-foundation files** (grep): `components/ActionDashboardView.tsx:855`,
> `components/CycleTime/StageDecompositionTable.tsx:24`, `components/CycleTime/CycleSupplierSection.tsx:141`,
> `components/CycleTimeView.tsx:46`. It is duplicated, not extracted into `ui/` or `lib/` — flag
> as a DRY divergence (each feature re-implements its own `SortHead` wrapper around the shared
> `SortArrow`/`useTableSort`). [INFERRED from grep; the 4 files are out of §2 scope so their
> bodies are not quoted here.]

---

## DIVERGENCES & NOTES (consolidated)

1. **StatBlock padding (CLAUDE.md vs code):** CLAUDE.md says "p-3 default / p-4 lg". The actual
   `PADDING` map is `default: "px-3.5 py-3"`, `lg/comfortable: "px-5 py-5"`, `compact: "px-2.5
   py-2"` (`stat-block.tsx:41–46`). The spirit matches; the literal class names differ.
2. **DialogContent default width vs the 680px panels:** base `dialog.tsx` is `sm:max-w-sm`
   (`dialog.tsx:56`); the detail modals override to `sm:max-w-[680px]` at 5 external sites
   (listed above). No contradiction — the panels intentionally widen the shared shell.
3. **PeriodSelector year options are data-driven,** not the literals "2024/2025/2026" — they
   come from the `periods` prop (`PeriodSelector.tsx:34,42–46`). The mode labels "Single Year" /
   "Range" and the join word "to" ARE literals (92,110,136).
4. **Base library = Base UI (`@base-ui/react`), not Radix,** for all `ui/*` EXCEPT `form.tsx`
   (`@radix-ui/react-label` + `@radix-ui/react-slot`, `form.tsx:4–5`) and `sonner.tsx`
   (`next-themes` + `sonner`). Flagged because CLAUDE.md calls the stack "shadcn/ui" generically.
5. **`.dark` is defined but "no reachable dark mode"** per the print comment (`globals.css:227`);
   `sonner.tsx` still reads `useTheme()`. So dark tokens exist and are wired, but no in-scope UI
   toggles `.dark`. [INFERRED — no `.dark`-toggling code is in the 36 assigned files.]
6. **`SortHead` duplicated across 4 feature files** (not a foundation primitive) — see the
   use-table-sort note above.

---

## A3 EXPORTS COMPLETENESS INDEX (auto-generated — every `export` in this doc's files, cited)

Guarantees one-to-one A3 coverage: each symbol below is defined at the cited line in a file this doc documents.

| Symbol | Kind | file:line |
|---|---|---|
| `ChartFrame` | fn | `ChartFrame.tsx:21` |
| `CountryFlag` | fn | `CountryFlag.tsx:8` |
| `EmptyState` | fn | `EmptyState.tsx:6` |
| `Header` | fn | `Header.tsx:10` |
| `PeriodOption` | type | `PeriodSelector.tsx:19` |
| `PeriodSelector` | fn | `PeriodSelector.tsx:52` |
| `PillTabs` | fn | `PillTabs.tsx:14` |
| `PinnableDot` | fn | `PinnableDot.tsx:25` |
| `usePortalTooltip` | fn | `PortalTooltip.tsx:13` |
| `PortalTooltip` | fn | `PortalTooltip.tsx:31` |
| `PerfBar` | fn | `RankingCells.tsx:12` |
| `SortArrow` | fn | `RankingCells.tsx:36` |
| `Sidebar` | fn | `Sidebar.tsx:72` |
| `Sparkline` | fn | `Sparkline.tsx:8` |
| `View` | type | `ViewToggle.tsx:6` |
| `ViewToggle` | fn | `ViewToggle.tsx:13` |
| `Alert` | re-export | `alert.tsx:76` |
| `AlertTitle` | re-export | `alert.tsx:76` |
| `AlertDescription` | re-export | `alert.tsx:76` |
| `AlertAction` | re-export | `alert.tsx:76` |
| `Badge` | re-export | `badge.tsx:52` |
| `badgeVariants` | re-export | `badge.tsx:52` |
| `Button` | re-export | `button.tsx:58` |
| `buttonVariants` | re-export | `button.tsx:58` |
| `CHART_COLORS` | const | `chart-colors.ts:4` |
| `CATEGORY_COLORS` | const | `chart-colors.ts:18` |
| `ABC_COLORS` | const | `chart-colors.ts:29` |
| `QUADRANT_COLORS` | const | `chart-colors.ts:40` |
| `ZONE_COLORS` | const | `chart-colors.ts:49` |
| `Input` | re-export | `input.tsx:20` |
| `Label` | re-export | `label.tsx:20` |
| `periodSpanLabel` | fn | `panel-format.ts:4` |
| `ROSTER_PAGE_SIZE` | const | `roster-table.tsx:11` |
| `RowCheckbox` | fn | `roster-table.tsx:19` |
| `usePagination` | fn | `roster-table.tsx:58` |
| `PaginationFooter` | fn | `roster-table.tsx:73` |
| `SelectionBar` | fn | `roster-table.tsx:122` |
| `Separator` | re-export | `separator.tsx:25` |
| `Skeleton` | re-export | `skeleton.tsx:13` |
| `Toaster` | re-export | `sonner.tsx:49` |
| `StatBlockSize` | type | `stat-block.tsx:30` |
| `StatBlockProps` | type | `stat-block.tsx:32` |
| `StatBlock` | fn | `stat-block.tsx:55` |
| `Tabs` | re-export | `tabs.tsx:82` |
| `TabsList` | re-export | `tabs.tsx:82` |
| `TabsTrigger` | re-export | `tabs.tsx:82` |
| `TabsContent` | re-export | `tabs.tsx:82` |
| `tabsListVariants` | re-export | `tabs.tsx:82` |
| `ComboOption` | type | `typeable-combobox.tsx:7` |
| `TypeableCombobox` | fn | `typeable-combobox.tsx:20` |
| `SortDir` | type | `use-table-sort.ts:3` |
| `useTableSort` | fn | `use-table-sort.ts:11` |
| `Domain` | type | `useAnimatedDomain.ts:5` |
| `useAnimatedDomain` | fn | `useAnimatedDomain.ts:31` |
| `paddedDomain` | fn | `useAnimatedDomain.ts:85` |
| `cn` | fn | `utils.ts:4` |
| `cardElevation` | const | `utils.ts:14` |
| `panelElevation` | const | `utils.ts:16` |
| `formatCompactCurrency` | fn | `utils.ts:29` |

**Total distinct exports across this doc's files: 59.**
