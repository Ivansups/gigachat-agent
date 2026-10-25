# gigachat-agent-mcp

MCP-сервер (stdio), который даёт Claude Code, Codex, Cursor и opencode делегировать задачи GigaChat (Сбер): инструменты `ask`, `run_agent`, `continue_session`, `list_models` и автовыбор модели `auto`.

```bash
claude mcp add --scope user gigachat -- npx -y gigachat-agent-mcp
```

Перед использованием нужны ключи GigaChat и корневой сертификат Минцифры (файлом, в систему ставить не нужно). Полная инструкция: https://github.com/Ivansups/gigachat-agent#readme
