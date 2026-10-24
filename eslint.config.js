import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'supabase/functions/*/_lib'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      // erasable TypeScript only (Node type stripping / Deno copies)
      'no-restricted-syntax': [
        'error',
        { selector: 'TSEnumDeclaration', message: 'Use a union of string literals instead of enum.' },
        { selector: 'TSModuleDeclaration[kind="namespace"]', message: 'Namespaces are not erasable.' },
        { selector: 'TSParameterProperty', message: 'Parameter properties are not erasable.' },
        { selector: 'Decorator', message: 'Decorators are not allowed.' },
      ],
    },
  },
  {
    files: ['**/*.{js,mjs}'],
    languageOptions: { globals: { ...globals.node } },
  },
);
