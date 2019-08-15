#!/usr/bin/env node

const { error } = require('../../utils');

const rawArgv = process.argv.slice(2);
const args = require('minimist')(rawArgv);
const command = args._[0];

const Service = require('../lib/Service');
new Service(process.cwd()).run(command, args, rawArgv).catch(err => {
  error(err);
  process.exit(1);
});
