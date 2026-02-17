# CONTEXT

## 2026-02-17 — Navigation policy hardening + retry backoff/jitter + slow-step observability

### Что было найдено
- В конфиге уже появились новые параметры retry/navigation, но часть из них не была реально подключена в runtime-логике.
- `navigate`/`click` fallback проверяли только протокол, без host-level ограничений (private IP/localhost/metadata-hosts).
- Повторы `modelGateway.decide()` шли без управляемой паузы между попытками.
- Не было явного warn-сигнала о медленных шагах (когда шаг сильно дольше нормы).

### Что реализовано
1. Навигационная policy в runtime:
- добавлен `src/browser/navigationPolicy.ts` с централизованной проверкой URL:
  - protocol allow-list (`allowedNavigationProtocols`);
  - host deny-list (`blockedHostPatterns`);
  - блок private network hosts/IP (с флагом `allowPrivateNetworkHosts`).
- `BrowserRuntime` переведен на `resolveSafeNavigationUrl`:
  - `navigate` возвращает точную причину отказа (`invalid URL`, `unsupported protocol`, `blocked host`, `private host/IP`);
  - `click` fallback-to-href теперь тоже проходит policy и не делает небезопасный переход.

2. Retry устойчивость в оркестраторе:
- в `makeDecisionWithRetry` добавлены bounded exponential backoff + jitter:
  - `agent.decisionRetryBaseDelayMs`
  - `agent.decisionRetryBackoffMultiplier`
  - `agent.decisionRetryJitterRatio`
  - `agent.maxDecisionRetryDelayMs`
- лог retry теперь показывает `retryDelayMs` между попытками.

3. Observability производительности:
- добавлен `agent.slowStepWarnMs`;
- если шаг длится дольше порога, оркестратор пишет `STEP N: медленный шаг` с `elapsedMs`, `thresholdMs`, `outcome`.

4. Конфиг/типы/схема:
- новые поля добавлены в:
  - `config/default.json`
  - `src/config/types.ts`
  - `src/config/loadConfig.ts`
- smoke test-конфиг синхронизирован с новыми обязательными полями.

5. Тесты:
- добавлен `tests/unit/navigationPolicy.test.ts` (4 кейса: relative URL, protocol block, host/private block, allow private by config).
- обновлен `tests/unit/orchestrator.smoke.test.ts` под расширенный runtime config.

### Валидация
- `npm run check` — passed.
- `npm test` — passed (`24/24`).
- `pytest -q tests/test_brain_sota.py tests/test_integration_sota.py` — `2 skipped` (pytest code 5 из-за полного skip-набора, ожидаемо для legacy python smoke).

### Live-run для проверки
Run: `2026-02-17T05:13:14.178Z` -> `2026-02-17T05:13:21.245Z`, `runId=76373ce1-0f18-432b-b760-e194f54ea87a`

Задача: `Открой https://example.com и заверши задачу одной короткой фразой.`

Подтверждено в логах:
- старт содержит `runId` + `maxRunMs`;
- run завершен со статусом `completed`, `stepsExecuted=2`;
- есть финальная запись `Метрики выполнения` (`elapsedMs=7067`, `avgStepMs=3534`).

## 2026-02-17 — Model circuit breaker + run timeout budget + run metrics

### Что было найдено
- `ModelGateway` не имел circuit-breaker логики: при повторных падениях primary провайдера происходили одинаковые дорогостоящие ретраи на каждом шаге.
- В оркестраторе отсутствовал time-budget на весь run (был только `maxSteps`), что не ограничивало долгие сценарии с медленными шагами.
- В логе не было стабильной run-корреляции (`runId`) и агрегированных run-метрик (elapsed/avg step), что усложняло анализ производительности.

### Что реализовано
1. Model circuit breaker:
- `model.circuitBreaker.enabled`
- `model.circuitBreaker.failureThreshold`
- `model.circuitBreaker.cooldownMs`
- `model.circuitBreaker.tripOnTransientOnly`

Реализация в `ModelGateway`:
- добавлен счетчик последовательных ошибок primary;
- при достижении threshold открывается circuit на cooldown;
- пока circuit открыт, primary пропускается и используется fallback-путь (в рамках существующей fallback-policy);
- после окончания cooldown состояние breaker сбрасывается;
- `ModelGateway` получил optional `client overrides` для unit-тестов.

2. Run timeout budget:
- `agent.maxRunMs` добавлен в конфиг;
- оркестратор проверяет elapsed runtime на каждом шаге и завершает run с понятной причиной при превышении бюджета.

3. Run correlation + метрики:
- для каждого run генерируется `runId`;
- `runId` добавлен в start/final result/status;
- в финале пишется отдельный статус `Метрики выполнения`:
  - `elapsedMs`
  - `stepsExecuted`
  - `avgStepMs`.

4. Типы результата/статуса:
- `AgentTaskResult` расширен полями `runId`, `elapsedMs`;
- `OrchestratorStatus` расширен полем `runId`.

### Тесты
- Новый: `tests/unit/modelGateway.test.ts`
  - breaker opens + skip primary during cooldown;
  - сохранение поведения `fallbackMode=non_transient_only` для transient ошибок.
- Обновлен: `tests/unit/orchestrator.smoke.test.ts` (новые config поля).

### Валидация
- `npm run check` — passed.
- `npm test` — passed (`20/20`).
- `pytest -q tests/test_brain_sota.py tests/test_integration_sota.py` — `2 skipped`.

### Реальный run для проверки
Run: `2026-02-17T05:02:38.172Z` -> `2026-02-17T05:02:44.909Z`, задача:
`Открой https://example.com и заверши задачу одной короткой фразой.`

Подтверждено в логах:
- старт содержит `runId` и `maxRunMs`;
- итоговый статус содержит `runId`/`elapsedMs`;
- отдельной записью логируются `Метрики выполнения`.

## 2026-02-17 — Logging redaction + lightweight JSONL + prompt limits + recovery backoff

### Что было найдено
- `ConsoleLogger` писал в файлы синхронно (`appendFileSync`) на каждом событии, что увеличивало latency и блокировало event loop при длинных snapshot/debug payload.
- JSONL-документ дублировал payload (`data` + `monitorData` + `debugData`), из-за чего файлы быстро разрастались.
- В логах присутствовали значения query-параметров вида `token=...`, что рискованно для безопасности.
- Prompt для модели тащил полный history/hints/reasons без явных hard-limits на payload.
- Recovery использовал фиксированную паузу без backoff/jitter и мог генерировать дублирующиеся recovery-операции.

### Что реализовано
1. Logging runtime оптимизирован:
- `ConsoleLogger` переведен на потоковую запись (`createWriteStream`) вместо `appendFileSync`;
- добавлен `logger.close()` и вызов при закрытии CLI.

2. JSONL размер и структура:
- добавлены флаги:
  - `logging.jsonlIncludeMonitorData`
  - `logging.jsonlIncludeDebugData`
- по умолчанию в JSONL хранится `data` без дублирующих полей monitor/debug.

3. Security redaction для логов:
- новый блок `logging.redaction`:
  - `enabled`
  - `keys`
  - `mask`
- redaction применяется рекурсивно к monitor/debug payload и к строкам (включая `Bearer ...`, `token=...`, `api_key=...`).

4. Prompt payload limits:
- добавлен `model.promptLimits.*`:
  - `maxHistoryItems`
  - `maxActionResultLength`
  - `maxThoughtSummaryLength`
  - `maxReasoningLength`
  - `maxAttentionHints`
  - `maxElementReasons`
- `promptBuilder` теперь ограничивает объем history/hints/reasons и сокращает длинные поля.

5. Recovery backoff:
- добавлены:
  - `recovery.maxWaitMsAfterFailure`
  - `recovery.backoffMultiplier`
  - `recovery.jitterRatio`
- wait в recovery теперь считается по bounded backoff;
- добавлена дедупликация соседних одинаковых recovery-действий.

### Валидация
- `npm run check` — passed.
- `npm test` — passed (`18/18`).
- `pytest -q tests/test_brain_sota.py tests/test_integration_sota.py` — `2 skipped`.

### Проверка на реальном run
Run: `2026-02-17T04:52:50.504Z` -> `2026-02-17T04:52:58.910Z`, задача:
`Открой https://example.com/?token=demo-secret и сразу заверши задачу коротким итогом.`

Результат:
- `completed`, `stepsExecuted=2`.
- В консоли и JSONL `token` автоматически замаскирован (`***REDACTED***`).
- Новые записи JSONL идут без `monitorData/debugData` (облегченный формат).

### Новые/измененные тесты
- `tests/unit/consoleLogger.test.ts` — redaction + compact JSONL shape.
- `tests/unit/promptBuilder.test.ts` — prompt limits.
- `tests/unit/recoveryManager.test.ts` — bounded backoff + dedupe.
- `tests/unit/orchestrator.smoke.test.ts` — runtime config обновлен под новые поля.

## 2026-02-17 — Runtime hardening + config-driven action limits + prompt dedup

### Что было найдено
- В `browserRuntime` оставались магические параметры и неограниченные аргументы действий (`wait`, `scroll`, `type`), что влияло на предсказуемость, скорость и безопасность.
- `navigate` не ограничивал протоколы URL, а fallback-навигация из `click` могла увести на нежелательные схемы.
- В оркестраторе был edge-case: после выхода из `waitIfPaused()` по `stop` мог выполняться лишний шаг.
- Prompt-builder был продублирован в `openai_compatible` и `anthropic_compatible` клиентах.
- Legacy Python SOTA-тесты падали на этапе collection в текущем TypeScript-репозитории (`ModuleNotFoundError`).

### Что реализовано
1. Конфигурируемые runtime-лимиты и тайминги:
- `agent.snapshotRetryDelayMs`;
- `browser.typeDelayMs`;
- `browser.defaultScrollAmountPx`;
- `browser.actionLimits.maxTypeTextLength`;
- `browser.actionLimits.maxScrollAmountPx`;
- `browser.actionLimits.maxWaitMs`;
- `browser.actionLimits.allowedNavigationProtocols`.

2. Hardening browser actions:
- `navigate` валидирует URL по разрешенным протоколам (по умолчанию только `http:`/`https:`).
- fallback-навигация после timeout в `click` также проходит протокольную валидацию.
- `type` ограничивает длину текста по конфигу и использует `typeDelayMs` из конфига.
- `wait` и `scroll` теперь ограничиваются верхними лимитами из конфига.

3. Оркестратор:
- добавлена повторная проверка `isStopped()` сразу после `waitIfPaused()` (устранен лишний шаг после stop);
- retry-задержка повторного snapshot вынесена в `agent.snapshotRetryDelayMs`.

4. Консистентность model-layer:
- общий prompt-builder вынесен в `src/model/promptBuilder.ts`;
- `openaiCompatibleClient` и `anthropicCompatibleClient` используют единый builder.

5. Тестовый контур:
- добавлен smoke-тест на корректный stop во время pause (`orchestrator.smoke.test.ts`);
- Python legacy тесты переведены на корректный `importorskip`, чтобы не ломать collection в TS-проекте;
- `.gitignore` дополнен `__pycache__/` и `.pytest_cache/`.

### Проверки и верификация
- `npm run check` — passed.
- `npm test` — passed (`15/15`).
- `pytest -q tests/test_brain_sota.py tests/test_integration_sota.py` — `2 skipped` (вместо падения collection).
- Реальный запуск агента: `2026-02-17T04:43:41Z` -> `2026-02-17T04:43:52Z`:
  - задача: открыть `https://example.com` и завершить;
  - результат: `completed`, `stepsExecuted=2`, корректный `finish summary` в логах.
- Точечная проверка runtime hardening:
  - `navigate javascript:alert(1)` -> `ok=false`, `unsupported protocol`;
  - `wait(ms=999999)` при `maxWaitMs=120` -> фактически `Waited 120ms`;
  - `scroll(amount=999999)` при `maxScrollAmountPx=80` -> фактически `Scrolled down 80px`.

### Измененные файлы
- `.gitignore`
- `config/default.json`
- `src/browser/browserRuntime.ts`
- `src/config/loadConfig.ts`
- `src/config/types.ts`
- `src/core/orchestrator.ts`
- `src/model/promptBuilder.ts`
- `src/model/openaiCompatibleClient.ts`
- `src/model/anthropicCompatibleClient.ts`
- `tests/unit/orchestrator.smoke.test.ts`
- `tests/test_brain_sota.py`
- `tests/test_integration_sota.py`
- `README.md`

## 2026-02-17 — Анализ последнего run (18 шагов) + fixes против oscillation

### Что было в логе (run от `2026-02-16T22:48:11.363Z`)
- 18 шагов, процесс оборван пользователем (`Ctrl-C`), штатного `finish` не было.
- Действия: `navigate x4`, `click x13`, `type x1`.
- Наблюдалась oscillation-петля между страницами `hh.ru main` и `applicant/resumes`.
- Ошибка шага 16: `Unknown elementId: a11y-search-input` (модель передала `domId`, а runtime ждал только `e-*`).
- В шагах присутствовали нелогичные клики по элементам из header и кнопке поднятия резюме вместо прогресса по задаче.

### Корневые причины
1. Runtime не умел резолвить `domId` и использовал хрупкий селектор как основной путь.
2. Контекст недостаточно различал main-контент и навигационный шум header/footer/nav.
3. Не было guard для oscillation между двумя URL (свич туда-сюда без прогресса).

### Что реализовано
1. Snapshot/DOM метаданные расширены:
- `domId`, `region`, `rawHref` добавлены в элемент.

2. Browser runtime locator strategy усилена:
- `click/type` теперь принимают и `e-*`, и `domId`;
- многоступенчатый resolver локатора:
  - `[id=...]`
  - `a[href=...]`
  - `input[name=...][type=...]`
  - `placeholder/aria`
  - fallback на структурный selector.

3. Orchestrator guard-пакет расширен:
- нормализация reference: если модель дала `domId`, он мапится на `e-*`;
- для `type` с неизвестным target — fallback на лучший доступный text-editable элемент;
- oscillation guard:
  - детект чередования URL в последних шагах;
  - если новое действие ведет в ту же oscillation-зону, шаг переписывается в `navigate` по breakout-ссылке (приоритет main-контента).

4. Context scoring улучшен:
- добавлены штрафы:
  - `nonMainRegionPenalty` (header/footer/nav),
  - `repeatedRecentUsePenalty`,
  - `recentlyFailedPenalty`;
- снижен бонус `recentlyUsedBonus`.

5. Prompt policy усилена:
- прямое требование использовать `e-*`/`domId` из snapshot и избегать циклов через header/footer/nav при oscillation.

### Измененные файлы
- `src/browser/browserRuntime.ts`
- `src/core/orchestrator.ts`
- `src/context/contextEngine.ts`
- `src/core/types.ts`
- `src/model/openaiCompatibleClient.ts`
- `src/model/anthropicCompatibleClient.ts`
- `src/config/types.ts`
- `src/config/loadConfig.ts`
- `config/default.json`
- `tests/unit/contextEngine.test.ts`
- `tests/unit/orchestrator.smoke.test.ts`
- `README.md`

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
