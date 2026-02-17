# Personal Browser Agent

Личный автономный агент для управления браузером в реальном времени:
- видимый браузер (`Playwright`, non-headless),
- pause/resume/stop во время выполнения,
- safety-confirmation для рискованных шагов,
- цветные компактные live-логи для управления агентом в реальном времени,
- подробные debug-логи в файл (`txt`) и структурированный аудит в `jsonl`.

## Что уже реализовано

1. Оркестратор шагов `observe -> decide -> act -> verify`.
2. Управление с консоли:
   - `/run <задача>`
   - `/pause`
   - `/resume`
   - `/continue` (алиас для `/resume`)
   - `/stop`
   - `/approve`
   - `/deny`
   - `/status`
   - `/help`
   - `/exit`
3. Механизм подтверждения перед рискованными действиями.
4. Цветная телеметрия по типам событий:
   - компактный мониторинговый поток в терминале;
   - подробный debug-поток в `logs/agent-debug.txt`;
   - структурированный аудит в `logs/agent-events.jsonl`.
5. Поддержка `persistent session` через `.browser-profile` (логины/куки сохраняются между перезапусками агента при том же `userDataDir`).
6. Подключаемый model-gateway:
   - `openai_compatible`
   - `rule_based` fallback
7. Context-engine:
   - ранжирование элементов по релевантности задаче,
   - сжатый контекст для модели,
   - attention hints и метрики компрессии.
8. Sub-agent routing:
   - роли `Navigator`, `Extractor`, `Action`, `Verifier`,
   - автоматический выбор роли на каждом шаге,
   - ролевая инструкция передается в prompt модели.
9. Recovery-стратегии:
   - авто-восстановление после ошибок (wait/retry/escape/scroll),
   - ограничение по серии неудач,
   - автоматическая безопасная пауза при повторных сбоях.
10. Анти-циклические guard-механизмы:
   - защита от `type` в не-текстовые input (checkbox/radio и т.д.),
   - авто-переписывание повторных `click` в `navigate` по `href`,
   - разрыв длинных серий одинакового `scroll` через `Home/End`,
   - нормализация `wait.duration -> wait.ms`.
11. Улучшенный snapshot:
   - элементы ограничиваются viewport-областью (по конфигу),
   - в контекст добавляются `inputType`, `name`, `domId`, `region`, `rawHref`, `inViewport`,
   - для input извлекается текст label, если у элемента нет собственного текста.
12. Компактный reasoning в консоли:
   - отдельный `status`-digest по шагу: `action + why + target + thought`,
   - режим `on_change`, чтобы не спамить одинаковыми решениями,
   - напоминание о повторяющемся плане через заданный интервал.
13. Устойчивость к зацикливанию и ложным кликам:
   - element resolver поддерживает `e-*` и `domId`;
   - многоступенчатый поиск локатора (id/href/name/placeholder/aria/text + fallback selector);
   - guard распознает oscillation между одними и теми же URL и переводит шаг в breakout-навигацию по ссылке из main-контента;
   - context ranking штрафует header/footer/nav элементы и повторные/падавшие недавно targets.
14. Безопасность и стабильность навигации/решений:
   - central navigation policy блокирует небезопасные URL (private hosts/IP и запрещенные host-patterns);
   - decision retry использует bounded exponential backoff + jitter;
   - non-transient ошибки модели могут завершать retry-цикл сразу (fail-fast), чтобы не тратить лишнее время;
   - long-running шаги помечаются warning-событиями как `медленный шаг`.
15. Консистентность retry-механик:
   - расчет backoff/jitter вынесен в общий модуль и одинаково используется в decision-retry и recovery;
   - bounded поведение задержек унифицировано между подсистемами.
16. Ротация логов:
   - JSONL и debug-log автоматически ротируются по размеру;
   - архивы ограничиваются заданным числом файлов для контроля дискового роста.

## Быстрый старт

```bash
npm install
npx playwright install chromium
cp .env.example .env
npm run dev
```

Проверка качества:

```bash
npm run check
npm test
```

## Конфигурация

Все основные параметры вынесены в `config/default.json`:
- лимиты шагов,
- таймауты,
- промпты,
- safety-политики,
- формат логирования,
- модельный провайдер.

Логирование:
- терминал: компактный мониторинг без DOM-«простыней»;
- `logs/agent-debug.txt`: подробный текстовый debug-трейс с расширенными payload;
- `logs/agent-events.jsonl`: структурированные события для программного анализа.
- запись в файлы идет в реальном времени (append на каждое событие), а не в конце задачи.
- JSONL может быть облегчен по размеру (без дублирующих monitor/debug полей) через конфиг.

Пути и лимиты компактного вывода настраиваются в `logging`:
- `jsonlPath`
- `debugTextPath`
- `jsonlIncludeMonitorData`
- `jsonlIncludeDebugData`
- `rotation.enabled`
- `rotation.maxFileSizeBytes`
- `rotation.maxArchiveFiles`
- `redaction.enabled`
- `redaction.keys`
- `redaction.mask`
- `console.visibleLevels`
- `console.maxInlineValueLength`
- `console.maxInlineArrayItems`
- `console.maxInlineObjectKeys`
- `console.maxInlineLineLength`
- `console.neverTruncateKeys`
- `console.actionStartLogActions`
- `console.decisionDigest.enabled`
- `console.decisionDigest.mode`
- `console.decisionDigest.repeatReminderEvery`
- `console.decisionDigest.thoughtMaxLength`
- `console.decisionDigest.reasoningMaxLength`
- `console.decisionDigest.successCriteriaMaxLength`

Анти-циклические guard-параметры:
- `agent.maxRunMs`
- `agent.decisionRetryBaseDelayMs`
- `agent.decisionRetryBackoffMultiplier`
- `agent.decisionRetryJitterRatio`
- `agent.maxDecisionRetryDelayMs`
- `agent.retryOnNonTransientDecisionErrors`
- `agent.slowStepWarnMs`
- `agent.guards.enabled`
- `agent.guards.recentActionWindow`
- `agent.guards.maxRepeatedActionBeforeRewrite`
- `agent.guards.maxRepeatedScrollBeforeHotkey`
- `agent.guards.scrollBreakKeyUp`
- `agent.guards.scrollBreakKeyDown`
- `agent.snapshotRetryDelayMs`

Browser/runtime устойчивость:
- `browser.clickFallbackToHrefOnTimeout`
- `browser.typeActionAllowedInputTypes`
- `browser.typeDelayMs`
- `browser.defaultScrollAmountPx`
- `browser.actionLimits.maxTypeTextLength`
- `browser.actionLimits.maxScrollAmountPx`
- `browser.actionLimits.maxWaitMs`
- `browser.actionLimits.allowedNavigationProtocols`
- `browser.actionLimits.blockedHostPatterns`
- `browser.actionLimits.allowPrivateNetworkHosts`
- `browser.snapshot.onlyViewportElements`
- `browser.snapshot.viewportMarginPx`

Model fallback поведение:
- `model.fallbackMode`: `always` / `non_transient_only` / `never`
- `model.transientErrorKeywords`
- `model.circuitBreaker.enabled`
- `model.circuitBreaker.failureThreshold`
- `model.circuitBreaker.cooldownMs`
- `model.circuitBreaker.tripOnTransientOnly`

Model prompt-limits (token/cost/latency control):
- `model.promptLimits.maxHistoryItems`
- `model.promptLimits.maxActionResultLength`
- `model.promptLimits.maxThoughtSummaryLength`
- `model.promptLimits.maxReasoningLength`
- `model.promptLimits.maxAttentionHints`
- `model.promptLimits.maxElementReasons`

Context anti-loop:
- `context.nonTextInputTypes`
- `context.loopHints.*`
- `context.scoreWeights.nonTextInputPenalty`
- `context.scoreWeights.lowSignalElementPenalty`

Recovery backoff:
- `recovery.waitMsAfterFailure`
- `recovery.maxWaitMsAfterFailure`
- `recovery.backoffMultiplier`
- `recovery.jitterRatio`

Run-level observability:
- `runId` генерируется для каждой задачи и выводится в start/final logs;
- в конце run логируются агрегированные метрики: `elapsedMs`, `stepsExecuted`, `avgStepMs`.

Переменные окружения:

```env
MODEL_API_KEY=
MODEL_API_BASE_URL=https://api.z.ai/api/anthropic
MODEL_NAME=glm-4.7
MODEL_PROVIDER=anthropic_compatible
```

Если `MODEL_PROVIDER=rule_based`, агент работает без API-ключа (ограниченный fallback-режим).

Рекомендуемый режим для `GLM Coding Lite-Yearly Plan`:
- `MODEL_PROVIDER=anthropic_compatible`
- `MODEL_API_BASE_URL=https://api.z.ai/api/anthropic`
- токен можно не хранить в `.env`, если он уже есть в `~/.claude/settings.json` как `ANTHROPIC_AUTH_TOKEN`.

Дополнительно доступен `openai_compatible` режим через endpoint `https://api.z.ai/api/coding/paas/v4`.

Проверка подключения к модели:

```bash
npm run model:check
```

Команда отправляет тестовый запрос в зависимости от `MODEL_PROVIDER`:
- `openai_compatible` -> `chat/completions`
- `anthropic_compatible` -> `v1/messages`

## Как использовать паузу

1. Запусти задачу: `/run ...`.
2. В любой момент введи `/pause`.
3. Выполни нужные ручные действия в браузере.
4. Введи `/resume` и агент продолжит с текущего состояния страницы.

Если агент сам попросил ручной шаг (`ask_user` / recovery-пауза):
- выполни действие в браузере;
- нажми `Enter` в терминале (или `/resume`, `/continue`) для продолжения.

## Загрузка Страниц

Чтобы агент не ждал полную загрузку тяжелых страниц:
- навигация использует `browser.navigationWaitUntil` (по умолчанию `domcontentloaded`);
- snapshots используют короткий soft-wait `browser.snapshotWaitUntil` + `browser.snapshotWaitTimeoutMs`;
- можно включить `browser.adoptLatestPageOnNewTab`, чтобы агент автоматически продолжал работу в новой вкладке.

## Структура проекта

- `src/index.ts` — bootstrap.
- `src/cli/repl.ts` — интерактивная консоль.
- `src/core/orchestrator.ts` — цикл агента и контроль статуса.
- `src/core/pauseController.ts` — pause/resume/stop.
- `src/core/approvalGate.ts` — подтверждение рискованных действий.
- `src/browser/browserRuntime.ts` — Playwright runtime + snapshot страницы.
- `src/model/*` — модельные адаптеры.
- `src/tools/toolRegistry.ts` — выполнение действий агента.
- `src/telemetry/consoleLogger.ts` — цветной логгер (compact monitor + debug file + JSONL).
- `config/default.json` — все параметры.

## Ограничения текущей версии

1. Для production-качества нужно усилить стратегию извлечения DOM и ранжирования элементов.
2. Для `openai_compatible` нужен совместимый endpoint `/chat/completions`, для `anthropic_compatible` — `/v1/messages`.
3. Есть fallback-режим, но он не заменяет полноценное reasoning-ядро модели.
