# CONTEXT

## 2026-02-17 — Вернули compact reasoning в консоль без шума

### Задача
Пользователь попросил вернуть в терминал «мысли»/обоснование выбранного действия, но не перегружать поток логов.

### Что реализовано
1. Добавлен отдельный console decision digest:
- сообщение формата: `STEP N: план и причина`;
- поля: `action`, `why`, `target`, `thought`.

2. Анти-спам логика digest:
- новый режим `mode=on_change`:
  - если action+args+successCriteria не меняются, digest не печатается на каждом шаге;
  - выводится напоминание только каждые `repeatReminderEvery` повторов.

3. Управление длиной текста digest через конфиг:
- `thoughtMaxLength`
- `reasoningMaxLength`
- `successCriteriaMaxLength`

4. Все параметры вынесены в конфиг:
- `logging.console.decisionDigest.*`

### Измененные файлы
- `src/core/orchestrator.ts`
- `src/config/types.ts`
- `src/config/loadConfig.ts`
- `config/default.json`
- `tests/unit/orchestrator.smoke.test.ts`
- `README.md`

## 2026-02-17 — HH 60-step Failure Analysis + Anti-Loop Execution Guards

### Что было проанализировано
Разобран запуск из `logs/agent-events.jsonl`, начавшийся в `2026-02-16T21:41:25.552Z` (задача про отклик на 50 вакансий), закончившийся на лимите 60 шагов.

Ключевые факты по логу:
- 60 решений, 27 скроллов, 23 клика, 3 попытки `type`, 1 `ask_user`.
- Повторные ошибки на шагах 18/21/27: `type` в `input[type="checkbox"]` (`Input of type "checkbox" cannot be filled`).
- Длинный бесполезный цикл: массовые `scroll up 1000` и повторные клики по одним и тем же header-элементам.
- На шаге 60 повторный `click e-33` (кнопка вакансий) завершался timeout и recovery снова повторял тот же неуспешный клик.
- Был эпизод fallback в `rule_based` (шаг 23), что привело к `ask_user` посреди сценария.

### Корневые причины
1. Недостаточно информативный snapshot:
- отсутствовал `inputType`, из-за чего модель путала текстовое поле и checkbox;
- выборка элементов была шумной и включала много нерелевантного DOM (header/footer), что усиливало циклы.

2. Отсутствие execution-guard слоя:
- агент мог многократно выполнять одно и то же действие без автокоррекции тактики.

3. Click-timeout не имел fallback по `href`:
- при проблемах с локатором агент не пробовал прямую навигацию по ссылке.

4. Fallback модели включался слишком рано:
- при transient-сбоях primary провайдера происходил уход в `rule_based` и `ask_user`.

### Что реализовано
1. Расширение snapshot/runtime:
- добавлены поля элемента: `inputType`, `name`, `inViewport`;
- добавлено извлечение текста из `label` для form-элементов без текстового контента;
- добавлен viewport-фильтр снапшотов:
  - `browser.snapshot.onlyViewportElements`
  - `browser.snapshot.viewportMarginPx`.

2. Улучшения выполнения browser actions:
- `type` теперь проверяет text-editable (по `tag/role/inputType`) и возвращает контролируемую ошибку вместо падения;
- `click` при timeout (если включено) делает fallback: `href -> navigate`;
- `wait` поддерживает `duration` и нормализует к `ms`.

3. Orchestrator action guards:
- guard `type -> click` для не-текстовых элементов;
- guard `click -> navigate(href)` при повторе одного и того же клика;
- guard для длинных серий одинакового скролла: `scroll -> press(Home/End)`;
- guard-нормализация `wait.duration -> wait.ms`.

4. Контекст и anti-loop hints:
- penalize для non-text input и low-signal элементов;
- в `attentionHints` добавлены:
  - маркеры антицикла (повтор action, неизменный URL),
  - сводка недавних ошибок.

5. Fallback модели:
- добавлен `model.fallbackMode` (`always` / `non_transient_only` / `never`);
- добавлен `model.transientErrorKeywords`;
- при `non_transient_only` fallback не используется для transient ошибок (чтобы не проваливаться в `rule_based` на временных сбоях).

6. Prompt policy обновлена в конфиге:
- явный запрет `type` в non-text input;
- запрет бесконечных повторов одного `action+args`;
- рекомендация `click -> navigate(href)`, если click не дал эффекта;
- требование задавать `wait.ms`.

## 2026-02-16 — Console Log Signal Cleanup + Finish Output Fix

### Задача
Сделать консольные логи более операторскими:
- убрать шумные уровни (`system`, `decision`, `observation`) из терминала;
- убрать дубли `action`/`success` (оставить `action` только по явному allow-list);
- не терять и не обрезать итоговые пользовательские ответы на `finish`.

### Что реализовано
1. Фильтрация уровней в терминале:
- добавлен `logging.console.visibleLevels`;
- события скрытых уровней продолжают писаться в `agent-debug.txt` и `agent-events.jsonl`.

2. Управление стартовыми `ACTION`-логами:
- добавлен `logging.console.actionStartLogActions` (allow-list);
- по умолчанию список пустой, поэтому дублирующие `ACTION` в консоль не выводятся.

3. Необрезаемые важные поля в консоли:
- добавлен `logging.console.neverTruncateKeys`;
- ключи из списка выводятся отдельными строками без сокращения.

4. Исправлен итог `finish`:
- оркестратор теперь извлекает финальный текст из `summary`, `text`, `result`, `message` (в таком приоритете);
- устраняется случай, когда модель вернула результат в `args.text`, а пользователю показывался дефолтный summary.

5. Усилен recovery парсинга args из сырого текста модели:
- для `finish` и `ask_user` добавлено восстановление `summary/question`, если `action.args` пришли строкой.

6. Для видимости подсказок и help без `SYSTEM`:
- CLI banner/help/close переведены на `STATUS`.

## 2026-02-16 — Resume UX + Fast Navigation Wait Modes

### Задачи
1. Уточнить и усилить UX ручного логина через `ask_user`.
2. Устранить лишние долгие ожидания полной загрузки тяжелых страниц.
3. Сохранить устойчивую persistent session между перезапусками.

### Что реализовано
1. Режимы ожидания страницы вынесены в конфиг и ускорены:
- `browser.navigationWaitUntil` (дефолт: `domcontentloaded`);
- `browser.snapshotWaitUntil` (дефолт: `domcontentloaded`);
- `browser.snapshotWaitTimeoutMs` (дефолт: `1500`).

2. Навигация в `BrowserRuntime` улучшена:
- `page.goto` теперь использует `waitUntil` из конфига вместо жесткого ожидания полного `load`;
- при timeout навигации действие считается успешным, если URL уже изменился (partial load fallback).

3. Snapshot стал мягче:
- вместо жесткого `waitForLoadState('load', 5000)` используется короткий soft-wait с конфигурируемым state/timeout.

4. Добавлено авто-подхватывание новой вкладки:
- `browser.adoptLatestPageOnNewTab` (дефолт: `true`);
- runtime переключает активную страницу на последний открытый tab и применяет таймауты к нему.

5. UX после `ask_user`/recovery-паузы:
- оркестратор сохраняет `pauseReason` (`manual` / `ask_user` / `recovery`) в статусе;
- при `ask_user` и recovery-паузе выводится явная подсказка о продолжении;
- в CLI пустой Enter автоматически делает resume для не-manual паузы;
- добавлена команда `/continue` как алиас `/resume`.

6. Документация обновлена:
- README дополнен разделами про persistent session, resume после ручных действий, и fast page loading behavior.

## 2026-02-16 — Logging Split: Compact Terminal + Detailed Debug File

### Задача
Сжать и упростить live-логи в терминале для удобного мониторинга, но сохранить полноценную отладочную информацию в файловом формате для анализа и диагностики.

### Что реализовано
1. Разделение payload в логгере:
- `monitorData` — компактный вывод в терминал;
- `debugData` — подробная запись в файл.

2. Расширен `LoggingConfig`:
- добавлен `logging.debugTextPath` (по умолчанию `logs/agent-debug.txt`);
- добавлен блок `logging.console` с лимитами компактного отображения:
  - `maxInlineValueLength`
  - `maxInlineArrayItems`
  - `maxInlineObjectKeys`
  - `maxInlineLineLength`

3. Переработан `ConsoleLogger` (`src/telemetry/consoleLogger.ts`):
- терминал теперь показывает одну компактную строку key-value вместо больших JSON-блоков;
- для каждого события сохраняется:
  - `logs/agent-events.jsonl` (структурировано),
  - `logs/agent-debug.txt` (человекочитаемый подробный debug с pretty JSON payload).

4. Переработаны payload в оркестраторе (`src/core/orchestrator.ts`):
- `observation`:
  - в терминал: URL, title, число элементов, top preview;
  - в debug: полный список извлечённых элементов и `textExcerpt` (если включён `showObservationDetails`).
- `context compression`:
  - в терминал: `selected/total` + top hints;
  - в debug: полный набор подсказок и метрик.
- `decision`:
  - в терминал: action/risk/confirmation/successCriteria;
  - в debug: full thought/reasoning/action payload.
- `action success/failure/recovery`:
  - в терминал: короткий статус;
  - в debug: расширенные аргументы и служебные данные.

5. Обновлены конфиг-схема и тестовый runtime config:
- `src/config/types.ts`
- `src/config/loadConfig.ts`
- `tests/unit/orchestrator.smoke.test.ts`

## 2026-02-16 — Legacy Request Path Restored (Z.AI via Claude Settings)

### Контекст
По запросу пользователя была проанализирована рабочая логика из старой версии агента (до перезапуска проекта).
Рабочий путь запросов к `z.ai` тогда использовал:
- `Anthropic`-совместимый API,
- `ANTHROPIC_AUTH_TOKEN` и `ANTHROPIC_BASE_URL`,
- автоподхват из `~/.claude/settings.json`.

### Что реализовано в текущей версии
1. Добавлен новый модельный провайдер: `anthropic_compatible`.
- Файл: `src/model/anthropicCompatibleClient.ts`
- Endpoint: `<baseUrl>/v1/messages`
- Заголовки: `x-api-key`, `anthropic-version`.

2. Добавлен резолвер кредов:
- Файл: `src/model/credentials.ts`
- Источники (по приоритету):
  - env (`MODEL_API_KEY` / `ANTHROPIC_AUTH_TOKEN`);
  - `~/.claude/settings.json` (`ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, default model).

3. Обновлен `ModelGateway`:
- Поддержка `MODEL_PROVIDER=anthropic_compatible`.

4. `model:check` расширен:
- Поддерживает `openai_compatible` и `anthropic_compatible`.
- Для `anthropic_compatible` использует ту же схему `v1/messages`.

5. Удалены временные `Cursor`-заголовки из openai-пути:
- Сохранён только стандартный протокол запроса.

6. Дефолтные параметры переключены на старый рабочий путь:
- `config/default.json`: `provider=anthropic_compatible`, `apiBaseUrl=https://api.z.ai/api/anthropic`.
- `.env.example` обновлен под этот режим.

## 2026-02-15 — Z.AI Coding Plan Compatibility Fix

### Проблема
`model:check` возвращал:
- `HTTP 429`
- `error.code=1113`
- `Insufficient balance or no resource package`

при использовании `MODEL_API_BASE_URL=https://api.z.ai/api/paas/v4`.

### Что изменено
1. Обновлен рекомендуемый endpoint для Coding Plan:
- `https://api.z.ai/api/coding/paas/v4` (OpenAI-compatible).

2. Обновлены дефолты и примеры:
- `config/default.json` -> `model.apiBaseUrl` теперь `https://api.z.ai/api/coding/paas/v4`.
- `.env.example` обновлен под coding endpoint.

3. Исправлена совместимость с ответами GLM:
- В `src/model/modelGateway.ts` добавлена нормализация `riskLevel`:
  - `low -> safe`
  - `medium/moderate -> sensitive`
  - `high/critical -> destructive`
  - и др. с безопасным fallback.
- Это устранило падение валидации схемы при ответах модели.

4. Security fix:
- Из `.env.example` удален реальный API-ключ (заменен на пустой placeholder).

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
