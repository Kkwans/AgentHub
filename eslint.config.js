import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/playwright-report/**',
      '**/real-playwright-report/**',
      '**/test-results/**',
      '.agenthub/**',
      '.tmp/**',
      '.tmp-v05/**',
      'test-tmp/**',
      'docs/AgentHub_v0.8_UIUX_Final/04_prototype/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['scripts/qa/**/*.cjs'],
    languageOptions: {
      globals: {
        console: 'readonly',
        document: 'readonly',
        fetch: 'readonly',
        module: 'readonly',
        process: 'readonly',
        require: 'readonly',
        window: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
  {
    files: ['scripts/release/**/*.mjs'],
    languageOptions: {
      globals: {
        URL: 'readonly',
        console: 'readonly',
        process: 'readonly',
      },
    },
  },
  {
    files: ['docs/AgentHub_v0.7_Design_Handoff_Package/08_prototype/app.js'],
    languageOptions: {
      globals: {
        document: 'readonly',
        getComputedStyle: 'readonly',
        localStorage: 'readonly',
        window: 'readonly',
      },
    },
    rules: {
      'no-empty': 'off',
    },
  },
  {
    files: ['docs/AgentHub_v0.9_Product_Quality_Rebuild/04_prototype/app.js'],
    languageOptions: {
      globals: {
        document: 'readonly',
        getComputedStyle: 'readonly',
        localStorage: 'readonly',
        window: 'readonly',
      },
    },
    rules: {
      'no-empty': 'off',
    },
  },
  {
    files: ['tests/fixtures/acp/fake-agent.mjs'],
    languageOptions: {
      globals: {
        Buffer: 'readonly',
        ReadableStream: 'readonly',
        WritableStream: 'readonly',
      },
    },
  },
);
