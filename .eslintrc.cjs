module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: { project: './tsconfig.json' },
  plugins: ['@typescript-eslint', 'import'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  env: { node: true, es2022: true },
  ignorePatterns: ['dist', 'node_modules'],
  rules: {
    'import/no-restricted-paths': ['error', {
      zones: [
        { target: './src/domain', from: './src/application', message: 'domain must not import application' },
        { target: './src/domain', from: './src/infrastructure', message: 'domain must stay dependency-free' },
        { target: './src/domain', from: './src/api', message: 'domain must stay dependency-free' },
        { target: './src/application', from: './src/infrastructure', message: 'application depends on ports, not adapters' },
        { target: './src/application', from: './src/api', message: 'application must not know its callers' },
      ],
    }],
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
  },
};
