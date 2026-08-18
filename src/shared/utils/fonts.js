// Registers the Thata display font so it can render in any page.
//
// vite-plugin-singlefile re-bases CSS url() relative to each page's deep
// output path (e.g. src/pages/fwdlinks/index.html), so the @font-face in the
// shared stylesheet resolves to a 404 on deployed pages. Loading the font
// here with its absolute public path avoids that rewrite entirely.
export function loadThataFont() {
  const font = new FontFace('Thata', "url('/assets/fonts/Thata.ttf') format('truetype')");
  font.load().then(
    (loaded) => document.fonts.add(loaded),
    () => {}
  );
}
