import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypeScript from 'eslint-config-next/typescript';

const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypeScript,
  {
    ignores: [
      '.next/**',
      'coverage/**',
      'dist/**',
      'node_modules/**',
      'out/**',
      'next-env.d.ts',
    ],
  },
];

export default eslintConfig;
