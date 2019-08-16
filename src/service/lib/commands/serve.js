const {
  info,
  openBrowser,
} = require('@vue/cli-shared-utils');

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
  }, async function serve(args) {
    info('Starting development server...');

    // although this is primarily a dev server, it is possible that we
    // are running it in a mode with a production env, e.g. in E2E tests.
    const isInContainer = checkInContainer();
    const isProduction = process.env.NODE_ENV === 'production';

    const url = require('url');
    const chalk = require('chalk');
    const webpack = require('webpack');
    const WebpackDevServer = require('webpack-dev-server');
    const portfinder = require('portfinder');
    const prepareURLs = require('../util/prepareURLs');
    const prepareProxy = require('../util/prepareProxy');
    const launchEditorMiddleware = require('launch-editor-middleware');
    const validateWebpackConfig = require('../util/validateWebpackConfig');

    // configs that only matters for dev server
    api.chainWebpack(webpackConfig => {
      if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test') {
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

    // check for common config errors
    validateWebpackConfig(webpackConfig, api, options);

    // load user devServer options with higher priority than devServer
    // in webpack config
    const projectDevServerOptions = Object.assign(
      webpackConfig.devServer || {},
      options.devServer,
    );

    // entry arg
    const entry = args._[0];
    if (entry) {
      webpackConfig.entry = {
        app: api.resolve(entry),
      };
    }

    // resolve server options
    const useHttps = false;
    const protocol = useHttps ? 'https' : 'http';
    const host = process.env.HOST || projectDevServerOptions.host || defaults.host;
    portfinder.basePort = process.env.PORT || projectDevServerOptions.port || defaults.port;
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
    if (!isProduction) {
      const sockjsUrl = publicUrl
        // explicitly configured via devServer.public
        ? `?${publicUrl}/sockjs-node`
        : isInContainer
          // can't infer public network url if inside a container...
          // use client-side inference (note this would break with non-root publicPath)
          ? ``
          // otherwise infer the url
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
    }

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
        watchContentBase: !isProduction,
        hot: !isProduction,
        quiet: true,
        compress: isProduction,
        publicPath: options.publicPath,
        overlay: isProduction // TODO disable this
          ? false
          : { warnings: false, errors: true },
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
        if (!isInContainer) {
          console.log(`  - Network: ${chalk.cyan(networkUrl)}`);
        } else {
          console.log();
          console.log(chalk.yellow(`  It seems you are running CLI inside a container.`));
          if (!publicUrl && options.publicPath && options.publicPath !== '/') {
            console.log();
            console.log(chalk.yellow(`  Since you are using a non-root publicPath, the hot-reload socket`));
            console.log(chalk.yellow(`  will not be able to infer the correct URL to connect. You should`));
            console.log(chalk.yellow(`  explicitly specify the URL via ${chalk.blue(`devServer.public`)}.`));
            console.log();
          }
          console.log(chalk.yellow(`  Access the dev server via ${chalk.cyan(
            `${protocol}://localhost:<your container's external mapped port>${options.publicPath}`,
          )}`));
        }
        console.log();

        if (isFirstCompile) {
          isFirstCompile = false;

          if (!isProduction) {
            const buildCommand = `npm run build`;
            console.log(`  Note that the development build is not optimized.`);
            console.log(`  To create a production build, run ${chalk.cyan(buildCommand)}.`);
          } else {
            console.log(`  App is served in production mode.`);
            console.log(`  Note this is for preview or E2E testing only.`);
          }
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

// https://stackoverflow.com/a/20012536
function checkInContainer() {
  const fs = require('fs');
  if (fs.existsSync(`/proc/1/cgroup`)) {
    const content = fs.readFileSync(`/proc/1/cgroup`, 'utf-8');
    return /:\/(lxc|docker|kubepods)\//.test(content);
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
