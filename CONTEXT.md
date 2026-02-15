# CONTEXT

## 2026-02-15 — Priority 5: GLM Endpoint Connection Check

### Что добавлено
1. Расширен `model` конфиг:
- `connectionCheckSystemPrompt`
- `connectionCheckUserPrompt`
- `connectionCheckMaxTokens`

2. Добавлен скрипт проверки подключения:
- `src/scripts/checkModelConnection.ts`
- npm команда: `npm run model:check`

3. Что делает `model:check`:
- читает runtime config + env;
- отправляет тестовый `chat/completions` запрос на `MODEL_API_BASE_URL`;
- печатает provider/model/endpoint/ответ;
- возвращает non-zero код при ошибке подключения.

4. Обновлена документация (`README.md`) с инструкцией по проверке GLM/openai-compatible endpoint.

## 2026-02-15 — Priority 4: Tests

### Что добавлено
1. Подключен тестовый раннер `vitest`:
- обновлен `package.json` (`npm test`).

2. Добавлен набор unit/smoke тестов:
- `tests/unit/pauseController.test.ts`
- `tests/unit/approvalGate.test.ts`
- `tests/unit/contextEngine.test.ts`
- `tests/unit/recoveryManager.test.ts`
- `tests/unit/orchestrator.smoke.test.ts`

3. Покрытые области:
- pause/resume/stop семантика;
- approval lifecycle;
- ranking/компрессия контекста;
- recovery-планы и autopause;
- базовый end-to-end цикл оркестратора.

4. Верификация:
- `npm run check` — passed;
- `npm test` — passed (8/8).

## 2026-02-15 — Priority 3: Recovery Strategies

### Что добавлено
1. Реализован `RecoveryManager` (`src/core/recoveryManager.ts`):
- определение recovery-плана на основе типа ошибки, действия и количества последовательных неудач;
- стратегии: `wait + retry`, `dismiss popup`, `corrective scroll`, базовая пауза;
- авто-пауза агента при достижении лимита последовательных ошибок.

2. Интеграция в оркестратор (`src/core/orchestrator.ts`):
- подсчет `consecutiveFailures`;
- запуск recovery-плана при ошибке действия;
- подробный лог recovery rationale и фактических recovery actions.

3. Конфигурирование через `config/default.json`:
- добавлен раздел `recovery` (триггеры transient-ошибок, лимиты, тайминги, параметры паузы).

## 2026-02-15 — Priority 2: Sub-agent Routing

### Что добавлено
1. Реализован `SubAgentRouter` (`src/core/subAgentRouter.ts`) с ролями:
- `navigator`
- `extractor`
- `action`
- `verifier`

2. Интеграция в оркестратор (`src/core/orchestrator.ts`):
- на каждом шаге выбирается активная роль;
- в live-логах отображаются выбранная роль и rationale.

3. Интеграция в модельный слой:
- `DecisionInput` расширен полем `route`;
- в prompt модели добавлены роль, ролевая инструкция и rationale шага.

4. Конфигурирование через `config/default.json`:
- добавлен раздел `subAgents` с флагом `enabled` и role-specific инструкциями.

## 2026-02-15 — Priority 1: Context Engine

### Что добавлено
1. Реализован `ContextEngine` (`src/context/contextEngine.ts`):
- извлечение ключевых слов задачи;
- ранжирование интерактивных элементов по релевантности;
- фильтрация top-N элементов для передачи в модель;
- `attentionHints` для объяснимого фокуса на следующих шагах.

2. Интеграция в цикл оркестратора (`src/core/orchestrator.ts`):
- перед каждым решением строится `contextPacket`;
- в live-логах выводятся метрики компрессии (`selectedElements/totalElements`) и подсказки фокуса.

3. Интеграция в model prompt (`src/model/openaiCompatibleClient.ts`):
- вместо передачи полного snapshot список элементов ограничен ранжированными кандидатами;
- в prompt добавлены `summary`, `attention_hints`, `compression`.

4. Конфигурирование через `config/default.json`:
- добавлен раздел `context` с лимитами, stop-словами и весами scoring.

## 2026-02-15 — Полный перезапуск проекта с нуля

### Причина
Старый код агента был удалён как нерабочий. Проект перезапущен с чистой архитектуры под личного многофункционального браузерного агента.

### Что реализовано

1. Базовая архитектура агента
- Оркестратор с циклом: `observe -> decide -> act -> verify`.
- История шагов с ограничением размера.
- Retry принятия решений при ошибках модели.

2. Управление агентом во время выполнения
- Реализованы команды:
  - `/run <task>`
  - `/pause`
  - `/resume`
  - `/stop`
  - `/approve`
  - `/deny`
  - `/status`
  - `/help`
  - `/exit`
- Добавлена возможность ставить выполнение на паузу, вручную менять состояние в браузере и продолжать выполнение.

3. Безопасность
- Добавлен `ApprovalGate` для рискованных шагов.
- Риск определяется по:
  - `riskLevel` из решения модели,
  - флагу `requiresConfirmation`,
  - триггер-словам из конфига.
- Поддержано явное подтверждение (`/approve`) и отклонение (`/deny`).

4. Browser runtime
- `Playwright` в видимом режиме (`headless=false` в дефолте).
- Persistent profile через `.browser-profile`.
- Snapshot страницы с извлечением ограниченного списка интерактивных элементов.
- Поддержка действий: `navigate`, `click`, `type`, `press`, `scroll`, `wait`.

5. Model layer
- `ModelGateway` с адаптерами:
  - `openai_compatible`
  - `rule_based` (fallback)
- Строгая валидация JSON-ответа модели.

6. Наблюдаемость и логирование
- Цветные логи по типам событий:
  - system, status, observation, decision, action, approval, success, warn, error.
- Параллельная запись структурированных событий в `logs/agent-events.jsonl`.

7. Конфигурация
- Все ключевые параметры, промпты и лимиты вынесены в `config/default.json`.
- Переменные окружения только для секретов и override model settings.

### Основные проектные решения

1. Отказ от хардкода сценариев
- Агент работает через общий action-интерфейс, без заранее прописанных шагов под конкретные сайты.

2. Управление рисками через policy, а не через ad-hoc проверки
- Политика подтверждений централизована в конфиге и оркестраторе.

3. Разделение на слои
- CLI, core, model, browser, tools, telemetry, config.
- Это упрощает дальнейшее расширение и тестирование.

### Что дальше

1. Усилить контекст-движок
- Добавить ранжирование важности элементов и сжатие наблюдений по цели.

2. Добавить sub-agent routing
- Navigator / Extractor / Action / Verifier роли под единым orchestrator.

3. Улучшить recovery
- Стратегии повторов по типам ошибок UI/DOM/timeout.

4. Добавить тесты
- Unit-тесты для safety/pause/orchestrator.
- Smoke E2E для базового сценария браузера.
