const path = require('path');

module.exports = (api, projectOptions) => {
  const fs = require('fs');
  const useThreads = process.env.NODE_ENV === 'production' && !!projectOptions.parallel;

  api.chainWebpack(config => {
    config.resolveLoader.modules.prepend(path.join(__dirname, 'node_modules'));

    if (!projectOptions.pages) {
      config.entry('app')
        .clear()
        .add('./src/main.tsx');
    }

    config.resolve
      .extensions
      .prepend('.ts')
      .prepend('.tsx');

    const tsRule = config.module.rule('ts').test(/\.ts$/);
    const tsxRule = config.module.rule('tsx').test(/\.tsx$/);

    // add a loader to *.ts
    const addLoader = ({ loader, options }) => {
      tsRule.use(loader).loader(loader).options(options);
      tsxRule.use(loader).loader(loader).options(options);
    };

    addLoader({
      loader: 'cache-loader',
      options: api.genCacheConfig('ts-loader', {
        'ts-loader': require('ts-loader/package.json').version,
        'typescript': require('typescript/package.json').version,
        modern: false,
      }, ['tsconfig.json']),
    });

    if (useThreads) {
      addLoader({ loader: 'thread-loader' });
    }

    addLoader({ loader: 'babel-loader' });

    addLoader({
      loader: 'ts-loader',
      options: {
        transpileOnly: true,
        // https://github.com/TypeStrong/ts-loader#happypackmode-boolean-defaultfalse
        happyPackMode: useThreads,
      },
    });
    // make sure to append TSX suffix
    tsxRule.use('ts-loader').loader('ts-loader').tap(options => {
      options = Object.assign({}, options);
      return options;
    });

    config
      .plugin('fork-ts-checker')
      .use(require('fork-ts-checker-webpack-plugin'), [{
        tslint: projectOptions.lintOnSave !== false && fs.existsSync(api.resolve('tslint.json')),
        formatter: 'codeframe',
        // https://github.com/TypeStrong/ts-loader#happypackmode-boolean-defaultfalse
        checkSyntacticErrors: useThreads,
      }]);
  });

  if (!api.hasPlugin('eslint')) {
    api.registerCommand('lint', {
      description: 'lint source files with TSLint',
      usage: 'react-cli-service lint [options] [...files]',
      options: {
        '--format [formatter]': 'specify formatter (default: codeFrame)',
        '--no-fix': 'do not fix errors',
        '--formatters-dir [dir]': 'formatter directory',
        '--rules-dir [dir]': 'rules directory',
      },
    }, args => {
      return require('./lib/tslint')(args, api);
    });
  }
};
