import { spawnSync } from 'node:child_process';
import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

let failed = false;
function check(ok, message) {
  console.log(`${ok ? 'OK' : 'FAIL'}: ${message}`);
  if (!ok) failed = true;
}
check(Number(process.versions.node.split('.')[0]) >= 24, `Node.js ${process.versions.node}; требуется 24+`);
const version = spawnSync('opencode', ['--version'], { encoding: 'utf8', timeout: 10000 });
const text = (version.stdout ?? '').trim();
check(version.status === 0 && /^opencode v?2\.1\.4$/.test(text),
  `OpenCode: ${text || 'не удалось запустить'}; этот фикс предназначен для 2.1.4`);
for (const file of ['dist/plugin.js', 'dist/mcp.mjs']) {
  const exists = await access(new URL(file, import.meta.url)).then(() => true, () => false);
  check(exists, `${file}${exists ? '' : ' отсутствует: выполните npm run build'}`);
}
console.log('\nОсновной путь для старого OpenCode: ../../docs/install/opencode.md');
console.log('На 2.1.4 используйте plugins (множественное число) и каталог:');
console.log(fileURLToPath(new URL('.', import.meta.url)));
console.log('Авторизация: opencode auth login "GigaChat (Sberbank)" --method key');
console.log('Проверка: opencode models "GigaChat (Sberbank)"');
console.log('Затем: opencode run --standalone --model "GigaChat (Sberbank)/auto" -- "ответь одним словом: привет"');
console.log('Подключение Claude/Codex и диагностика: README.md рядом с этим скриптом.');
console.log('Скрипт не проверяет ключи, сеть GigaChat или настройки вашего профиля.');
process.exitCode = failed ? 1 : 0;
