import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

// Next 16 ships native flat configs — no FlatCompat shim needed.
const eslintConfig = defineConfig([
  globalIgnores(['.next/**', 'out/**', 'build/**', 'next-env.d.ts']),
  ...nextVitals,
  ...nextTs,
]);

export default eslintConfig;
