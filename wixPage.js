// Host-side navigation bridge. Mirror of the site's src/pages/masterPage.js in
// the thalitaneres.com.br repo; keep both in sync.
//
// API Reference: https://www.wix.com/velo/reference/api-overview/introduction
import wixLocation from 'wix-location';

// The embedded menu frame posts the URL to open. Only same-site paths and these
// origins are honoured, so a compromised or third-party frame cannot use this
// handler as an open redirect. The external entries are the absolute urlLink
// values that actually exist in src/data/*.json of this app.
const ORIGENS_EXTERNAS_PERMITIDAS = [
  'https://www.thalitaneres.com.br/',
  'https://www.tiktok.com/',
  'https://substack.com/',
  'https://www.amazon.com.br/'
];

function destinoPermitido(valor) {
  if (typeof valor !== 'string') {
    return null;
  }

  const destino = valor.trim();

  if (destino.length === 0) {
    return null;
  }

  // Same-site relative path such as "/fotografia". "//host" is protocol-relative
  // and therefore external, so it must not be treated as a path.
  if (destino.startsWith('/') && !destino.startsWith('//')) {
    return destino;
  }

  for (const origem of ORIGENS_EXTERNAS_PERMITIDAS) {
    if (destino.startsWith(origem)) {
      return destino;
    }
  }

  return null;
}

function aoReceberMensagem(event) {
  const destino = destinoPermitido(event.data);

  if (!destino) {
    console.warn('Navegacao ignorada: destino nao permitido.');
    return;
  }

  wixLocation.to(destino);
}

$w.onReady(function () {
  $w('#html1')?.onMessage(aoReceberMensagem);
});