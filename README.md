# gigachat-agent

GigaChat (Сбер) как сабагент для любых агентов: Claude Code, Codex, Cursor и самого opencode.

Два способа использования:

- **MCP-сервер (stdio)** с инструментами `ask`, `run_agent`, `continue_session`, `list_models`. Живёт только вместе с сессией клиента, постоянных процессов нет.
- **Плагин opencode**, который добавляет провайдера `GigaChat (Sberbank)`, чтобы использовать GigaChat прямо в opencode.

Оба используют общую библиотеку `core`: OAuth с файловым кэшем токена, TLS, клиент GigaChat, конвертер OpenAI ↔ GigaChat.

## Статус

Автоматические тесты (мок-сеть) проходят. Реальный GigaChat с настоящим ключом **ещё не проверялся**: нужны ключ и корневой сертификат Минцифры (см. «Что не проверено»).

## Требования

- Node.js 24+, `pnpm`
- `opencode` в `PATH` (нужен для `run_agent` и плагина)
- Authorization key GigaChat из кабинета Sber Developers (Base64 от `Client_ID:Client_Secret`). Временный `access_token` не подходит

## Установка

```bash
pnpm install
pnpm build
```

Сборка создаёт `packages/opencode-plugin/dist/gigachat-plugin.js` и `packages/mcp/dist/cli.mjs`.

## Ключи

Ключ не вводится в чат и не коммитится. Есть три места:

| Способ | Для чего |
|---|---|
| `opencode providers login --provider "GigaChat (Sberbank)"` | Плагин opencode и `run_agent`. Ключ и scope сохраняются в хранилище opencode |
| Переменные окружения | Быстрый запуск, а также инструмент `ask` (он обращается к GigaChat напрямую, минуя opencode) |
| `~/.config/gigachat/.env` или файл из `GIGACHAT_ENV_FILE` | Те же переменные для MCP-сервера. `.env` из рабочей папки намеренно не читается: сервер работает в чужих репозиториях, и такой файл мог бы отключить проверку TLS или включить `bash` |

Переменные (см. `.env.example`):

| Переменная | По умолчанию | Назначение |
|---|---|---|
| `GIGACHAT_CREDENTIALS` | нет | Authorization key |
| `GIGACHAT_SCOPE` | `GIGACHAT_API_PERS` | Scope по официальной доке: `GIGACHAT_API_PERS` (физлица), `GIGACHAT_API_B2B` (ИП и юрлица, платные пакеты), `GIGACHAT_API_CORP` (ИП и юрлица, pay-as-you-go) |
| `GIGACHAT_BASE_URL` | `https://gigachat.devices.sberbank.ru/api/v1` | Адрес API. С 17.07.2026 в доке указан новый адрес `https://api.giga.chat`, старый остаётся доступным. Для нового задайте `https://api.giga.chat/v1` (не проверено) |
| `GIGACHAT_AUTH_URL` | `https://ngw.devices.sberbank.ru:9443/api/v2/oauth` | Адрес выдачи токена. В доке для него по-прежнему пример со старым хостом |
| `GIGACHAT_CA_BUNDLE_FILE` | нет | Путь к PEM с корневым сертификатом Минцифры |
| `GIGACHAT_VERIFY_SSL` | `true` | `false` отключает проверку TLS, только для диагностики |
| `GIGACHAT_CACHE_DIR` | `~/.cache/gigachat` | Папка кэша токена (файл `token.json`, права 0600) |
| `GIGACHAT_AGENT_MODEL` | `GigaChat (Sberbank)/GigaChat` | Модель по умолчанию для `run_agent` |
| `GIGACHAT_ALLOW_BASH` | нет | `1` разрешает `bash` в запусках с `allow_write` (см. «Безопасность») |

Если ключ в хранилище opencode и в окружении разные, приоритет у хранилища.

## Сертификаты

Сервер GigaChat использует корневой сертификат Минцифры, которого нет в системных хранилищах. Без него будет ошибка `unknown certificate verification error`.

1. Скачайте корневой (и при необходимости выпускающий) сертификат с официального сайта Минцифры.
2. Если файл в формате DER, переведите его в PEM: `openssl x509 -inform DER -in russian_trusted_root_ca.cer -out russian_trusted_root_ca.pem`.
3. Укажите путь в `GIGACHAT_CA_BUNDLE_FILE`.

Встроенного набора сертификатов в проекте нет и не планируется: файл нужно получить самому из официального источника (на Госуслугах: gosuslugi.ru/crt).

## Плагин opencode

```bash
mkdir -p ~/.config/opencode/plugins
cp packages/opencode-plugin/dist/gigachat-plugin.js ~/.config/opencode/plugins/
opencode providers login --provider "GigaChat (Sberbank)"
opencode run --model "GigaChat (Sberbank)/GigaChat" "ответь одним словом"
```

Провайдер регистрируется сам, вручную править `opencode.json` не нужно. Если запись `GigaChat (Sberbank)` в конфиге уже есть, плагин её не перезаписывает.

Сабагента внутри opencode можно задать моделью `GigaChat (Sberbank)/GigaChat` в конфиге агента.

Важно: провайдер включается, только когда у opencode есть сохранённые данные для него. Если ключа нет, opencode обращается напрямую к виртуальному адресу `api.gigachat.local` и пишет `Cannot connect to API`.

## MCP-сервер

Claude Code:

```bash
claude mcp add gigachat -- node /абсолютный/путь/к/gigachat-agent/packages/mcp/dist/cli.mjs
```

Другие клиенты (шаблоны, в этих клиентах не проверялись):

```toml
# Codex: ~/.codex/config.toml
[mcp_servers.gigachat]
command = "node"
args = ["/абсолютный/путь/к/gigachat-agent/packages/mcp/dist/cli.mjs"]
```

```json
// opencode.json
{ "mcp": { "gigachat": { "type": "local", "command": ["node", "/абсолютный/путь/к/gigachat-agent/packages/mcp/dist/cli.mjs"] } } }
```

Cursor: тот же `command`/`args` в `mcp.json`.

### Инструменты

| Инструмент | Что делает |
|---|---|
| `ask(prompt, system?, model?, files?)` | Прямой запрос к GigaChat без агента. `files` читаются только внутри рабочей папки сервера |
| `run_agent(prompt, model?, cwd?, agent?, allow_write?, timeout_ms?)` | Агентная задача через одноразовый `opencode run`. Возвращает результат и `session_id` |
| `continue_session(session_id, prompt, ...)` | Продолжает прошлую сессию `run_agent` |
| `list_models()` | Модели GigaChat и opencode в виде `provider/model` |

Модель для `run_agent` можно указать любую из `opencode models`, не только GigaChat.

## Безопасность

- `run_agent` по умолчанию **только читает**: `edit`, `write` и `bash` запрещены через `OPENCODE_CONFIG_CONTENT`. Флаг `--auto` не используется никогда.
- `allow_write: true` разрешает только `edit` и `write`. `bash` остаётся запрещённым, пока оператор сам не задаст `GIGACHAT_ALLOW_BASH=1` в окружении сервера. Флаг из вызова инструмента оболочку не открывает.
- `cwd` и файлы для `ask` должны лежать внутри папки, где запущен сервер. Ссылки (symlink) на файлы вне её отклоняются.
- У каждого запуска есть таймаут (по умолчанию 10 минут, максимум час), вывод ограничен по размеру, процесс завершается при отмене запроса.
- Кэш токена хранится с правами 0600. Ключ и токен не попадают в сообщения об ошибках.

## Ограничения GigaChat

- Слабее Claude в многошаговой работе с инструментами. Надёжно подходит для узких задач: ревью диффа, резюме, генерация тестов и текстов по описанию.
- За одно сообщение передаётся один вызов функции (`tools` превращаются в `functions`).
- Схемы инструментов упрощаются (без `anyOf`/`oneOf`, ограниченная вложенность, короткие описания). Некорректный вызов функции повторяется один раз с подсказкой.
- Контекстное окно по официальным страницам моделей: 128 000 токенов (GigaChat 2, 2 Pro, 2 Max, 2 Lite). Лимит вывода в доке не указан, в плагине стоит осторожные 4096. Бюджет входа сервера: 200 000 символов. Модели первого поколения (`GigaChat`, `GigaChat-Pro`, `GigaChat-Max`) недоступны, запросы к ним перенаправляются на второе поколение.
- `opencode run` при ошибке провайдера (например, исчерпан лимит) может надолго замолчать, поэтому таймауты обязательны.

## Что не проверено

- Работа с настоящим ключом: задачи 2.1–2.4, 5.4, 7.1, 7.2 из `openspec/changes/gigachat-subagent/tasks.md`.
- Событие `text` в `opencode run --format json`: события `step_start` и `error` проверены на живом запуске, форма `text` взята по предположению.
- Живой отказ при записи в режиме read-only: проверено только, что `opencode debug agent build` показывает `edit`, `write`, `bash` запрещёнными.
- MCP-регистрация в Claude Code, Codex, Cursor и opencode.
- Дочерние процессы `opencode` завершаются при отмене, таймауте и штатном закрытии сервера (SIGTERM/SIGINT/закрытие stdin). При жёстком убийстве сервера (SIGKILL) завершить их он уже не может.
- Встроенного набора корневых сертификатов нет.

## Разработка

```bash
pnpm lint && pnpm typecheck && pnpm test
```

Спецификации и план: `openspec/changes/gigachat-subagent/`. Тесты пишутся раньше кода.

## Решения по устройству

- Форка opencode нет: плагин и MCP-слой поверх установленного `opencode`.
- `undici` в бандл плагина не включён: он ломает загрузку плагина под Bun. Под Bun TLS применяется через опцию `tls` встроенного `fetch`, под Node через `undici`.
- Токен кэшируется в файле с блокировкой, поэтому короткоживущие процессы не обновляют его каждый раз.
