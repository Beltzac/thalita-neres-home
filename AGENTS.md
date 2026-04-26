# PROJECT KNOWLEDGE BASE

**Generated:** 2026-04-26
**Commit:** f7518d3
**Branch:** main

## OVERVIEW
Vite-based multi-page interactive menu system for Wix-hosted sites. Builds self-contained HTML pages with canvas-based hit detection, custom cursors, and confetti effects. Each page is a standalone bundle deployed inside a Wix iframe.

## STRUCTURE

```
├── src/pages/          # Per-page HTML entry points (home, sobre-mim, pastas, etc.)
├── src/shared/         # Core menu engines
│   ├── scene/          # Canvas hit-detection menu (menuScene.js)
│   ├── desktop/        # Grid icon menu (menuDesktop.js)
│   ├── styles/         # Global CSS (loader, confetti, custom font)
│   └── utils/          # Confetti utility
├── src/data/           # Per-page JSON configs (overlay images, precomputed centers)
├── scripts/            # Build orchestration scripts
├── public/             # Static assets (cursors, fonts, images)
└── dist/               # Build output (one dir per page)
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Add a new page | `src/pages/<name>/index.html` + `src/data/<name>.json` | Copy existing page pattern; register in `vite.config.js` and `scripts/build-singlefile.js` |
| Change menu behavior | `src/shared/scene/menuScene.js` | 950-line canvas hit-detection engine; handles cursors, tooltips, arrows, confetti |
| Change desktop grid | `src/shared/desktop/menuDesktop.js` | Flex-grid icon menu with hover states |
| Change global styles | `src/shared/styles/global.css` | Loader animation, confetti keyframes, Thata font |
| Build system | `vite.config.js`, `scripts/build-singlefile.js` | Multi-page Vite config with per-page `SINGLE_INPUT` mode |
| Image optimization | `scripts/optimize-images.js` | Sharp-based lossless optimization of dist images |
| Precompute centers | `scripts/precompute-centers.js` | Computes transparent-pixel centers for hit detection; writes to JSON configs |
| Wix bridge | `wixPage.js` | Host-side navigation handler for `postMessage` from menu pages |

## CODE MAP

| Symbol | Type | Location | Role |
|--------|------|----------|------|
| `initMenuScene` | function | `src/shared/scene/menuScene.js` | Scene menu engine (canvas hit detection, arrows, labels) |
| `initMenuDesktop` | function | `src/shared/desktop/menuDesktop.js` | Desktop grid menu engine |
| `confettiExplosion` | function | `src/shared/utils/confetti.js` | Particle burst effect on click |
| `pageInputs` | object | `vite.config.js` | Vite Rollup input map for all pages |

## CONVENTIONS

- **ES modules everywhere**: `"type": "module"` in package.json; all JS uses `import`/`export`
- **Per-page data config**: Each page imports its own JSON from `src/data/*.json`
- **JSON module imports in browser**: `import config from '/src/data/home.json'` relies on Vite's JSON module support
- **Wix asset URLs preserved**: Images reference Wix/static URLs; no local asset copying during build
- **PostMessage navigation**: Menus communicate with Wix host via `window.parent.postMessage(urlLink, "*")`

## ANTI-PATTERNS (THIS PROJECT)

- **Do not manually edit `precomputedCentersByUrl`** in JSON configs — always regenerate via `npm run precompute:centers`
- **Do not add TypeScript** — project is plain JS/ESM; no TS toolchain present
- **Do not add server-side code** — client-side only; runs inside Wix iframe
- **Do not run `vite build` directly for production** — use `npm run build` which orchestrates precompute + singlefile + optimize

## UNIQUE STYLES

- **SINGLE_INPUT per-page builds**: `scripts/build-singlefile.js` loops pages, invoking `vite build` with `SINGLE_INPUT` env var to emit isolated single-file bundles via `vite-plugin-singlefile`
- **Precomputed image centers**: Build-time sharp analysis computes transparent-pixel mass centers for overlay hit detection; stored in JSON configs
- **Dual URL keying**: `precomputedCentersByUrl` stores both `/path` and `path` variants to handle absolute vs relative src resolution at runtime
- **WebKitCSSMatrix for transforms**: Runtime reads CSS transform matrices via `new WebKitCSSMatrix()` to map mouse coordinates to image-local space

## COMMANDS

```bash
npm run dev                  # Vite dev server
npm run precompute:centers  # Regenerate image center data in JSON configs
npm run build               # Full build: precompute → singlefile per-page → image optimize
npm run preview             # Serve dist/ for local testing
```

## NOTES

- `menuScene.js` is the largest file (~950 lines). It handles: image loading, coordinate transformation, closest-overlay detection, cursor switching, tooltip/label positioning (tooltip/side/horizontal modes), SVG arrow drawing with instruction-text avoidance, and confetti trigger on click.
- No test framework or lint config present.
- `public/` assets are referenced by URL in configs and CSS, not imported/bundled.
- Build outputs to `dist/<page>/index.html` with inlined JS/CSS when `SINGLE_INPUT` is set.
