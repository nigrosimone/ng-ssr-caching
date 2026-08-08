
export default {
  basePath: '/',
  allowedHosts: [
  "localhost",
  ".stackblitz.io",
  ".webcontainer.io"
],
  supportedLocales: {
  "en-US": ""
},
  entryPoints: {
    '': () => import('./main.server.mjs')
  },
};
