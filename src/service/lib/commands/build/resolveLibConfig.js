const fs = require('fs');
const { log, error } = require('@vue/cli-shared-utils');
const browserslist = require('browserslist');

module.exports = (api, { entry, name, filename }) => {
  const fullEntryPath = api.resolve(entry);

  if (!fs.existsSync(fullEntryPath)) {
    log();
    error(
      `Failed to resolve lib entry: ${entry}. ` +
      `Make sure to specify the correct entry file.`);
    process.exit(1);
  }

  const libName = name || api.service.pkg.name.replace(/^@.+\//, '');

  filename = filename || libName;

  let format = 'commonjs2', postfix = 'common';

  const config = api.resolveChainableWebpackConfig();

  const targets = browserslist(undefined, { path: fullEntryPath });
  const supportsIE = targets.some(agent => agent.includes('ie'));

  const webpack = require('webpack');
  config.plugin('need-current-script-polyfill')
    .use(webpack.DefinePlugin, [{
      'process.env.NEED_CURRENTSCRIPT_POLYFILL': JSON.stringify(supportsIE),
    }]);

  // adjust css output name so they write to the same file
  if (config.plugins.has('extract-css')) {
    config.plugin('extract-css')
      .tap(args => {
        args[0].filename = `${filename}.css`;
        return args;
      });
  }

  // only minify min entry
  if (!/\.min/.test(postfix)) {
    config.optimization.minimize(false);
  }

  // externalize React in case user imports it
  config.externals({
    ...config.get('externals'),
    react: {
      commonjs: 'react',
      commonjs2: 'react',
      root: 'React',
    },
  });

  // resolve entry/output
  const entryName = `${filename}.${postfix}`;
  config.resolve.alias.set('~entry', fullEntryPath);

  // set output target before user configureWebpack hooks are applied
  config.output.libraryTarget(format);

  // set entry/output after user configureWebpack hooks are applied
  const rawConfig = api.resolveWebpackConfig(config);

  let realEntry = require.resolve('./entry-lib.js');

  // avoid importing default if user entry file does not have default export
  const entryContent = fs.readFileSync(fullEntryPath, 'utf-8');
  if (!/\b(export\s+default|export\s{[^}]+as\s+default)\b/.test(entryContent)) {
    realEntry = require.resolve('./entry-lib-no-default.js');
  }

  rawConfig.entry = {
    [entryName]: realEntry,
  };

  rawConfig.output = Object.assign({
    library: libName,
    libraryExport: undefined,
    libraryTarget: format,
    // preserve UDM header from webpack 3 until webpack provides either
    // libraryTarget: 'esm' or target: 'universal'
    // https://github.com/webpack/webpack/issues/6522
    // https://github.com/webpack/webpack/issues/6525
    globalObject: `(typeof self !== 'undefined' ? self : this)`,
  }, rawConfig.output, {
    filename: `${entryName}.js`,
    chunkFilename: `${entryName}.[name].js`,
    // use dynamic publicPath so this can be deployed anywhere
    // the actual path will be determined at runtime by checking
    // document.currentScript.src.
    publicPath: '',
  });

  return rawConfig;
};
