const { info, openBrowser } = require('@vue/cli-shared-utils');
const url = require('url');
const chalk = require('chalk');
const webpack = require('webpack');
const WebpackDevServer = require('webpack-dev-server');
const portfinder = require('portfinder');
const prepareURLs = require('../util/prepareURLs');
const prepareProxy = require('../util/prepareProxy');
const launchEditorMiddleware = require('launch-editor-middleware');

const defaults = {
  host: '0.0.0.0',
  port: 8080,
};

module.exports = (api, options) => {
  api.registerCommand('serve', {
    description: 'start development server',
    usage: 'react-cli-service serve [options] [entry]',
    options: {
      '--open': `open browser on server start`,
    },
  }, async (args) => {
    info('Starting development server...');

    // configs that only matters for dev server
    api.chainWebpack(webpackConfig => {
      if (process.env.NODE_ENV !== 'production') {
        webpackConfig.devtool('cheap-module-eval-source-map');

        webpackConfig
          .plugin('hmr')
          .use(require('webpack/lib/HotModuleReplacementPlugin'));

        // https://github.com/webpack/webpack/issues/6642
        webpackConfig
          .output
          .globalObject(`(typeof self !== 'undefined' ? self : this)`);

        if (options.devServer.progress !== false) {
          webpackConfig
            .plugin('progress')
            .use(require('webpack/lib/ProgressPlugin'));
        }
      }
    });

    // resolve webpack config
    const webpackConfig = api.resolveWebpackConfig();

    // load user devServer options with higher priority than devServer
    // in webpack config
    const projectDevServerOptions = Object.assign(
      webpackConfig.devServer || {},
      options.devServer,
    );

    // entry arg
    const entry = args.entry;
    if (entry) {
      webpackConfig.entry = {
        app: api.resolve(entry),
      };
    }

    // resolve server options
    const useHttps = false;
    const protocol = useHttps ? 'https' : 'http';
    const host = projectDevServerOptions.host || defaults.host;
    portfinder.basePort = projectDevServerOptions.port || defaults.port;
    const port = await portfinder.getPortPromise();
    const rawPublicUrl = projectDevServerOptions.public;
    const publicUrl = rawPublicUrl
      ? /^[a-zA-Z]+:\/\//.test(rawPublicUrl)
        ? rawPublicUrl
        : `${protocol}://${rawPublicUrl}`
      : null;

    const urls = prepareURLs(
      protocol,
      host,
      port,
      /^([a-z][a-z\d\+\-\.]*:)?\/\//i.test(options.publicPath) ? '/' : options.publicPath,
    );
    const localUrlForBrowser = publicUrl || urls.localUrlForBrowser;

    const proxySettings = prepareProxy(
      projectDevServerOptions.proxy,
      api.resolve('public'),
    );

    // inject dev & hot-reload middleware entries
    const sockjsUrl = publicUrl
      // explicitly configured via devServer.public
      ? `?${publicUrl}/sockjs-node`
      : `?` + url.format({
      protocol,
      port,
      hostname: urls.lanUrlForConfig || 'localhost',
      pathname: '/sockjs-node',
    });
    const devClients = [
      // dev server client
      require.resolve(`webpack-dev-server/client`) + sockjsUrl,
      // hmr client
      require.resolve(projectDevServerOptions.hotOnly
        ? 'webpack/hot/only-dev-server'
        : 'webpack/hot/dev-server'),
    ];
    if (process.env.APPVEYOR) {
      devClients.push(`webpack/hot/poll?500`);
    }
    // inject dev/hot client
    addDevClientToEntry(webpackConfig, devClients);

    // create compiler
    const compiler = webpack(webpackConfig);

    // create server
    const server = new WebpackDevServer(compiler, Object.assign({
        clientLogLevel: 'silent',
        historyApiFallback: {
          disableDotRule: true,
          rewrites: genHistoryApiFallbackRewrites(options.publicPath, options.pages),
        },
        contentBase: api.resolve('public'),
        watchContentBase: true,
        hot: true,
        quiet: true,
        compress: false,
        publicPath: options.publicPath,
        overlay: { warnings: false, errors: true },
      }, projectDevServerOptions, {
        https: useHttps,
        proxy: proxySettings,
        // eslint-disable-next-line no-shadow
        before(app, server) {
          // launch editor support.
          app.use('/__open-in-editor', launchEditorMiddleware(() => console.log(
            `To specify an editor, specify the EDITOR env variable or ` +
            `add "editor" field to your project config.\n`,
          )));
          // allow other plugins to register middlewares, e.g. PWA
          api.service.devServerConfigFns.forEach(fn => fn(app, server));
          // apply in project middlewares
          projectDevServerOptions.before && projectDevServerOptions.before(app, server);
        },
        // avoid opening browser
        open: false,
      }))

    ;['SIGINT', 'SIGTERM'].forEach(signal => {
      process.on(signal, () => {
        server.close(() => {
          process.exit(0);
        });
      });
    });

    return new Promise((resolve, reject) => {
      // log instructions & open browser on first compilation complete
      let isFirstCompile = true;
      compiler.hooks.done.tap('react-cli-service serve', stats => {
        if (stats.hasErrors()) {
          return;
        }

        const networkUrl = publicUrl
          ? publicUrl.replace(/([^/])$/, '$1/')
          : urls.lanUrlForTerminal;

        console.log();
        console.log(`  App running at:`);
        console.log(`  - Local:   ${chalk.cyan(urls.localUrlForTerminal)}`);
        console.log(`  - Network: ${chalk.cyan(networkUrl)}`);
        console.log();

        if (isFirstCompile) {
          isFirstCompile = false;

          const buildCommand = `npm run build`;
          console.log(`  Note that the development build is not optimized.`);
          console.log(`  To create a production build, run ${chalk.cyan(buildCommand)}.`);
          console.log();

          if (args.open) {
            const pageUri = (projectDevServerOptions.openPage && typeof projectDevServerOptions.openPage === 'string')
              ? projectDevServerOptions.openPage
              : '';
            openBrowser(localUrlForBrowser + pageUri);
          }

          // resolve returned Promise
          // so other commands can do api.service.run('serve').then(...)
          resolve({
            server,
            url: localUrlForBrowser,
          });
        }
      });

      server.listen(port, host, err => {
        if (err) {
          reject(err);
        }
      });
    });
  });
};

function addDevClientToEntry(config, devClient) {
  const { entry } = config;
  if (typeof entry === 'object' && !Array.isArray(entry)) {
    Object.keys(entry).forEach((key) => {
      entry[key] = devClient.concat(entry[key]);
    });
  } else if (typeof entry === 'function') {
    config.entry = entry(devClient);
  } else {
    config.entry = devClient.concat(entry);
  }
}

function genHistoryApiFallbackRewrites(baseUrl, pages = {}) {
  const path = require('path');
  const multiPageRewrites = Object
    .keys(pages)
    // sort by length in reversed order to avoid overrides
    // eg. 'page11' should appear in front of 'page1'
    .sort((a, b) => b.length - a.length)
    .map(name => ({
      from: new RegExp(`^/${name}`),
      to: path.posix.join(baseUrl, pages[name].filename || `${name}.html`),
    }));
  return [
    ...multiPageRewrites,
    { from: /./, to: path.posix.join(baseUrl, 'index.html') },
  ];
}

module.exports.defaultModes = {
  serve: 'development',
};
