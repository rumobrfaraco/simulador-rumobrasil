# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev       # Start development server (HMR at http://localhost:5173)
npm run build     # Production build → /dist
npm run preview   # Preview production build locally
npm run lint      # Run ESLint (flat config v9+)
```

No test framework is configured yet. If tests are added, Vitest integrates natively with Vite.

## Architecture

**Stack:** React 19 + Vite 8, plain CSS (no CSS-in-JS framework), no external UI libraries

**Entry flow:** `index.html` → `src/main.jsx` → `src/Tributometro_v15.jsx` (the entire app lives in this single file; `App.jsx` does not exist)

**Purpose:** Tax reform simulator for Brazilian freight/transport companies modeling CBS+IBS impact (2027–2033) under Lei 214/2025. Two views: `<Painel/>` (info dashboard) and `<Oracle/>` (interactive calculator).

**Styling approach:** CSS custom properties in `src/index.css` for theming (light/dark via `prefers-color-scheme`). Component-level styles in `App.css`. Inline styles are used heavily inside `Tributometro_v15.jsx` (via constant objects `C` for colors and `F` for fonts).

**ESLint config** (`eslint.config.js`): Flat config format; `no-unused-vars` allows uppercase or `_`-prefixed names (React component pattern).

**Assets:** Static assets in `/public/`; imported assets (images, SVGs) in `src/assets/`.

## Domain Knowledge

**Tax calculation core (`calcReforma`):** Returns CBS/IBS debits and credits for a given year. Credits flow from three sources:
- **Frota própria** — supply inputs (diesel, tires, maintenance, etc.) × their CBS credit rate (9.3% for LP/LR, 2.497% for SN)
- **Terceiros** — subcontracted freight × weighted CBS credit based on supplier regime mix (autônomo 1.86%, SN 2.497%, LP/LR 9.3%)
- **Agregados** — aggregate drivers' freight × single regime credit rate

**Key rates (MILES array):** CBS activates at 9.3% in 2027; IBS phases in from 2029 (11.22%) to 2033 (18.7%). Full IVA = 28% nominal.

**State management:** React Context (`Ctx`) + `useState`. All simulation inputs (frete, frota, regime, pctExportacao, insumos mix, terceiros/agregados %) are stored in context and read by `calcReforma`.

**Atom components:** `SL` (section label), `Bdg` (badge), `Sel` (selector button), `Stat` (KPI card), `NInput` (numeric input), `InsumoCheck` (checkbox+input). These are defined at the top of `Tributometro_v15.jsx` and used throughout — do not duplicate them.

**Custom hooks (top of Tributometro_v15.jsx):**
- `useClock()` — real-time HH:MM:SS
- `useCountdown(target)` — countdown to 2027-01-01 (CBS launch)
- `useAlerts()` — rotates 5 alert messages every 5 s
- `useIsMob()` — breakpoint at 720 px
