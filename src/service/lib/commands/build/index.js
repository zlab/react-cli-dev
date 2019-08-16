const defaults = {
  clean: true,
  target: 'app',
  formats: 'commonjs,umd,umd-min',
  'unsafe-inline': true,
};

const buildModes = {
  lib: 'library',
  wc: 'web component',
  'wc-async': 'web component (async)',
};

const modifyConfig = (config, fn) => {
  if (Array.isArray(config)) {
    config.forEach(c => fn(c));
  } else {
    fn(config);
  }
};

module.exports = (api, options) => {
  api.registerCommand('build', {
    description: 'build for production',
    usage: 'react-cli-service build [options] [entry|pattern]',
    options: {
      '--mode': `specify env mode (default: production)`,
      '--dest': `specify output directory (default: ${options.outputDir})`,
      '--no-unsafe-inline': `build app without introducing inline scripts`,
      '--target': `app | lib | wc | wc-async (default: ${defaults.target})`,
      '--formats': `list of output formats for library builds (default: ${defaults.formats})`,
      '--name': `name for lib or web-component mode (default: "name" in package.json or entry filename)`,
      '--filename': `file name for output, only usable for 'lib' target (default: value of --name)`,
      '--no-clean': `do not remove the dist directory before building the project`,
      '--report': `generate report.html to help analyze bundle content`,
    },
  }, async (args) => {
    for (const key in defaults) {
      if (args[key] == null) {
        args[key] = defaults[key];
      }
    }
    args.entry = args.entry || args._[0];
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
  const validateWebpackConfig = require('../../util/validateWebpackConfig');
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
    const buildMode = buildModes[args.target];
    if (buildMode) {
      const additionalParams = buildMode === 'library' ? ` (${args.formats})` : ``;
      logWithSpinner(`Building for ${mode} as ${buildMode}${additionalParams}...`);
    } else {
      throw new Error(`Unknown build target: ${args.target}`);
    }
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

  // check for common config errors
  validateWebpackConfig(webpackConfig, api, options, args.target);

  if (args.report) {
    const { BundleAnalyzerPlugin } = require('webpack-bundle-analyzer');
    modifyConfig(webpackConfig, config => {
      const bundleName = args.target !== 'app' ? config.output.filename.replace(/\.js$/, '-') : '';
      config.plugins.push(new BundleAnalyzerPlugin({
        logLevel: 'warn',
        openAnalyzer: false,
        analyzerMode: 'static',
        reportFilename: `${bundleName}report.html`,
      }));
    });
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
