// eslint.config.js — flat config for ESLint 10.
//
// Permissive base — we want the catch-the-obvious-stuff lint, not a
// style war. Strict rules that matter:
//   - no-unused-vars (kills dead code in tools/)
//   - no-undef (catches missing imports)
//   - eqeqeq (forces === for type-safety against API response shapes)
//   - no-console (server.js writes to process.stderr explicitly; any
//     stray console.log would corrupt the MCP stdio stream)

export default [
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        // Node 20 globals we use.
        process: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        AbortSignal: 'readonly',
        crypto: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-undef': 'error',
      'eqeqeq': ['error', 'always', { null: 'ignore' }],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'no-var': 'error',
      'prefer-const': 'warn',
    },
  },
  {
    // Tests can do whatever — node:test has its own globals via import.
    files: ['test/**/*.js'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    ignores: ['node_modules/', 'coverage/'],
  },
];
