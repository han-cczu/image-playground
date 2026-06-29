import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'

export default tseslint.config(
  { ignores: ['dist', 'node_modules'] },
  {
    extends: [js.configs.recommended],
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.node, ...globals.es2021 },
    },
  },
  {
    extends: [js.configs.recommended],
    files: ['public/sw.js'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: { ...globals.serviceworker, URL: 'readonly', Promise: 'readonly', JSON: 'readonly' },
    },
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: { ecmaVersion: 2020, globals: globals.browser },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['error', { allowConstantExport: true }],
      '@typescript-eslint/no-explicit-any': 'error',
      // _ 前缀的参数/变量/catch 视为有意未用(全计划约定:未用参数加 _ 前缀豁免)
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      // 已治理为 0 命中,保持 error 防止 effect 同步 state、render 期 ref 访问等问题回流。
      'react-hooks/set-state-in-effect': 'error',
      'react-hooks/refs': 'error',
      'react-hooks/purity': 'error',
      // 重写抛出必须保留 cause,否则会丢失网络/AbortError 的根因诊断。
      'preserve-caught-error': 'error',
    },
  },
  prettier,
)
