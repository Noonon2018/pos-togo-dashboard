# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Working agreements

- Reply to the user in Thai.
- Type-check Money Flow with `npx tsc --noEmit` (run inside `money-flow/`). It has no ESLint, so don't run or add a lint step for it.

## Two unrelated apps in one repo

| | Root (`/`) | `money-flow/` |
|---|---|---|
| What | POS TOGO order pad / board dashboard | Money Flow Analyzer: traces money between parties from bank statements |
| Stack | React 19 + Vite 7, plain JSX | React 19 + Vite 8, TypeScript, Cytoscape, pdf.js, tesseract.js |
| Package | own `package.json` / lockfile | own `package.json` / lockfile (run npm inside `money-flow/`) |
| State | `localStorage` only, no backend | in memory + `localStorage` for settings only |

They share nothing. Recent development is almost all in `money-flow/`. Both UIs are bilingual Thai/English and default to Thai.

## Commands

Root POS dashboard:
```sh
npm install
npm run dev        # Vite dev server
npm run lint       # ESLint (root config only covers *.js/*.jsx)
npm run build
npm run deploy     # gh-pages; vite.config.js `base` still has a placeholder repo name
```

Money Flow (always `cd money-flow` first):
```sh
npm ci
npm run dev                      # http://127.0.0.1:5173
npm test                         # vitest run (node environment)
npx vitest run src/lib/csv.test.ts          # one test file
npx vitest run -t "reconciles"              # tests whose name matches
npx tsc --noEmit                 # type check: the only static check (no ESLint)
npm run build                    # tsc --noEmit && vite build
npm run app                      # build + preview: the locked-down production mode
```

## Money Flow architecture

**Privacy is a hard requirement.** Statements must never leave the browser. `vite.config.ts` injects a strict CSP into the built `index.html` (`connect-src 'self'`, no external scripts) and sets hardened headers on `preview`; servers bind to `127.0.0.1` only. OCR models and workers are served from local `node_modules` (the `ocrAssets` plugin) instead of a CDN. Don't add network calls, CDNs, analytics or remote fonts. Real statements belong in `money-flow/data/` (git-ignored); `samples/` and `src/lib/fixtures/` are fictional.

**End users launch it via `.bat` files** (`Money Flow.bat`, `Create Desktop Shortcut.bat`, `Update Money Flow.bat`), which run `npm run app` on port 5173. The launcher deliberately never pulls new code.

**Data pipeline** (all orchestrated in `src/App.tsx`):
1. `addFiles` sorts dropped files by type: CSV/TSV/TXT, PDF (`lib/pdfText` → `lib/pdfStatement` or `lib/doordash`, falling back to OCR via `lib/pdfOcr` when a PDF has almost no text), Office files and images (`lib/officeFiles`, OCR). Heavy readers are `import()`ed lazily.
2. Each file is classified: bank statement, address book (`lib/addressBook`), cash-forecast simulation input (`lib/forecast`), or unusable (`lib/fileCheck` explains why). Every dropped file gets a `FileCheck` shown in `FileCheckCard`.
3. Statements queue up as `PendingFile`s. `ImportDialog` maps columns (`lib/csv`: `guessMapping`/`applyMapping`), shows reconciliation for PDFs, and can save a `BankProfile` keyed by header signature.
4. `finishImport` produces `Transaction[]`. Rows with a `link` (`from → to`, e.g. Venmo or crypto exports) are flows between other parties: they go to `links` and appear only in the graph, never in the summary. Transactions are deduplicated by `id`.
5. Derived views come from pure functions in `src/lib/`, all memoized in `App`: `aggregate.buildGraph`, `categories.categorize`, `roles.computeRoles` + `patterns.patternRoles` (red-flag behaviours), `trace` (follow-the-money), and `summary`/`budget`/`forecast`.

`src/lib/` holds all the logic and the tests (`*.test.ts` sit next to their modules). Components hold UI only. Put new logic in `lib/` with a test.

**Persistence:** `lib/storage.ts` keeps settings in `localStorage` under versioned keys (`moneyflow.*.v1`): bank profiles, aliases (renames/merges), category overrides, budgets, goal, cycle, address book, currency. Transactions themselves are never persisted; they are gone when the tab closes, by design.

**Names:** `aliases` map raw counterparty strings to display names. `lib/rename.ts` does rename, merge and unmerge, and `lib/mergeCheck.ts` warns before merges that are risky (different categories, or into one of your own accounts). Name changes go through `changeNames` in `App` so they can be undone.

**Currency:** `format.ts` keeps a module-level currency that `App` sets during render (`setCurrency(cur.cur)`). Thai text in an imported file switches it to THB unless the user picked a currency.

## i18n

- `src/i18n.tsx` has `en` and `th` dictionaries. `th` is typed `Record<keyof typeof en, string>`, so every new key must be added to both. `useT()` translates with `{var}` placeholders; `LangProvider` keeps `<html lang>` in sync with the toggle.
- Some components keep their own local `TEXT`/`TH`/`EN` dictionaries instead (`HelpDialog`, `FileCheckCard`, `ForecastView`). Edit text there, not in `i18n.tsx`.
- Thai is the default language and must stay first-class.

## UI conventions (Money Flow)

- One global stylesheet, `src/styles.css`, with a few CSS variables on `:root` (`--in`, `--out`, `--acct`, …); no CSS framework. Cytoscape node and edge colours are set in JS in `components/GraphView.tsx`.
- Modals use `components/Modal.tsx` (native `<dialog>` + `showModal()`). Pass `onDismiss` only when Escape and backdrop clicks may close it; `ImportDialog` deliberately omits it.
- Anything clickable is a `<button>`. Use `className="textbtn"` for a button that should look like plain text or a whole row.
