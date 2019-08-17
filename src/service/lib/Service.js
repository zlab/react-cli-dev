const fs = require('fs');
const path = require('path');
const debug = require('debug');
const readPkg = require('read-pkg');
const merge = require('webpack-merge');
const Config = require('webpack-chain');
const PluginAPI = require('./PluginAPI');
const dotenv = require('dotenv');
const dotenvExpand = require('dotenv-expand');
const defaultsDeep = require('lodash.defaultsdeep');
const { error } = require('@vue/cli-shared-utils');

const { defaults, validate } = require('./options');

module.exports = class Service {
  constructor(context, args) {
    this.context = context;
    this.command = args._.shift();
    this.args = args;
    this.webpackChainFns = [];
    this.webpackRawConfigFns = [];
    this.devServerConfigFns = [];
    this.commands = {};
    this.pkg = readPkg.sync({ cwd: context });
    this.plugins = this.resolvePlugins();
    this.modes = this.plugins.reduce((modes, { apply: { defaultModes } }) => {
      return Object.assign(modes, defaultModes);
    }, {});
    this.mode = this.modes[this.command];
  }

  run() {
    // load env variables, load user config, apply plugins
    this.init();

    let command = this.commands[this.command];
    if (!command && this.command) {
      error(`command "${this.command}" does not exist.`);
      process.exit(1);
    }

    return command.fn(this.args);
  }

  init() {
    process.env.NODE_ENV = (this.mode === 'production' ? this.mode : 'development');

    // load mode .env
    this.loadEnv(this.mode);

    // load base .env
    this.loadEnv();

    // load user config
    const userOptions = this.loadUserOptions();
    debug('user-config')(userOptions);

    this.projectOptions = defaultsDeep(userOptions, defaults());
    debug('project-config')(this.projectOptions);

    // apply plugins.
    this.plugins.forEach(({ id, apply }) => {
      apply(new PluginAPI(id, this), this.projectOptions);
    });

    // apply webpack configs from project config file
    if (this.projectOptions.chainWebpack) {
      this.webpackChainFns.push(this.projectOptions.chainWebpack);
    }

    if (this.projectOptions.configureWebpack) {
      this.webpackRawConfigFns.push(this.projectOptions.configureWebpack);
    }
  }

  loadEnv(mode) {
    const logger = debug('env');
    const basePath = path.resolve(this.context, `.env${mode ? `.${mode}` : ``}`);
    const localPath = `${basePath}.local`;

    const load = envPath => {
      try {
        const env = dotenv.config({ path: envPath, debug: process.env.DEBUG });
        dotenvExpand(env);
        logger(envPath, env);
      } catch (err) {
        // only ignore error if file is not found
        if (err.toString().indexOf('ENOENT') < 0) {
          error(err);
        }
      }
    };

    load(localPath);
    load(basePath);
  }

  resolvePlugins() {
    const idToPlugin = id => ({
      id: id.replace(/^.\//, 'built-in:'),
      apply: require(id),
    });

    return builtInPlugins = [
      './commands/serve',
      './commands/build',
      './commands/inspect',
      // config plugins are order sensitive
      './config/base',
      './config/css',
      './config/prod',
      './config/app',
      './config/babel',
    ].map(idToPlugin);

    // const projectPlugins = Object.keys(this.pkg.devDependencies || {})
    //   .concat(Object.keys(this.pkg.dependencies || {}))
    //   .filter(isPlugin)
  }

  resolveChainableWebpackConfig() {
    const chainableConfig = new Config();
    this.webpackChainFns.forEach(fn => fn(chainableConfig));
    return chainableConfig;
  }

  resolveWebpackConfig(chainableConfig = this.resolveChainableWebpackConfig()) {
    // get raw config
    let config = chainableConfig.toConfig();
    const original = config;
    // apply raw config fns
    this.webpackRawConfigFns.forEach(fn => {
      if (typeof fn === 'function') {
        // function with optional return value
        const res = fn(config);
        if (res) config = merge(config, res);
      } else if (fn) {
        // merge literal values
        config = merge(config, fn);
      }
    });

    // #2206 If config is merged by merge-webpack, it discards the __ruleNames
    // information injected by webpack-chain. Restore the info so that
    // inspect works properly.
    if (config !== original) {
      cloneRuleNames(
        config.module && config.module.rules,
        original.module && original.module.rules,
      );
    }

    if (typeof config.entry !== 'function') {
      let entryFiles;
      if (typeof config.entry === 'string') {
        entryFiles = [config.entry];
      } else if (Array.isArray(config.entry)) {
        entryFiles = config.entry;
      } else {
        entryFiles = Object.values(config.entry || []).reduce((allEntries, curr) => {
          return allEntries.concat(curr);
        }, []);
      }

      entryFiles = entryFiles.map(file => path.resolve(this.context, file));
      process.env.VUE_CLI_ENTRY_FILES = JSON.stringify(entryFiles);
    }

    return config;
  }

  loadUserOptions() {
    let options = {};
    const configPath = path.resolve(this.context, 'react.config.js');
    if (fs.existsSync(configPath)) {
      options = require(configPath)();
    }

    // normalize some options
    ensureSlash(options, 'publicPath');
    if (typeof options.publicPath === 'string') {
      options.publicPath = options.publicPath.replace(/^\.\//, '');
    }

    removeSlash(options, 'outputDir');

    // validate options
    validate(options, msg => {
      error(`Invalid options: ${msg}`);
    });

    return options;
  }
};

function ensureSlash(config, key) {
  let val = config[key];
  if (typeof val === 'string') {
    if (!/^https?:/.test(val)) {
      val = val.replace(/^([^/.])/, '/$1');
    }
    config[key] = val.replace(/([^/])$/, '$1/');
  }
}

function removeSlash(config, key) {
  if (typeof config[key] === 'string') {
    config[key] = config[key].replace(/\/$/g, '');
  }
}

function cloneRuleNames(to, from) {
  if (!to || !from) {
    return;
  }
  from.forEach((r, i) => {
    if (to[i]) {
      Object.defineProperty(to[i], '__ruleNames', {
        value: r.__ruleNames,
      });
      cloneRuleNames(to[i].oneOf, r.oneOf);
    }
  });
}
