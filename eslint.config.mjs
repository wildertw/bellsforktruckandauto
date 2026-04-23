import js from '@eslint/js';
import globals from 'globals';

const sharedRules = {
  'no-console': ['warn', { allow: ['warn', 'error'] }],
  quotes: ['error', 'single', { avoidEscape: true, allowTemplateLiterals: true }],
  semi: ['error', 'always'],
  // Catch params and intentional throwaways (`_`) are common; only flag named vars.
  'no-unused-vars': ['error', {
    args: 'after-used',
    argsIgnorePattern: '^_',
    caughtErrors: 'all',
    caughtErrorsIgnorePattern: '^(_|e|err|error|ignored?)$',
    varsIgnorePattern: '^_',
  }],
};

export default [
  js.configs.recommended,

  // Default: ES modules, latest JS, browser globals.
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser },
    },
    rules: sharedRules,
  },

  // Browser ES module dashboard split (already ESM).
  {
    files: ['assets/js/dashboard/**/*.js'],
    languageOptions: {
      sourceType: 'module',
      globals: { ...globals.browser, Chart: 'readonly', Quill: 'readonly' },
    },
  },

  // Browser classic scripts (IIFE-wrapped, attached to window).
  {
    files: ['assets/js/*.js', 'inventory-loader.js', 'vehicle-manager.js'],
    languageOptions: {
      sourceType: 'script',
      globals: { ...globals.browser, bootstrap: 'readonly' },
    },
  },

  // Service worker.
  {
    files: ['sw.js'],
    languageOptions: {
      sourceType: 'script',
      globals: { ...globals.serviceworker },
    },
  },

  // Node CommonJS: build scripts at the repo root + Netlify Functions.
  // Build scripts legitimately use console.log for CLI output, so allow it.
  {
    files: ['netlify/functions/**/*.js', '*.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      'no-console': 'off',
    },
  },

  // Re-apply browser overrides AFTER the root-CJS block so they win for
  // files that happen to live at the repo root (inventory-loader.js,
  // vehicle-manager.js) — flat config merges later blocks last.
  {
    files: ['inventory-loader.js', 'vehicle-manager.js'],
    languageOptions: {
      sourceType: 'script',
      globals: { ...globals.browser, bootstrap: 'readonly' },
    },
  },
  {
    files: ['sw.js'],
    languageOptions: {
      sourceType: 'script',
      globals: { ...globals.serviceworker },
    },
  },

  // Netlify Edge Functions run on Deno; ESM with browser-ish runtime globals.
  {
    files: ['netlify/edge-functions/**/*.js'],
    languageOptions: {
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node, Netlify: 'readonly', Deno: 'readonly' },
    },
  },

  // Vitest test files.
  {
    files: ['tests/**/*.{js,mjs}'],
    languageOptions: {
      sourceType: 'module',
      globals: {
        ...globals.node,
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        vi: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
      },
    },
  },

  {
    ignores: ['assets/vendor/**', 'assets/js/dist/**', 'vdp/**', 'node_modules/**'],
  },
];
