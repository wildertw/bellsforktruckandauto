import js from '@eslint/js';
import globals from 'globals';

export default [
  js.configs.recommended,

  // Ignore generated / vendored output
  {
    ignores: [
      'assets/vendor/**',
      'assets/js/dist/**',
      'vdp/**',
      'node_modules/**',
    ],
  },

  // Default: browser scripts
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        bootstrap: 'readonly',
        Chart: 'readonly',
        Quill: 'readonly',
      },
    },
    rules: {
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      quotes: ['warn', 'single', { avoidEscape: true }],
      semi: ['error', 'always'],
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-useless-escape': 'warn',
      'no-redeclare': 'warn',
      'no-prototype-builtins': 'warn',
      'no-control-regex': 'warn',
    },
  },

  // Node CJS build scripts & netlify functions
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

  // ES module files (dashboard modules, edge functions)
  {
    files: [
      '**/*.mjs',
      'assets/js/dashboard/*.js',
    ],
    languageOptions: {
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
  },

  // Netlify edge functions (Deno-style, ES modules)
  {
    files: ['netlify/edge-functions/**/*.js'],
    languageOptions: {
      sourceType: 'module',
      globals: {
        ...globals.node,
        Netlify: 'readonly',
      },
    },
  },

  // Test files
  {
    files: ['tests/**'],
    languageOptions: {
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
  },
];
