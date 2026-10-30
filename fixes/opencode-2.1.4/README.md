# GigaChat: отдельный фикс для OpenCode 2.1.4, Claude Code и Codex

Этот каталог не заменяет исходные пакеты проекта. Он собирает адаптер провайдера для нового API OpenCode и отдельный MCP-сервер для Claude Code и Codex. Сборка использует общий код из `../../packages`, поэтому сохраняйте весь клон репозитория. В npm этот фикс не опубликован.

В OpenCode 2.1.4 изменились API плагинов и авторизации: `plugins` вместо `plugin`, экспорт `{ id, setup }` вместо `{ id, server }`, `auth login` вместо `providers login`, учётные записи вместо старого auth-loader. Для AI SDK-провайдера необходим префикс пакета `aisdk:`. У `run` больше нет `--dir`: MCP-адаптер передаёт рабочую папку через `cwd` и `PWD`, запускает приватный сервер через `--standalone`. Простая замена команды входа этого не исправляет.

## 1. Общая подготовка

Как и при [основной установке](../../docs/install/setup.md), сначала получите Client ID/Secret GigaChat и сертификат Минцифры **файлом**, затем заполните `~/.config/gigachat/.env` (Windows: `%USERPROFILE%\.config\gigachat\.env`):

```dotenv
GIGACHAT_CLIENT_ID=ваш-client-id
GIGACHAT_CLIENT_SECRET=ваш-client-secret
GIGACHAT_SCOPE=GIGACHAT_API_PERS
GIGACHAT_CA_BUNDLE_FILE=/абсолютный/путь/russian_ca_bundle.pem
```

На Windows используйте путь вида `C:/Users/ИМЯ/.config/gigachat/russian_ca_bundle.pem`. На macOS/Linux ограничьте доступ: `chmod 600 ~/.config/gigachat/.env`. Не устанавливайте сертификат в системное хранилище. Сам сертификат и подробные команды получения описаны в общей инструкции выше.

Нужны **Node.js 24+**, npm и, для `run_agent`/`continue_session`, **OpenCode 2.1.4** в `PATH`. Для `ask` и `list_models` OpenCode не нужен.

После слияния фикса в `main` скачайте репозиторий и соберите (команды одинаковы в Bash и PowerShell):

```bash
git clone https://github.com/Ivansups/gigachat-agent.git
cd gigachat-agent/fixes/opencode-2.1.4
npm ci
npm run build
```

До слияния добавьте к команде clone параметр `--branch fix_for_opencode_2.1.4`. Для уже существующего клона получите изменения из `main` после слияния либо переключитесь на ветку фикса до слияния, затем перейдите в `fixes/opencode-2.1.4`. `npm ci` выполняется **внутри папки фикса**, корневой lockfile не меняется. Не переносите каталог после подключения: клиенты сохраняют абсолютные пути.

## 2. Claude Code — основной сценарий

Claude подключает GigaChat через **MCP**, а не через плагин OpenCode. Из папки фикса:

macOS/Linux:

```bash
claude mcp add --scope user gigachat-oc214 -- node "$PWD/dist/mcp.mjs"
claude mcp list
```

Windows, PowerShell:

```powershell
claude mcp add --scope user gigachat-oc214 -- node "$((Get-Location).Path)/dist/mcp.mjs"
claude mcp list
```

Здесь используется `node`, поэтому обёртка `cmd /c npx` не нужна. Если старый сервер `gigachat` уже подключён, можно оставить его для сравнения; в запросах явно указывайте `gigachat-oc214`. После проверки отключите старую запись через `claude mcp remove gigachat`, если она больше не нужна.

Откройте новую сессию Claude в папке нужного проекта. Попросите: «Через gigachat-oc214 вызови list_models, затем ask: ответь одним словом привет». Успешное подключение MCP само по себе ещё не проверяет доступ к API GigaChat.

- `ask` и `list_models` используют GigaChat напрямую; шага 4 с OpenCode не требуют.
- Для `run_agent` и `continue_session` сначала выполните шаг 4 ниже. Затем: «Через gigachat-oc214 запусти run_agent: прочитай README.md в текущем проекте и кратко перескажи».
- `run_agent` по умолчанию только читает. Запись разрешается параметром `allow_write: true`; shell остаётся запрещённым без отдельной переменной оператора `GIGACHAT_ALLOW_BASH=1`.

Чтобы выделить сабагента, создайте в своём проекте `.claude/agents/gigachat-oc214.md`:

```markdown
---
name: gigachat-oc214
description: Делегирует GigaChat короткие задачи, ревью и резюме.
tools: mcp__gigachat-oc214__ask, mcp__gigachat-oc214__run_agent
---
Для вопросов вызывай ask, для чтения файлов проекта — run_agent сервера gigachat-oc214.
Передавай model: "auto". Не разрешай запись без явной задачи пользователя.
Верни результат GigaChat и сообщи об ошибке, если вызов не удался.
```

## 3. Codex

Используется тот же MCP-сервер. Из папки фикса, macOS/Linux:

```bash
codex mcp add gigachat-oc214 -- node "$PWD/dist/mcp.mjs"
codex mcp list
```

Windows, PowerShell:

```powershell
codex mcp add gigachat-oc214 -- node "$((Get-Location).Path)/dist/mcp.mjs"
codex mcp list
```

Перезапустите сессию Codex; в CLI проверьте `/mcp`, затем попросите вызвать `list_models` и `ask` сервера `gigachat-oc214`. Для `run_agent` выполните шаг 4. GigaChat подключается как набор инструментов делегирования; основная модель Codex от этого не меняется. Команды stdio-MCP: [официальная документация OpenAI](https://learn.chatgpt.com/docs/extend/mcp).

При необходимости задайте абсолютный путь к Node.js 24 вместо `node`, особенно если приложение запущено из GUI и не наследует PATH терминала. В конфигурации MCP не задавайте `cwd` папкой фикса: сервер ограничивает доступ папкой проекта, из которой его запустил клиент.

## 4. OpenCode 2.1.4 — для основной модели и MCP run_agent

### Подключить адаптер

В `~/.config/opencode/opencode.json` (Windows: `%USERPROFILE%\.config\opencode\opencode.json`) добавьте **каталог фикса**, не отдельный JS-файл:

```json
{
  "plugins": ["/абсолютный/путь/gigachat-agent/fixes/opencode-2.1.4"],
  "permissions": [{ "action": "execute", "resource": "*", "effect": "deny" }]
}
```

На Windows: `"C:/Users/ИМЯ/gigachat-agent/fixes/opencode-2.1.4"`. Сохраните остальные настройки и элементы `plugins` и `permissions`: допишите новые элементы в существующие массивы. Правило `execute` выключает Code Mode в этой области конфига; если другим провайдерам он нужен, задайте его только в permissions отдельного GigaChat-агента, а для MCP используйте автоматическую настройку запускателя. После сборки и настройки перезапустите сервер OpenCode (`opencode service restart`), если используете фоновый сервис. Удалите старую запись `opencode-gigachat` из старого `plugin`/нового `plugins` и старый вручную скопированный `gigachat-plugin.js` из каталога plugins, если они есть: одновременно два адаптера одного провайдера подключать не нужно. Перед ручной правкой сделайте резервную копию своего конфига.

### Авторизация

```bash
opencode --version
opencode auth login "GigaChat (Sberbank)" --method key
```

Выберите scope (`GIGACHAT_API_PERS` для личного аккаунта, `GIGACHAT_API_CORP`/`GIGACHAT_API_B2B` для соответствующего бизнес-ключа) и введите Authorization key — Base64 от `Client_ID:Client_Secret`, **не временный access_token**. Варианты генерации ключа есть в [основной инструкции](../../docs/install/opencode.md#1-подключить-плагин-и-залогиниться). Ключи не вставляйте в командную строку и не присылайте в чат.

Новая учётная запись имеет приоритет над `.env`. При отсутствии сохранённой записи адаптер может использовать ключи из `.env`. Хранилище OpenCode вручную не редактируется.

### Проверка

```bash
opencode models "GigaChat (Sberbank)"
opencode run --standalone --model "GigaChat (Sberbank)/auto" -- "ответь одним словом: привет"
```

Первая команда должна показать модели провайдера; вторая проверяет настоящий запрос, расходующий токены GigaChat. Для автоматизации закройте stdin (`< /dev/null` в Bash). В TUI выберите модель через `/models`. По умолчанию можно добавить в конфиг:

```json
{ "model": "GigaChat (Sberbank)/auto" }
```

### Основной агент и сабагент с редактированием

После подключения плагина выше добавьте в существующий конфиг следующие профили. Это конфигурация для обычного OpenCode, не только для MCP:

```json
{
  "default_agent": "gigachat",
  "agents": {
    "gigachat": {
      "description": "GigaChat: основной агент",
      "mode": "primary",
      "model": "GigaChat (Sberbank)/auto",
      "permissions": [
        { "action": "execute", "resource": "*", "effect": "deny" },
        { "action": "shell", "resource": "*", "effect": "ask" }
      ]
    },
    "gigachat-worker": {
      "description": "GigaChat: сабагент для чтения и правок",
      "mode": "subagent",
      "model": "GigaChat (Sberbank)/auto",
      "permissions": [
        { "action": "execute", "resource": "*", "effect": "deny" },
        { "action": "shell", "resource": "*", "effect": "deny" },
        { "action": "edit", "resource": "*", "effect": "allow" }
      ]
    }
  }
}
```

Сохраните остальные профили в `agents`. `default_agent` делает GigaChat основным для новых сессий; если это не нужно, опустите эту строку и выбирайте профиль вручную. `execute` отключён у обоих GigaChat-профилей, а не обязательно глобально у всех моделей. Для основного агента shell требует подтверждения, для сабагента запрещён. В OpenCode 2.1.4 действие `edit` управляет также инструментами write и patch. Разрешение записи в обычном OpenCode задаётся этим конфигом; параметр `allow_write` относится только к MCP.

После настройки выполните `opencode reload` и откройте новую сессию, чтобы не продолжать старую историю с Code Mode. Если старый плагин остаётся загруженным, выполните `opencode service restart`.

Основного агента можно проверить командой:

```bash
opencode run --standalone --agent gigachat -- "Прочитай README.md и кратко перескажи"
```

Для проверки сабагента попросите основного агента вызвать инструмент `subagent` с `agent: "gigachat-worker"` и конкретным заданием. Сабагента с `mode: subagent` не запускайте напрямую через `--agent`: это запуск основного агента.

### Сабагент только для чтения

Для сабагента в 2.1.4 используется **`agents`**, а права задаются массивом **`permissions`**:

```json
{
  "agents": {
    "giga-reviewer": {
      "description": "Ревью и резюме на GigaChat",
      "mode": "subagent",
      "model": "GigaChat (Sberbank)/auto",
      "permissions": [
        { "action": "edit", "resource": "*", "effect": "deny" },
        { "action": "write", "resource": "*", "effect": "deny" },
        { "action": "shell", "resource": "*", "effect": "deny" },
        { "action": "execute", "resource": "*", "effect": "deny" }
      ]
    }
  }
}
```

Основной агент вызывает его инструментом `subagent` с `agent: "giga-reviewer"`. Для прямого `run_agent` через MCP отдельное описание сабагента не нужно: адаптер сам задаёт права и дополнительно запрещает запись/shell через hook разрешений. Для каждого MCP-запуска каталог фикса добавляется в конфиг дочернего процесса через переменную окружения, без записи пользовательского конфига. Старые `agent` и `tools` из инструкции для v1 здесь не копируйте. Список и приоритет моделей: [модели](../../docs/config/models.md).

## Исправление чтения и редактирования

MCP-запускатель отключает инструмент `execute` (Code Mode) в дочернем OpenCode и оставляет прямые инструменты `read`, `edit`, `write`. GigaChat получает явный режим `function_call: auto`; явно заданные `tool_choice: none` и выбор конкретной функции также переводятся в формат GigaChat. Вложенные схемы инструментов сохраняются до глубины 16 вместо общей отсечки на глубине 4: иначе API отклоняет, например, вложенные options инструмента question с HTTP 422. Ответ функции сначала собирается целиком, затем передаётся OpenCode как SSE с одним стабильным ID и полными аргументами. Это устраняет потерю/фрагментацию вызовов; текстовые ответы приходят после завершения генерации.

Запись разрешается только при `allow_write: true`. В этом режиме успешный текст модели принимается только при наличии завершённого события `edit`/`write`/`patch` от OpenCode. Если модель только описала правку, MCP вернёт ошибку `No file edit was confirmed`. Для задач без правок используйте `allow_write: false`. Это подтверждает выполнение инструмента, а точность получившегося кода по-прежнему проверяйте тестами и diff. Режим только чтения и запрет shell сохраняются. Эта настройка применяется в конфиге дочернего процесса и не меняет другие MCP-серверы или локальную LLM.

Если используете GigaChat непосредственно в OpenCode, без MCP-запускателя, добавьте в конфиг или в `agents.giga-reviewer.permissions` правило:

```json
{ "permissions": [{ "action": "execute", "resource": "*", "effect": "deny" }] }
```

В существующий массив допишите правило, не удаляя остальные ограничения. Это убирает Code Mode для соответствующей области конфига; нативные файловые инструменты остаются доступны в рамках ваших разрешений. Для правок используйте основного агента или отдельного сабагента с разрешённым `edit`; пример `giga-reviewer` выше намеренно только читает.

## 5. Валидация и выбор пути

Из папки фикса:

```bash
npm run doctor
```

Скрипт проверяет Node.js, точную версию OpenCode и наличие двух сборок. Ничего не устанавливает, не меняет пользовательский конфиг, не выводит ключи и не отправляет запросы в GigaChat. Код возврата `1` означает, что локальные требования не выполнены. Для MCP `ask` отсутствие OpenCode не является препятствием.

| Симптом | Следующий шаг |
|---|---|
| Старый путь установки работает на старой версии OpenCode | Продолжайте пользоваться основной инструкцией; фикс не требуется |
| В 2.1.4 не существует `providers login`, старый плагин не загружается | Используйте этот фикс целиком: сборка, `plugins`, `auth login` |
| `run_agent` падает на неизвестном `--dir` | В Claude/Codex подключите именно `dist/mcp.mjs` из этой папки, а не прежний npm MCP |
| Моделей GigaChat нет | Проверьте абсолютный путь к каталогу, `npm run build`, ключ `plugins`, ошибки `opencode plugin list` |
| При запуске используется старый плагин | Проверьте глобальный и проектный конфиги, старые файлы plugins; перезапустите OpenCode после изменений |
| MCP не запускается | Проверьте абсолютные пути к Node 24 и `dist/mcp.mjs`, зависимости `npm ci`; откройте новую сессию клиента |
| Нет ключей / неверный scope | Проверьте `.env` или повторите `auth login`; активная запись имеет приоритет |
| Ошибка TLS | Проверьте файл сертификата и `GIGACHAT_CA_BUNDLE_FILE`, не отключайте проверку TLS |
| HTTP 402 / недоступная модель | Проверьте баланс и [настройку моделей](../../docs/config/models.md) |
| Другая версия OpenCode | Этот адаптер предназначен для 2.1.4; совместимость нужно проверять отдельно |

Автоматического отката после сетевой ошибки нет: такая ошибка может означать неверный ключ, сертификат или исчерпанные токены. Фикс выбирается по версии и контракту клиента, а не повторяет платный запрос вслепую.

## 6. Обновление и удаление

После обновления этой ветки снова выполните `npm ci` и `npm run build`, перезапустите клиенты. Если ранее копировали runtime фикса в другую папку, обновите там оба файла `dist/plugin.js` и `dist/mcp.mjs`, затем перезапустите MCP-клиент. Для удаления уберите каталог из `plugins` и записи MCP:

```bash
claude mcp remove gigachat-oc214
codex mcp remove gigachat-oc214
```

Если возвращаетесь к старому OpenCode, восстановите прежний конфиг из своей резервной копии. Исходные `packages/` и основная документация этим фиксом не меняются.

## Проверки и источники API

Проверено на macOS с Node.js 24.22.1 и OpenCode 2.1.4: загрузка локального плагина, список моделей, интерактивная авторизация с тестовым ключом и сохранение scope, полный `opencode run` и MCP-инструменты `ask`/`run_agent` через локальную HTTP-заглушку. Первоначальная проверка текстового транспорта выполнялась без реальных ключей. Исправление инструментов дополнительно проверено реальным GigaChat: чтение/редактирование тестового файла, успешное завершение run_agent, 7/7 проверок результата на диске. Воспроизводимый test:opencode работает с локальной заглушкой, без ключей.

Для разработки: `npm test`, `npm run typecheck`; интеграционный тест с локальной заглушкой и настоящим OpenCode: `npm run build && npm run test:opencode` (реальные ключи не нужны); из корня также `node_modules/.bin/eslint fixes/opencode-2.1.4`. Публичный API сверяется с тегом **v2.1.4**, а не только с изменяемой текущей документацией:

- [Режимы вызова функций GigaChat](https://developers.sber.ru/docs/ru/gigachat/guides/functions/function-calling-modes), [Code Mode и прямые инструменты OpenCode](https://dev.opencode.ai/v2/docs/tools/).
- [Контракт plugin setup](https://github.com/anomalyco/opencode/blob/v2.1.4/packages/plugin/src/promise/plugin.ts), [integration](https://github.com/anomalyco/opencode/blob/v2.1.4/packages/plugin/src/promise/integration.ts), [AISDK hooks](https://github.com/anomalyco/opencode/blob/v2.1.4/packages/plugin/src/promise/aisdk.ts).
- [CLI run](https://github.com/anomalyco/opencode/blob/v2.1.4/packages/cli/src/run/run.ts), [JSON events](https://github.com/anomalyco/opencode/blob/v2.1.4/packages/cli/src/run/noninteractive.ts).
- [Подключение плагинов v2](https://dev.opencode.ai/v2/docs/plugins/), [авторизация v2](https://dev.opencode.ai/v2/docs/cli/providers).

На Windows для `run_agent` нужен нативный `opencode.exe` в PATH: npm-обёртка `.cmd` при запуске без shell может не работать. Windows-команды требуют отдельной живой проверки; не считайте их подтверждённой Windows-установкой. Успешность запросов к GigaChat зависит от ваших ключей, сертификата, сети и баланса.
