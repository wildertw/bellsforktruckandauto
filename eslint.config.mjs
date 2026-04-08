import js from '@eslint/js';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        bootstrap: 'readonly',
      },
    },
    rules: {
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      quotes: ['error', 'single'],
      semi: ['error', 'always'],
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
    },
  },
  // ESM files (.mjs, dashboard modules, edge functions)
  {
    files: ['**/*.mjs', 'assets/js/dashboard/**/*.js', 'netlify/edge-functions/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
        Netlify: 'readonly',
      },
    },
  },
  // Node.js CommonJS scripts: root-level build tools and Netlify functions.
  // These run in Node, so browser globals aren't relevant and console.log is fine.
  {
    files: ['*.js', 'netlify/functions/**/*.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-console': 'off',
    },
  },
  {
    ignores: ['assets/vendor/**', 'assets/js/dist/**', 'vdp/**', 'node_modules/**'],
  },
];
