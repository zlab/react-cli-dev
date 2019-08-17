const TerserPlugin = require('terser-webpack-plugin');
const terserOptions = require('./terserOptions');

module.exports = (api, options) => {
  api.chainWebpack(webpackConfig => {
    if (process.env.NODE_ENV === 'production') {
      webpackConfig
        .mode('production')
        .devtool(options.productionSourceMap ? 'source-map' : false);

      // keep module.id stable when vendor modules does not change
      webpackConfig
        .plugin('hash-module-ids')
        .use(require('webpack/lib/HashedModuleIdsPlugin'), [{
          hashDigest: 'hex',
        }]);

      webpackConfig.optimization
        .minimizer('terser')
        .use(TerserPlugin, [terserOptions(options)]);
    }
  });
};
