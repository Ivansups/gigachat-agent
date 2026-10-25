# GigaChat как сабагент в Claude Code

В Claude Code GigaChat подключается как MCP-сервер, а не как «плагин». Claude вызывает его инструменты `ask` и `run_agent` сам или через сабагента. Перед началом выполните [общую установку](setup.md) (сертификат и `.env`).

## 1. Подключить MCP-сервер

macOS:

```bash
claude mcp add --scope user gigachat -- npx -y gigachat-agent-mcp
claude mcp list
```

Windows (PowerShell; для `npx` Claude Code на Windows требует обёртку `cmd /c`, команда не проверялась):

```powershell
claude mcp add --scope user gigachat -- cmd /c npx -y gigachat-agent-mcp
claude mcp list
```

В списке должно быть `gigachat ... ✔ Connected`. Область `--scope user` делает сервер доступным во всех проектах. Отключить: `claude mcp remove gigachat`.

Клонировать и собирать ничего не нужно: `npx` скачивает пакет при первом запуске и кэширует. Чтобы обновиться, перезапустите сессию Claude Code (при необходимости задайте `gigachat-agent-mcp@latest`).

## 2. Что нужно для каждого инструмента

| Инструмент | Что нужно |
|---|---|
| `ask`, `list_models` | только эта установка и `.env` |
| `run_agent`, `continue_session` | дополнительно `opencode` с плагином и сохранённым ключом: выполните шаги 1 и 2 из [opencode](opencode.md), потому что `run_agent` запускает `opencode run` |

`ask` отвечает напрямую от GigaChat, без доступа к файлам (файлы передаются параметром `files`). `run_agent` даёт GigaChat работать с проектом через opencode: по умолчанию **только чтение**, запись включается параметром `allow_write`.

## 3. Использовать из чата

Просто попросите: «спроси у GigaChat …» или «запусти gigachat run_agent: прочитай notes.txt и скажи …». Имена инструментов в разрешениях: `mcp__gigachat__ask`, `mcp__gigachat__run_agent`, `mcp__gigachat__continue_session`, `mcp__gigachat__list_models`. В первый раз Claude Code спросит разрешение; чтобы не спрашивать, разрешите их в настройках или передайте `--allowedTools` в неинтерактивном режиме.

Выбор модели: параметр `model`. `model: "auto"` берёт лучшую доступную по очереди Ultra, Max, Pro, Lite, а в конце ответа `ask` добавляет `[model: ...]`. Подробности: [Выбор модели](../config/models.md).

## 4. Сабагент

Положите файл `.claude/agents/gigachat.md` в проект (или `~/.claude/agents/gigachat.md` для всех проектов):

```markdown
---
name: gigachat
description: Делегирует узкие задачи (ревью диффа, резюме, тесты, тексты) GigaChat. Используй, когда нужен дешёвый второй взгляд.
tools: mcp__gigachat__ask, mcp__gigachat__run_agent
---
Ты тонкая прослойка. Для вопросов без доступа к файлам вызывай `mcp__gigachat__ask`, для задач с файлами проекта вызывай `mcp__gigachat__run_agent`. Всегда передавай `model: "auto"`. Верни ответ GigaChat дословно и без добавлений.
```

После этого: «используй сабагента gigachat, пусть проверит этот дифф». Такая цепочка проверена: сабагент вызвал `ask` с файлом и `run_agent` и вернул ответы GigaChat.

Если сабагенту не нужен доступ к файлам, оставьте в `tools` только `mcp__gigachat__ask`: это безопаснее.

## 5. Безопасность и границы

- `run_agent` только читает, пока вы не передали `allow_write: true`; и даже тогда `bash` запрещён без `GIGACHAT_ALLOW_BASH=1`, который задаёт только оператор. Подробнее: [справочник](../reference.md#безопасность).
- `cwd` и `files` должны лежать внутри папки, где запущена сессия Claude Code.
- GigaChat слабее Claude в многошаговой работе с инструментами. Хорошо подходит для ревью диффа, резюме, генерации тестов и текстов: [ограничения](../reference.md#ограничения-gigachat).

## 6. Если что-то не работает

| Симптом | Причина |
|---|---|
| `gigachat ... ✘ Failed` в `claude mcp list` | нет Node.js 24+ или `npx` не может скачать пакет (нет доступа к npm); на Windows забыта обёртка `cmd /c` |
| `The TLS certificate ... is not trusted (SELF_SIGNED_CERT_IN_CHAIN)` | сертификат Минцифры не подключён или путь в `GIGACHAT_CA_BUNDLE_FILE` неверный: [установка](setup.md) |
| `run_agent` отвечает «Unexpected server error» | в opencode не поставлен плагин или не сохранён ключ: [opencode, шаг 1](opencode.md) |
| `Cannot reach GigaChat at ...` | сеть или VPN, либо включён недоступный новый хост: [VPN и новый хост](../config/vpn-and-hosts.md) |
| `tokens are exhausted ... (HTTP 402)` | закончились токены модели: [Выбор модели](../config/models.md) |
