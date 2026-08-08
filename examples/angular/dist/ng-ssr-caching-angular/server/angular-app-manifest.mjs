
export default {
  bootstrap: () => import('./main.server.mjs').then(m => m.default),
  inlineCriticalCss: true,
  baseHref: '/',
  locale: undefined,
  routes: [
  {
    "renderMode": 0,
    "route": "/"
  }
],
  entryPointToBrowserMapping: undefined,
  assets: {
    'index.csr.html': {size: 8377, hash: '227dcb85159d1632b72cd6f82c7143ed94b22362b25f91b1929dcb18a28f45cd', text: () => import('./assets-chunks/index_csr_html.mjs').then(m => m.default)},
    'index.server.html': {size: 1305, hash: '28c38704b55616931d5ff5f58ba6279c8b1b01c4a8f3c199088e2688a57f32aa', text: () => import('./assets-chunks/index_server_html.mjs').then(m => m.default)},
    'styles-WKQHB4IG.css': {size: 18482, hash: 'WyAEC0RT/IQ', text: () => import('./assets-chunks/styles-WKQHB4IG_css.mjs').then(m => m.default)}
  },
};
