# Vite Multi-Page Interactive Menu Build System

This project uses Vite to build multiple self-contained interactive menu pages from shared code. Each page outputs its own HTML file with bundled JavaScript and CSS.

## Project Structure

```
src/
├── pages/
│   ├── home/                 # Scene-based menu (main room)
│   │   └── index.html
│   ├── sobre-mim/            # Scene-based single overlay
│   │   └── index.html
│   ├── maquina-escrever/     # Scene-based with arrow tooltips
│   │   └── index.html
│   ├── filme-fotografico/    # Scene-based multiple overlays
│   │   └── index.html
│   └── pastas/               # Desktop-style grid menu
│       └── index.html
├── shared/
│   ├── scene/
│   │   └── menuScene.js      # Shared scene menu logic
│   ├── desktop/
│   │   └── menuDesktop.js    # Shared desktop menu logic
│   ├── styles/
│   │   └── global.css        # Shared styles (loader, confetti, font)
│   └── utils/
│       └── confetti.js       # Confetti utility (also inlined in modules)
└── data/
    ├── home.json             # Configuration for home page
    ├── sobre-mim.json        # Configuration for sobre-mim page
    ├── maquina-escrever.json # Configuration for maquina-escrever page
    ├── filme-fotografico.json# Configuration for filme-fotografico page
    └── pastas.json           # Configuration for pastas page
```

## Configuration Files

Each page has a JSON config that defines:

- **Scene pages** (`home.json`, `sobre-mim.json`, `maquina-escrever.json`, `filme-fotografico.json`):
  - `baseUrl`, `baseImageFilename`
  - `overlayImages[]` with `nomeImagem`, `arquivo`, `urlLink`, optional `description`, `arrowStartOffset`
  - `margin`, `ACTIVE_RADIUS`, `precomputedCentersByUrl`
  - `instructionText`, `showArrow`

- **Desktop page** (`pastas.json`):
  - `CURSOR_NORMAL`, `CURSOR_HOVER`
  - `desktopItems[]` with `id`, `label`, `baseImage`, `activeImage`, `urlLink`

## Build & Output

```bash
npm install
npm run build
```

Vite builds all pages into `/dist` with Rollup multi-page input:

- `dist/home/index.html`
- `dist/sobre-mim/index.html`
- `dist/maquina-escrever/index.html`
- `dist/filme-fotografico/index.html`
- `dist/pastas/index.html`

Each HTML is self-contained (JS/CSS inlined or bundled). Assets remain on Wix (URLs kept as-is).

## Development

For local testing, you can serve the `dist` folder:

```bash
npm run preview
```

Or open individual HTML files directly in a browser (note: `window.parent.postMessage` requires a Wix parent to handle navigation).

## Notes

- The `menuScene` module handles canvas-based hit detection, cursor switching, tooltips, optional arrows, and confetti.
- The `menuDesktop` module handles a flex grid of icons with hover states and confetti.
- Shared CSS includes loader animation, confetti keyframes, and the custom font.
- No local asset copying; Wix static URLs are preserved in configs.
