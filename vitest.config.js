const { defineConfig } = require('vitest/config');

module.exports = defineConfig({
  test: {
    globals: false,
    testTimeout: 10000,
  },
});
