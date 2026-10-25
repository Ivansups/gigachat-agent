# gigachat-agent

GigaChat (Сбер) как сабагент для любых агентов: Claude Code, Codex, Cursor и самого opencode.

Два способа использования:

- **MCP-сервер (stdio)** с инструментами `ask`, `run_agent`, `continue_session`, `list_models`. Живёт только вместе с сессией клиента, постоянных процессов нет.
- **Плагин opencode**, который добавляет провайдера `GigaChat (Sberbank)`, чтобы использовать GigaChat прямо в opencode.

Оба используют общую библиотеку `core`: OAuth с файловым кэшем токена, TLS, клиент GigaChat, конвертер OpenAI ↔ GigaChat.

## Статус

Проверено вживую на macOS (Node 24, opencode 1.18.29, Claude Code 2.1): чат и сабагенты в Claude Code и в opencode, `ask`, `run_agent` (чтение и запись), вызов инструментов GigaChat. Windows **не проверялся**, инструкция для него составлена по документации и помечена отдельно. Подробности в разделе «Что проверено».

## Требования

- Node.js 24+ и `pnpm` (только для сборки)
- `opencode` в `PATH` (нужен для `run_agent` и плагина)
- Ключи GigaChat из кабинета Sber Developers: Client ID и Client Secret (либо готовый Authorization key). Временный `access_token` не подходит
- Корневой сертификат Минцифры (см. шаг 2)

## Установка: macOS

### 1. Сборка

```bash
git clone https://github.com/Ivansups/gigachat-agent.git
cd gigachat-agent
pnpm install
pnpm build
```

Сборка создаёт `packages/opencode-plugin/dist/gigachat-plugin.js` и `packages/mcp/dist/cli.mjs`.

### 2. Сертификат Минцифры

Серверы GigaChat подписаны корневым сертификатом Минцифры, которого нет в системных хранилищах. Без него будет ошибка `unknown certificate verification error` (или `self signed certificate in certificate chain`).

Сертификат кладётся в обычный файл и подключается через `GIGACHAT_CA_BUNDLE_FILE`. В системную связку ключей ничего ставить не нужно, и лучше не ставить: корневой сертификат в системе доверяет всё подряд.

```bash
mkdir -p ~/.config/gigachat && cd ~/.config/gigachat
curl -fsSLO https://gu-st.ru/content/lending/russian_trusted_root_ca_pem.crt
curl -fsSLO https://gu-st.ru/content/lending/russian_trusted_sub_ca_pem.crt
{ cat russian_trusted_root_ca_pem.crt; echo; cat russian_trusted_sub_ca_pem.crt; echo; } | grep -v '^$' > russian_ca_bundle.pem
```

Сверьте отпечаток с gosuslugi.ru/crt: `openssl x509 -in russian_trusted_root_ca_pem.crt -noout -fingerprint -sha256`.

Удаление: удалите папку `~/.config/gigachat` и строку `GIGACHAT_CA_BUNDLE_FILE`.

### 3. Ключи

Один файл `~/.config/gigachat/.env` читают и MCP-сервер, и плагин opencode, переменные в оболочке экспортировать не нужно:

```bash
cat > ~/.config/gigachat/.env <<'EOF'
GIGACHAT_CLIENT_ID=ваш-client-id
GIGACHAT_CLIENT_SECRET=ваш-client-secret
GIGACHAT_SCOPE=GIGACHAT_API_PERS
GIGACHAT_CA_BUNDLE_FILE=/Users/ИМЯ/.config/gigachat/russian_ca_bundle.pem
EOF
chmod 600 ~/.config/gigachat/.env
```

Подставьте свой путь в `GIGACHAT_CA_BUNDLE_FILE` (абсолютный). Ключи не вводятся в чат и не коммитятся. `.env` из рабочей папки намеренно не читается: сервер работает в чужих репозиториях, и такой файл мог бы отключить проверку TLS или включить `bash`.

### 4. Claude Code (MCP)

```bash
claude mcp add --scope user gigachat -- node "$PWD/packages/mcp/dist/cli.mjs"
claude mcp list
```

В списке должно быть `gigachat ... ✔ Connected`. Дальше в чате: «спроси у GigaChat …» или «запусти gigachat run_agent …».

### 5. opencode (плагин)

```bash
mkdir -p ~/.config/opencode/plugins
cp packages/opencode-plugin/dist/gigachat-plugin.js ~/.config/opencode/plugins/
opencode providers login --provider "GigaChat (Sberbank)"
```

Логин спросит scope и **Authorization key** (Base64 от `Client_ID:Client_Secret`). Если у вас есть только Client ID и Secret:

```bash
printf '%s:%s' "CLIENT_ID" "CLIENT_SECRET" | base64
```

Проверка:

```bash
opencode run --model "GigaChat (Sberbank)/GigaChat" -- "ответь одним словом: привет"
```

### 6. MCP-сервер внутри opencode (по желанию)

Это отдельный способ: инструменты GigaChat внутри opencode на любой другой модели.

```json
{ "mcp": { "gigachat": { "type": "local", "command": ["node", "/абсолютный/путь/к/gigachat-agent/packages/mcp/dist/cli.mjs"] } } }
```

## Установка: Windows

> Не проверялось на Windows. Команды написаны для PowerShell по документации Node, Claude Code и opencode. Если что-то не сработает, откройте issue с текстом ошибки.

### 1. Сборка

```powershell
git clone https://github.com/Ivansups/gigachat-agent.git
cd gigachat-agent
pnpm install
pnpm build
```

Нужен Node.js 24+ (`winget install OpenJS.NodeJS`) и `pnpm` (`npm i -g pnpm`).

### 2. Сертификат Минцифры

```powershell
$dir = "$env:USERPROFILE\.config\gigachat"
New-Item -ItemType Directory -Force $dir | Out-Null
Invoke-WebRequest https://gu-st.ru/content/lending/russian_trusted_root_ca_pem.crt -OutFile "$dir\root.crt"
Invoke-WebRequest https://gu-st.ru/content/lending/russian_trusted_sub_ca_pem.crt  -OutFile "$dir\sub.crt"
((Get-Content "$dir\root.crt") + (Get-Content "$dir\sub.crt")) | Where-Object { $_ -ne "" } | Set-Content -Encoding ascii "$dir\russian_ca_bundle.pem"
```

Сверьте отпечаток с gosuslugi.ru/crt: откройте `root.crt` двойным щелчком и посмотрите «Отпечаток» на вкладке «Состав». В хранилище Windows сертификат не устанавливайте.

Удаление: `Remove-Item -Recurse "$env:USERPROFILE\.config\gigachat"`.

### 3. Ключи

Создайте файл `%USERPROFILE%\.config\gigachat\.env`:

```
GIGACHAT_CLIENT_ID=ваш-client-id
GIGACHAT_CLIENT_SECRET=ваш-client-secret
GIGACHAT_SCOPE=GIGACHAT_API_PERS
GIGACHAT_CA_BUNDLE_FILE=C:/Users/ИМЯ/.config/gigachat/russian_ca_bundle.pem
```

В пути используйте прямые слэши `/`. Права доступа Windows этим файлом не ограничивает (в отличие от `chmod 600` на macOS), поэтому держите профиль закрытым от других пользователей.

### 4. Claude Code (MCP)

```powershell
claude mcp add --scope user gigachat -- node "$PWD\packages\mcp\dist\cli.mjs"
claude mcp list
```

### 5. opencode (плагин)

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.config\opencode\plugins" | Out-Null
Copy-Item packages\opencode-plugin\dist\gigachat-plugin.js "$env:USERPROFILE\.config\opencode\plugins\"
opencode providers login --provider "GigaChat (Sberbank)"
```

Authorization key из Client ID и Secret:

```powershell
[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("CLIENT_ID:CLIENT_SECRET"))
```

### Известные риски на Windows

- `run_agent` запускает `opencode` без оболочки. Если `opencode` у вас установлен как `.cmd`-обёртка (через `npm i -g`), запуск может не найти файл. Тогда установите нативный бинарник opencode или используйте только `ask`, которому opencode не нужен.
- Сигналы завершения (SIGTERM) на Windows работают иначе, дочерний `opencode` при закрытии сервера может остаться висеть.

## Использование сабагентом

### Claude Code

Положите файл `.claude/agents/gigachat.md` в проект (или `~/.claude/agents/gigachat.md` для всех проектов):

```markdown
---
name: gigachat
description: Делегирует узкие задачи (ревью диффа, резюме, тесты, тексты) GigaChat. Используй, когда нужен дешёвый второй взгляд.
tools: mcp__gigachat__ask, mcp__gigachat__run_agent
---
Ты тонкая прослойка. Для вопросов без доступа к файлам вызывай `mcp__gigachat__ask`, для задач с файлами проекта — `mcp__gigachat__run_agent`. Верни ответ GigaChat дословно и без добавлений.
```

После этого: «используй сабагента gigachat, пусть проверит этот дифф».

### opencode

В `opencode.json` проекта или в `~/.config/opencode/opencode.json`:

```json
{
  "agent": {
    "giga-reviewer": {
      "description": "Ревью и резюме на GigaChat",
      "mode": "subagent",
      "model": "GigaChat (Sberbank)/GigaChat",
      "tools": { "write": false, "edit": false, "bash": false }
    }
  }
}
```

Основной агент вызывает его инструментом `task` (`subagent_type: giga-reviewer`).

## Переменные

Читаются из окружения и из `~/.config/gigachat/.env` (дополнительный файл можно указать через `GIGACHAT_ENV_FILE`). Уже заданные в окружении переменные файл не перезаписывает.

| Переменная | По умолчанию | Назначение |
|---|---|---|
| `GIGACHAT_CLIENT_ID` | нет | Client ID из кабинета Sber Developers |
| `GIGACHAT_CLIENT_SECRET` | нет | Client Secret оттуда же (обязателен вместе с Client ID) |
| `GIGACHAT_CREDENTIALS` | нет | Готовый Authorization key (Base64 от `Client ID:Client Secret`); используется, только если пара выше не задана |
| `GIGACHAT_SCOPE` | `GIGACHAT_API_PERS` | Scope по официальной доке: `GIGACHAT_API_PERS` (физлица), `GIGACHAT_API_B2B` (ИП и юрлица, платные пакеты), `GIGACHAT_API_CORP` (ИП и юрлица, pay-as-you-go) |
| `GIGACHAT_BASE_URL` | `https://gigachat.devices.sberbank.ru/api/v1` | Адрес API. С 17.07.2026 в доке указан новый адрес `https://api.giga.chat`, старый остаётся доступным. Для нового задайте `https://api.giga.chat/v1` (не проверено) |
| `GIGACHAT_AUTH_URL` | `https://ngw.devices.sberbank.ru:9443/api/v2/oauth` | Адрес выдачи токена |
| `GIGACHAT_CA_BUNDLE_FILE` | нет | Путь к PEM с корневым сертификатом Минцифры |
| `GIGACHAT_VERIFY_SSL` | `true` | `false` отключает проверку TLS, только для диагностики |
| `GIGACHAT_CACHE_DIR` | `~/.cache/gigachat` | Папка кэша токена (файл `token.json`, права 0600 где поддерживаются) |
| `GIGACHAT_AGENT_MODEL` | `GigaChat (Sberbank)/GigaChat` | Модель по умолчанию для `run_agent` |
| `GIGACHAT_ALLOW_BASH` | нет | `1` разрешает `bash` в запусках с `allow_write` (см. «Безопасность») |
| `GIGACHAT_ENV_FILE` | нет | Дополнительный env-файл |

Если ключ в хранилище opencode и в окружении разные, приоритет у хранилища. Провайдер в opencode включается только при ключе в его хранилище (`opencode providers login`), одних переменных окружения для этого недостаточно: без ключа opencode обращается к виртуальному адресу `api.gigachat.local` и пишет `Cannot connect to API`.

## Инструменты MCP

| Инструмент | Что делает |
|---|---|
| `ask(prompt, system?, model?, files?)` | Прямой запрос к GigaChat без агента. `files` читаются только внутри рабочей папки сервера |
| `run_agent(prompt, model?, cwd?, agent?, allow_write?, timeout_ms?)` | Агентная задача через одноразовый `opencode run`. Возвращает результат и `session_id` |
| `continue_session(session_id, prompt, ...)` | Продолжает прошлую сессию `run_agent` |
| `list_models()` | Модели GigaChat и opencode в виде `provider/model` |

Модель для `run_agent` можно указать любую из `opencode models`, не только GigaChat.

Другие клиенты (шаблоны, в этих клиентах не проверялись):

```toml
# Codex: ~/.codex/config.toml
[mcp_servers.gigachat]
command = "node"
args = ["/абсолютный/путь/к/gigachat-agent/packages/mcp/dist/cli.mjs"]
```

Cursor: тот же `command`/`args` в `mcp.json`.

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
- `opencode run` при ошибке провайдера может надолго замолчать, поэтому таймауты обязательны. В скриптах запускайте его с закрытым stdin (`< /dev/null`), иначе он может зависнуть в ожидании ввода.

## Что проверено

На macOS, вживую с настоящим ключом:

- OAuth, `list_models`, `ask`.
- Claude Code: `ask` из чата, `ask` через сабагента, `run_agent` из чата, через сабагента и с `allow_write`.
- opencode: простой ответ, вызов инструмента `read`, делегирование сабагенту на GigaChat через `task`.
- Записанный реальный поток `opencode run --format json` (фикстура `packages/mcp/src/__fixtures__`).
- Без `allow_write` файл не создаётся.

Не проверено:

- Windows целиком.
- MCP-регистрация в Codex и Cursor.
- Явное сообщение об отказе при записи в режиме read-only: проверено лишь, что файл не создаётся и что `opencode debug agent build` показывает `edit`, `write`, `bash` запрещёнными.
- Дочерние процессы `opencode` завершаются при отмене, таймауте и штатном закрытии сервера (SIGTERM/SIGINT/закрытие stdin). При жёстком убийстве сервера (SIGKILL) завершить их он уже не может.
- Встроенного набора корневых сертификатов нет и не планируется: файл нужно получить самому из официального источника.

## Разработка

```bash
pnpm lint && pnpm typecheck && pnpm test
```

Спецификации и план: `openspec/changes/gigachat-subagent/`. Тесты пишутся раньше кода.

## Решения по устройству

- Форка opencode нет: плагин и MCP-слой поверх установленного `opencode`.
- `undici` в бандл плагина не включён: он ломает загрузку плагина под Bun. Под Bun TLS применяется через опцию `tls` встроенного `fetch`, под Node через `undici`.
- Токен кэшируется в файле с блокировкой, поэтому короткоживущие процессы не обновляют его каждый раз.
