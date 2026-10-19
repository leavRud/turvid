import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  // Функции Supabase и Netlify работают в Deno — у них свои типы и окружение.
  { ignores: ['dist', 'node_modules', 'supabase/functions', 'netlify/edge-functions'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  prettier,
  {
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    // В тестах ! после поиска по массиву короче и понятнее проверок.
    files: ['test/**/*.ts'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
);
