# Общая установка

Нужна один раз, для обоих сценариев (opencode и Claude Code). После неё переходите к [opencode](opencode.md) или [Claude Code](claude-code.md).

Содержание: [что устанавливается](#что-устанавливается), [macOS](#macos), [Windows](#windows), [из исходников](#установка-из-исходников-для-разработки).

## Что устанавливается

Два пакета из npm, клонировать и собирать ничего не нужно:

| Пакет | Для чего | Кто его ставит |
|---|---|---|
| `opencode-gigachat` | плагин opencode: провайдер `GigaChat (Sberbank)` | сам opencode при запуске, достаточно строки в `opencode.json` |
| `gigachat-agent-mcp` | MCP-сервер для Claude Code, Codex, Cursor и opencode | `npx -y gigachat-agent-mcp`, его запускает сам клиент |

Нужен Node.js 24+ (проверено на 24) для MCP-сервера; `opencode` в `PATH` нужен для плагина и для `run_agent`. Общая часть для обоих сценариев: сертификат и ключи, ниже.

## macOS

### 1. Сертификат Минцифры

Серверы GigaChat подписаны корневым сертификатом Минцифры, которого нет в системных хранилищах. Без него инструмент остановится с ошибкой `The TLS certificate of https://ngw.devices.sberbank.ru:9443 is not trusted (SELF_SIGNED_CERT_IN_CHAIN)` и подсказкой про `GIGACHAT_CA_BUNDLE_FILE` (в opencode и в старых версиях то же выглядит как `self signed certificate in certificate chain`).

Сертификат кладётся в обычный файл и подключается через `GIGACHAT_CA_BUNDLE_FILE`. В системную связку ключей ничего ставить не нужно, и лучше не ставить: корневой сертификат в системе доверяет всё подряд.

```bash
mkdir -p ~/.config/gigachat && cd ~/.config/gigachat
curl -fsSLO https://gu-st.ru/content/lending/russian_trusted_root_ca_pem.crt
curl -fsSLO https://gu-st.ru/content/lending/russian_trusted_sub_ca_pem.crt
{ cat russian_trusted_root_ca_pem.crt; echo; cat russian_trusted_sub_ca_pem.crt; echo; } | grep -v '^$' > russian_ca_bundle.pem
```

Сверьте отпечаток с gosuslugi.ru/crt: `openssl x509 -in russian_trusted_root_ca_pem.crt -noout -fingerprint -sha256`.

Удаление: удалите папку `~/.config/gigachat` и строку `GIGACHAT_CA_BUNDLE_FILE`.

### 2. Ключи

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

Подставьте свой абсолютный путь в `GIGACHAT_CA_BUNDLE_FILE`. Client ID и Client Secret берутся в кабинете Sber Developers (временный `access_token` не подходит). Ключи не вводятся в чат и не коммитятся.

`.env` из рабочей папки намеренно не читается: сервер работает в чужих репозиториях, и такой файл мог бы отключить проверку TLS или включить `bash`. Читаются только `~/.config/gigachat/.env` и файл из `GIGACHAT_ENV_FILE`.

## Windows

> Не проверялось на Windows. Команды написаны для PowerShell по документации Node, Claude Code и opencode. Если что-то не сработает, откройте issue с текстом ошибки.

Нужен Node.js 24+ (`winget install OpenJS.NodeJS`).

### 1. Сертификат Минцифры

```powershell
$dir = "$env:USERPROFILE\.config\gigachat"
New-Item -ItemType Directory -Force $dir | Out-Null
Invoke-WebRequest https://gu-st.ru/content/lending/russian_trusted_root_ca_pem.crt -OutFile "$dir\root.crt"
Invoke-WebRequest https://gu-st.ru/content/lending/russian_trusted_sub_ca_pem.crt  -OutFile "$dir\sub.crt"
((Get-Content "$dir\root.crt") + (Get-Content "$dir\sub.crt")) | Where-Object { $_ -ne "" } | Set-Content -Encoding ascii "$dir\russian_ca_bundle.pem"
```

Сверьте отпечаток с gosuslugi.ru/crt: откройте `root.crt` двойным щелчком и посмотрите «Отпечаток» на вкладке «Состав». В хранилище Windows сертификат не устанавливайте.

Удаление: `Remove-Item -Recurse "$env:USERPROFILE\.config\gigachat"`.

### 2. Ключи

Создайте файл `%USERPROFILE%\.config\gigachat\.env`:

```
GIGACHAT_CLIENT_ID=ваш-client-id
GIGACHAT_CLIENT_SECRET=ваш-client-secret
GIGACHAT_SCOPE=GIGACHAT_API_PERS
GIGACHAT_CA_BUNDLE_FILE=C:/Users/ИМЯ/.config/gigachat/russian_ca_bundle.pem
```

В пути используйте прямые слэши `/`. Права доступа Windows этим файлом не ограничивает (в отличие от `chmod 600` на macOS), поэтому держите профиль закрытым от других пользователей.

### Известные риски на Windows

- `run_agent` запускает `opencode` без оболочки. Если `opencode` у вас установлен как `.cmd`-обёртка (через `npm i -g`), запуск может не найти файл. Тогда установите нативный бинарник opencode или используйте только `ask`, которому opencode не нужен.
- Сигналы завершения (SIGTERM) на Windows работают иначе, дочерний `opencode` при закрытии сервера может остаться висеть.

## Установка из исходников (для разработки)

Нужна, только если вы правите код или хотите непубликованную версию. Нужны Node.js 24+ и `pnpm` (на Windows: `npm i -g pnpm`).

```bash
git clone https://github.com/Ivansups/gigachat-agent.git
cd gigachat-agent
pnpm install
pnpm build
```

Сборка создаёт `packages/mcp/dist/cli.mjs` (MCP-сервер) и `packages/opencode-plugin/dist/gigachat-plugin.js` (плагин). Подключение вместо npm-пакетов:

- Claude Code: `claude mcp add --scope user gigachat -- node "$PWD/packages/mcp/dist/cli.mjs"` (на Windows `"$PWD\packages\mcp\dist\cli.mjs"`). В конфиг записывается абсолютный путь, после переноса папки команду нужно повторить.
- opencode: скопируйте `gigachat-plugin.js` в `~/.config/opencode/plugins/` (на Windows `%USERPROFILE%\.config\opencode\plugins\`) вместо строки в `"plugin"`. После каждой пересборки копируйте заново.

## Дальше

- [GigaChat в opencode](opencode.md)
- [GigaChat как сабагент в Claude Code](claude-code.md)
