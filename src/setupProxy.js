const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function(app) {
  // /api → Express server (port 5000)
  // pathFilter preserves the full path — no stripping, no rewriting needed
  app.use(
    createProxyMiddleware({
      pathFilter: '/api',
      target: 'http://localhost:5000',
      changeOrigin: true,
    })
  );

  // /v4 → football-data.org API
  app.use(
    '/v4',
    createProxyMiddleware({
      target: 'https://api.football-data.org',
      changeOrigin: true,
      secure: true,
      pathRewrite: (path) => `/v4${path}`,
    })
  );
};
