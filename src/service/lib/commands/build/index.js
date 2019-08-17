const defaults = {
  clean: true,
  target: 'app',
};

module.exports = (api, options) => {
  api.registerCommand('build', {
    description: 'build for production',
    usage: 'react-cli-service build [options] [entry|pattern]',
    options: {
      '--dest': `specify output directory (default: ${options.outputDir})`,
      '--target': `app | lib (default: ${defaults.target})`,
      '--name': `name for lib or web-component mode (default: "name" in package.json or entry filename)`,
      '--filename': `file name for output, only usable for 'lib' target (default: value of --name)`,
      '--report': `generate report.html to help analyze bundle content`,
    },
  }, async (args) => {
    for (const key in defaults) {
      if (args[key] == null) {
        args[key] = defaults[key];
      }
    }

    if (args.target !== 'app') {
      args.entry = args.entry || 'src/main.js';
    }

    process.env.VUE_CLI_BUILD_TARGET = args.target;

    await build(args, api, options);

    delete process.env.VUE_CLI_BUILD_TARGET;
  });
};

async function build(args, api, options) {
  const fs = require('fs-extra');
  const path = require('path');
  const chalk = require('chalk');
  const webpack = require('webpack');
  const formatStats = require('./formatStats');
  const {
    log,
    done,
    info,
    logWithSpinner,
    stopSpinner,
  } = require('@vue/cli-shared-utils');

  log();

  const mode = api.service.mode;
  if (args.target === 'app') {
    logWithSpinner(`Building for ${mode}...`);
  } else {
    logWithSpinner(`Building for ${mode} as library (commonjs)...`);
  }

  if (args.dest) {
    // Override outputDir before resolving webpack config as config relies on it (#2327)
    options.outputDir = args.dest;
  }

  const targetDir = api.resolve(options.outputDir);

  // resolve raw webpack config
  let webpackConfig;
  if (args.target === 'lib') {
    webpackConfig = require('./resolveLibConfig')(api, args, options);
  } else {
    webpackConfig = require('./resolveAppConfig')(api, args, options);
  }

  if (args.report) {
    const { BundleAnalyzerPlugin } = require('webpack-bundle-analyzer');
    const bundleName = args.target !== 'app' ? webpackConfig.output.filename.replace(/\.js$/, '-') : '';
    webpackConfig.plugins.push(new BundleAnalyzerPlugin({
      logLevel: 'warn',
      openAnalyzer: false,
      analyzerMode: 'static',
      reportFilename: `${bundleName}report.html`,
    }));
  }

  if (args.clean) {
    await fs.remove(targetDir);
  }

  return new Promise((resolve, reject) => {
    webpack(webpackConfig, (err, stats) => {
      stopSpinner(false);

      if (err) {
        return reject(err);
      }

      if (stats.hasErrors()) {
        return reject(`Build failed with errors.`);
      }

      if (!args.silent) {
        const targetDirShort = path.relative(
          api.service.context,
          targetDir,
        );
        log(formatStats(stats, targetDirShort, api));
        if (args.target === 'app') {
          done(`Build complete. The ${chalk.cyan(targetDirShort)} directory is ready to be deployed.`);
        }
      }

      resolve();
    });
  });
}

module.exports.defaultModes = {
  build: 'production',
};
