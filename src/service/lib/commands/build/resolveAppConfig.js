module.exports = (api, args, options) => {
  const config = api.resolveChainableWebpackConfig();
  const targetDir = api.resolve(args.dest || options.outputDir);

  // respect inline build destination in copy plugin
  if (args.dest && config.plugins.has('copy')) {
    config.plugin('copy').tap(pluginArgs => {
      pluginArgs[0][0].to = targetDir;
      return pluginArgs;
    });
  }

  const rawConfig = api.resolveWebpackConfig(config);

  // respect inline entry
  if (args.entry && !options.pages) {
    rawConfig.entry = { app: api.resolve(args.entry) };
  }

  return rawConfig;
};
