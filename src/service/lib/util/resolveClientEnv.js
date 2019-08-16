const prefixRE = /^APP_/;

module.exports = function resolveClientEnv(options) {
  const env = {};
  Object.keys(process.env).forEach(key => {
    if (prefixRE.test(key) || key === 'NODE_ENV') {
      env[key] = process.env[key];
    }
  });

  env.BASE_URL = options.publicPath;

  return env;
};
