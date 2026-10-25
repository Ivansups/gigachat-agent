# opencode-gigachat

Плагин opencode: добавляет провайдера `GigaChat (Sberbank)` (Сбер) с автовыбором лучшей доступной модели `auto`.

В `~/.config/opencode/opencode.json`:

```json
{ "plugin": ["opencode-gigachat"] }
```

Затем `opencode providers login --provider "GigaChat (Sberbank)"`. Нужен корневой сертификат Минцифры (файлом, в систему ставить не нужно). Полная инструкция: https://github.com/Ivansups/gigachat-agent#readme
