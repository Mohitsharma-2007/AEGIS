// Browser shim for libraries that probe for a Node-like global object.
// Served as a static file (not inline) so the Content-Security-Policy
// `script-src 'self'` rule does not block it.
window.global = window;
window.process = {
  env: { NODE_ENV: 'production' },
  platform: /win/i.test(navigator.userAgent || '') ? 'win32' : 'darwin',
  version: 'v20.18.0',
  versions: { node: '20.18.0' },
  title: 'browser',
  browser: true,
  cwd: function () {
    return '/';
  },
  argv: [],
  nextTick: function (cb) {
    var args = Array.prototype.slice.call(arguments, 1);
    setTimeout(function () {
      cb.apply(null, args);
    }, 0);
  },
};