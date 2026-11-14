import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'tools/bin/**',
      'tools/python/**',
      'tools/cache/**',
      'public/**',
      'test-results/**',
      'playwright-report/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ['eslint.config.js', 'tools/scripts/*.mjs'] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true, allowBoolean: true }],
      '@typescript-eslint/no-non-null-assertion': 'off',
      // stylistic in this codebase (tiny DOM helpers and event handlers)
      '@typescript-eslint/no-confusing-void-expression': 'off',
      '@typescript-eslint/no-unnecessary-type-parameters': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: { globals: { process: 'readonly', console: 'readonly', URL: 'readonly' } },
  },
);
