import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'public/sw.js'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: { ecmaVersion: 2020, globals: globals.browser },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-explicit-any': 'warn',
      // _ 前缀的参数/变量/catch 视为有意未用(全计划约定:未用参数加 _ 前缀豁免)
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      // react-hooks v7 的 React Compiler 系规则对本项目(未启用 Compiler)过于激进,现有正常
      // 工作的代码大量命中(effect 内 setState、render 期写 ref 等)。重构期降为 warn:仍可见、
      // 可防回归,但不阻断、不强制改写既有逻辑。真正阻断的 rules-of-hooks 保持默认 error。
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/purity': 'warn',
      // 重写抛出时保留 cause 属改逻辑,非死代码清理,重构期降为 warn(后续 P1 再治理)。
      'preserve-caught-error': 'warn',
    },
  },
  prettier,
)
