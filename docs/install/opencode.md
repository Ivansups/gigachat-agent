# GigaChat в opencode

GigaChat работает в opencode как обычный провайдер: его можно выбрать основной моделью или сделать сабагентом. Перед началом выполните [общую установку](setup.md) (сертификат и `.env`).

## 1. Подключить плагин и залогиниться

Добавьте плагин в `~/.config/opencode/opencode.json` (на Windows `%USERPROFILE%\.config\opencode\opencode.json`) или в `opencode.json` проекта. Если массив `plugin` уже есть, допишите в него имя:

```json
{ "plugin": ["opencode-gigachat"] }
```

opencode сам установит пакет при запуске вместе с зависимостями (кэш в `~/.cache/opencode/packages/`), копировать ничего не нужно. Затем сохраните ключ в opencode:

```bash
opencode providers login --provider "GigaChat (Sberbank)"
```

Логин спросит scope и **Authorization key** (Base64 от `Client_ID:Client_Secret`). Если у вас есть только Client ID и Secret:

```bash
printf '%s:%s' "CLIENT_ID" "CLIENT_SECRET" | base64
```

```powershell
[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("CLIENT_ID:CLIENT_SECRET"))
```

Плагин регистрирует провайдера сам, вручную править `opencode.json` не нужно. Если запись `GigaChat (Sberbank)` в конфиге уже есть, плагин её не перезаписывает.

## 2. Проверить

```bash
opencode run --model "GigaChat (Sberbank)/auto" -- "ответь одним словом: привет"
```

Должен прийти ответ. Если вместо него `Cannot connect to API` и адрес `api.gigachat.local`, значит, ключ не сохранён в opencode (шаг с `providers login` пропущен): одних переменных окружения для включения провайдера недостаточно.

## 3. GigaChat как основная модель

- В TUI: `/models` и выбрать `GigaChat (Sberbank)`.
- Для одной команды: `opencode run --model "GigaChat (Sberbank)/GigaChat-2-Max" -- "..."`.
- По умолчанию для всех запусков (стандартный ключ конфига opencode, здесь отдельно не проверялся) в `~/.config/opencode/opencode.json`:

  ```json
  { "model": "GigaChat (Sberbank)/auto" }
  ```

Модель `auto` сама выбирает лучшую доступную по очереди Ultra, Max, Pro, Lite. Подробности: [Выбор модели и автовыбор](../config/models.md).

## 4. GigaChat как сабагент

В `opencode.json` проекта или в `~/.config/opencode/opencode.json`:

```json
{
  "agent": {
    "giga-reviewer": {
      "description": "Ревью и резюме на GigaChat",
      "mode": "subagent",
      "model": "GigaChat (Sberbank)/auto",
      "tools": { "write": false, "edit": false, "bash": false }
    }
  }
}
```

Основной агент (на любой модели) вызывает сабагента инструментом `task` с `subagent_type: giga-reviewer`. Такая делегация проверена с моделью `GigaChat (Sberbank)/GigaChat`: основной агент на GigaChat передал задачу сабагенту и получил его ответ. С `auto` в сабагенте отдельно не гонялась (сама `auto` в opencode проверена).

GigaChat слабее в работе с инструментами: сабагенту надёжнее давать задание с явным относительным путём к файлу («прочитай notes.txt в текущей папке»). При расплывчатом задании он может полезть за пределы рабочей папки, и opencode отклонит доступ (`external_directory`).

У каждого сабагента может быть своя модель, например дешёвая `GigaChat-2` для сводок и сильная `GigaChat-2-Max` для ревью. Сабагента (`mode: subagent`) нельзя запустить как основного через `--agent`: opencode выдаст предупреждение.

## 5. Обновление и частые проблемы

- Обновление: opencode кэширует пакет в `~/.cache/opencode/packages/`. Чтобы получить новую версию, удалите там папку `opencode-gigachat@…` и запустите opencode снова (порядок обновления отдельно не проверялся).
- В скриптах запускайте `opencode run` с закрытым stdin (`< /dev/null`): без этого он может зависнуть в ожидании ввода.
- Если ключ в хранилище opencode и в `.env` разные, приоритет у хранилища.
- Ошибки про токены, недоступные модели и сеть: [Выбор модели](../config/models.md) и [VPN и новый хост](../config/vpn-and-hosts.md).

## Хотите наоборот: инструменты GigaChat внутри opencode на другой модели

Это отдельный способ (MCP-сервер в opencode), в `opencode.json`:

```json
{ "mcp": { "gigachat": { "type": "local", "command": ["npx", "-y", "gigachat-agent-mcp"] } } }
```

Инструменты MCP описаны в [справочнике](../reference.md#инструменты-mcp).
