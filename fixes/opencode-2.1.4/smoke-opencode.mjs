import http from 'node:http';
import { mkdtemp, mkdir, writeFile, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// No real API or credentials: exercise the installed OpenCode binary against a stub.
const root = await realpath(await mkdtemp(join(tmpdir(), 'gigachat-tools-')));
const plugin = fileURLToPath(new URL('.', import.meta.url));
await mkdir(join(root, 'config/opencode'), { recursive: true });
await writeFile(join(root, 'config/opencode/opencode.json'), JSON.stringify({ plugins: [plugin] }));
await writeFile(join(root, 'probe.txt'), 'BEFORE');
let pretend = false;
let functionRequests = 0;
const server = http.createServer(async (req, res) => {
  try {
    let raw = ''; for await (const chunk of req) raw += chunk;
    res.setHeader('content-type', 'application/json');
    if (req.url === '/oauth') return res.end(JSON.stringify({ access_token: 'dummy', expires_at: Date.now() + 3600000 }));
    const body = JSON.parse(raw);
    let message = { role: 'assistant', content: 'Done' };
    let finish = 'stop';
    if (body.functions?.length) {
      functionRequests++;
      assert.equal(body.function_call, 'auto');
      assert.equal(body.functions.some(f => f.name === 'execute'), false, 'Code Mode must be disabled');
      const question = body.functions.find(f => f.name === 'question');
      if (question) assert(question.parameters.properties.questions.items.properties.options.items.properties, 'Nested V2 schemas must survive conversion');
      if (!pretend) {
        const results = body.messages.filter(m => m.role === 'function').length;
        if (results < 2) {
          const name = results === 0 ? 'read' : 'write';
          assert(body.functions.some(f => f.name === name));
          message = { role: 'assistant', content: '', function_call: { name, arguments: {
            path: join(root, 'probe.txt'), ...(name === 'write' ? { content: 'AFTER' } : {}),
          } } };
          finish = 'function_call';
        }
      } else message.content = 'I changed the file successfully';
    }
    res.end(JSON.stringify({ model: 'GigaChat', choices: [{ index: 0, message, finish_reason: finish }] }));
  } catch (error) { res.statusCode = 500; res.end(JSON.stringify({ error: String(error) })); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined && !key.startsWith('GIGACHAT_') && !key.startsWith('OPENCODE_')));
Object.assign(env, {
  HOME: root, PWD: root, XDG_CONFIG_HOME: join(root, 'config'), XDG_DATA_HOME: join(root, 'data'), XDG_CACHE_HOME: join(root, 'cache'),
  GIGACHAT_CREDENTIALS: 'dummy', GIGACHAT_CACHE_DIR: join(root, 'tokens'),
  GIGACHAT_AUTH_URL: `http://127.0.0.1:${port}/oauth`, GIGACHAT_BASE_URL: `http://127.0.0.1:${port}/api/v1`,
});
const transport = new StdioClientTransport({ command: process.execPath, args: [join(plugin, 'dist/mcp.mjs')], cwd: root, env });
const client = new Client({ name: 'gigachat-tool-regression', version: '1' });
try {
  await client.connect(transport);
  const result = await client.callTool({ name: 'run_agent', arguments: { prompt: 'Read probe.txt, write AFTER, finish.', model: 'GigaChat (Sberbank)/GigaChat', allow_write: true, timeout_ms: 30000 } }, undefined, { timeout: 45000 });
  assert(!result.isError, JSON.stringify(result));
  assert.equal(await readFile(join(root, 'probe.txt'), 'utf8'), 'AFTER');
  pretend = true;
  const falseClaim = await client.callTool({ name: 'run_agent', arguments: { prompt: 'Change probe.txt.', model: 'GigaChat (Sberbank)/GigaChat', allow_write: true, timeout_ms: 30000 } }, undefined, { timeout: 45000 });
  assert.equal(falseClaim.isError, true, 'Prose without an edit must not be accepted');
  assert.match(JSON.stringify(falseClaim), /No file edit was confirmed/);
  console.log(JSON.stringify({ passed: true, actualEdit: true, falseSuccessRejected: true, functionRequests }));
} finally {
  await client.close();
  await new Promise(resolve => server.close(resolve));
  await rm(root, { recursive: true, force: true });
}
