import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const directory = fileURLToPath(new URL('.', import.meta.url));
const shared = {
  absWorkingDir: directory,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  alias: { '@gigachat-agent/core': fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)) },
  external: ['undici', '@modelcontextprotocol/sdk/*', 'zod'],
  logLevel: 'info',
};
await build({ ...shared, entryPoints: ['src/plugin.ts'], outfile: 'dist/plugin.js' });
await build({ ...shared, entryPoints: ['src/mcp.ts'], outfile: 'dist/mcp.mjs' });
