/**
 * ts-node config for overriding base tsconfig
 *
 * Usage:
 *  mocha --compilers ts:./test/ts-node-test.js,tsx:./test/ts-node-test.js ./test/*
 *  (When placed in the test directory)
 */
require('ts-node').register({ compilerOptions: Object.assign(require('../tsconfig.json').compilerOptions, {
	"noImplicitAny": false,
	"strictNullChecks": false
}) });