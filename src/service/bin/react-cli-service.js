#!/usr/bin/env node

const { error } = require('@vue/cli-shared-utils');

const Service = require('../lib/Service');
const args = require('minimist')(process.argv.slice(2));

new Service(process.cwd(), args).run().catch(err => {
  error(err);
  process.exit(1);
});
