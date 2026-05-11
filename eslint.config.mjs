import { config } from '@n8n/node-cli/eslint';

// Tests aren't shipped to npm — the dist field only includes compiled nodes
// and credentials. Vitest et al. are dev-only, so don't subject __tests__/
// to the verified-cloud allowlist.
export default [
	...config,
	{ ignores: ['__tests__/**', 'dist/**'] },
];
