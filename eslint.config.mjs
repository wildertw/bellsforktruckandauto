import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: ['assets/vendor/**', 'assets/js/dist/**', 'vdp/**', 'node_modules/**'],
  },
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
      'no-unused-vars': ['error', {
        caughtErrorsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      }],
      quotes: ['error', 'single'],
      semi: ['error', 'always'],
    },
  },
  {
    files: ['netlify/functions/**/*.js', '*.js'],
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
    files: ['**/*.mjs'],
    languageOptions: {
      sourceType: 'module',
    },
  },
  {
    files: ['assets/js/dashboard/**/*.js'],
    languageOptions: {
      sourceType: 'module',
      globals: {
        Chart: 'readonly',
      },
    },
  },
  {
    files: ['netlify/edge-functions/**/*.js'],
    languageOptions: {
      sourceType: 'module',
      globals: {
        Netlify: 'readonly',
      },
    },
  },
  {
    files: ['tests/**/*.mjs'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
];
