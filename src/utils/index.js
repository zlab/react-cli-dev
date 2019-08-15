[
  'exit',
  'ipc',
  'logger',
  'module',
  'object',
  'openBrowser',
  'launch',
  'spinner',
  'validate',
].forEach(m => {
  Object.assign(exports, require(`./${m}`));
});

exports.chalk = require('chalk');
exports.execa = require('execa');
exports.semver = require('semver');
