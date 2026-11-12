const server = Bun.serve({
  hostname: '127.0.0.1', port: Number(process.env.PORT ?? 4173),
  async fetch(request) {
    const url = new URL(request.url)
    if (url.pathname === '/host.js') return new Response(Bun.file('dist/test/host.js'))
    if (url.pathname === '/production.js') return new Response(Bun.file('dist/production/host.js'))
    if (url.pathname !== '/' && url.pathname !== '/production') return new Response('Not found', { status: 404 })
    return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><title>Foldkit catalogue test fixture</title><style>
      body{font:16px system-ui;max-width:860px;margin:32px auto;padding:0 16px;color:#1d2635;background:#f5f7fb}
      button,input{font:inherit;padding:8px 12px;margin:4px;border:1px solid #b4bdcc;border-radius:6px;background:white;color:inherit}
      button:disabled{opacity:.4}nav{margin:12px 0}li{padding:8px}pre{white-space:pre-wrap;font-size:12px}
      dialog{border:1px solid #b4bdcc;border-radius:12px;padding:24px;max-width:420px}aside{border-top:1px solid #ccd3df;margin-top:24px}
      @media(prefers-color-scheme:dark){body{background:#161d2a;color:#e8edf5}button,input,dialog{background:#273246;color:#e8edf5}}
      </style><div id="app"></div><script type="module" src="${url.pathname === '/production' ? '/production.js' : '/host.js'}"></script></html>`, { headers: { 'content-type': 'text/html', 'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:" } })
  },
})
console.log(`Loopback fixture: ${server.url}`)
