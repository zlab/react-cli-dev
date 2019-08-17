const fs = require('fs');
const globby = require('globby');
const tslint = require('tslint');

// we save the non-script parts to a cache right before
// linting the file, and patch fs.writeFileSync to combine the fixed script
// back with the non-script parts.
// this works because (luckily) tslint lints synchronously.
const patchProgram = program => {
  const getSourceFile = program.getSourceFile;
  program.getSourceFile = function(file, languageVersion, onError) {
    return getSourceFile.call(this, file, languageVersion, onError);
  };
};

module.exports = function lint(args = {}, api, silent) {
  const cwd = api.resolve('.');

  const program = tslint.Linter.createProgram(api.resolve('tsconfig.json'));
  patchProgram(program);

  const linter = new tslint.Linter({
    fix: args['fix'] !== false,
    formatter: args.format || 'codeFrame',
    formattersDirectory: args['formatters-dir'],
    rulesDirectory: args['rules-dir'],
  }, program);

  // patch linter.updateProgram to ensure every program has correct getSourceFile
  const updateProgram = linter.updateProgram;
  // eslint-disable-next-line no-shadow
  linter.updateProgram = function(...args) {
    updateProgram.call(this, ...args);
    patchProgram(this.program);
  };

  const tslintConfigPath = tslint.Configuration.CONFIG_FILENAMES
    .map(filename => api.resolve(filename))
    .find(file => fs.existsSync(file));

  const config = tslint.Configuration.findConfiguration(tslintConfigPath).results;

  const lintFile = file => {
    const filePath = api.resolve(file);
    linter.lint(
      // append .ts so that tslint apply TS rules
      filePath,
      '',
      config,
    );
  };

  const patterns = ['src/**/*.ts', 'src/**/*.tsx', 'tests/**/*.ts', 'tests/**/*.tsx'];

  // respect linterOptions.exclude from tslint.json
  if (config.linterOptions && config.linterOptions.exclude) {
    // use the raw tslint.json data because config contains absolute paths
    const rawTslintConfig = tslint.Configuration.readConfigurationFile(tslintConfigPath);
    const excludedGlobs = rawTslintConfig.linterOptions.exclude;
    excludedGlobs.forEach((g) => patterns.push('!' + g));
  }

  return globby(patterns, { cwd }).then(files => {
    files.forEach(lintFile);
    if (silent) return;
    const result = linter.getResult();
    if (result.output.trim()) {
      process.stdout.write(result.output);
    } else if (result.fixes.length) {
      // some formatters do not report fixes.
      const f = new tslint.Formatters.ProseFormatter();
      process.stdout.write(f.format(result.failures, result.fixes));
    } else if (!result.failures.length) {
      console.log(`No lint errors found.\n`);
    }

    if (result.failures.length && !args.force) {
      process.exitCode = 1;
    }
  });
};
