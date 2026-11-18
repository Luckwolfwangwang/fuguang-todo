'use strict';

// Running the test files in one process avoids spawning child processes, which
// some Windows sandboxes deny with EPERM. Each test file registers its tests on
// the built-in node:test runner and they execute as this script exits.
require('./dates.test');
require('./store.test');
