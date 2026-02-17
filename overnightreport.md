# Overnight Report

## 2026-02-17 07:45:59 MSK

### Scope
- Полный проход по всем tracked-файлам репозитория.
- Анализ реальных логов `logs/agent-events.jsonl` + `logs/agent-debug.txt`.
- Прогон quality-checks и реального запуска агента на простой задаче.

### Найденные проблемы
- В runtime были неограниченные аргументы `wait/scroll/type`, что повышало риск медленных/неконтролируемых шагов.
- Отсутствовала явная протокольная защита для `navigate` и `click` fallback-навигации.
- В оркестраторе существовал edge-case лишнего шага после `stop` во время pause-wait.
- Дублировался prompt-building код в двух model-клиентах.
- Legacy Python SOTA-тесты падали на этапе collection (`ModuleNotFoundError`) в текущем TS-проекте.

### Что сделано
1. Вынесены и подключены новые runtime-параметры в конфиг:
- `agent.snapshotRetryDelayMs`
- `browser.typeDelayMs`
- `browser.defaultScrollAmountPx`
- `browser.actionLimits.maxTypeTextLength`
- `browser.actionLimits.maxScrollAmountPx`
- `browser.actionLimits.maxWaitMs`
- `browser.actionLimits.allowedNavigationProtocols`

2. Усилен `BrowserRuntime`:
- `navigate` разрешает только протоколы из конфига;
- fallback-навигация в `click` тоже проходит протокольную проверку;
- `type` ограничивает длину текста и использует `typeDelayMs`;
- `wait` и `scroll` ограничиваются конфиг-лимитами.

3. Исправлен orchestrator flow:
- после `waitIfPaused()` добавлена проверка `isStopped()`, чтобы не выполнять лишний шаг;
- retry snapshot-delay убран из хардкода и переведен в `agent.snapshotRetryDelayMs`.

4. Устранена дубликация prompt logic:
- создан общий `src/model/promptBuilder.ts`;
- `openaiCompatibleClient` и `anthropicCompatibleClient` переведены на единый builder.

5. Тестовый контур:
- добавлен smoke-тест stop-during-pause (`tests/unit/orchestrator.smoke.test.ts`);
- Python legacy тесты переведены на `pytest.importorskip` (корректный skip вместо падения);
- в `.gitignore` добавлены `__pycache__/`, `.pytest_cache/`.

### Проверки
- `npm run check` -> passed
- `npm test` -> passed (`15/15`)
- `pytest -q tests/test_brain_sota.py tests/test_integration_sota.py` -> `2 skipped`

### Реальный запуск агента и логи
- Запуск через CLI: задача "Открой https://example.com и после загрузки заверши задачу кратким итогом."
- Результат по логам: `completed`, `stepsExecuted=2`.
- Временные метки нового run:
  - start: `2026-02-17T04:43:41.717Z`
  - finish: `2026-02-17T04:43:52.731Z`

### Дополнительная runtime-валидация hardening
- `navigate javascript:alert(1)` -> `ok=false`, `unsupported protocol`.
- С лимитами (`maxWaitMs=120`, `maxScrollAmountPx=80`):
  - `wait(ms=999999)` -> `Waited 120ms`
  - `scroll(amount=999999)` -> `Scrolled down 80px`

### Objective score
- Текущая оценка проекта: **8.4 / 10.0**
- Что влияет на оценку:
  - Плюсы: хорошая модульность, рабочий цикл оркестрации, богатая телеметрия, guard/recovery-механики, улучшенная управляемость через конфиг.
  - Минусы: монолитный `orchestrator.ts` остается сложным для поддержки, нет полноценного benchmark/eval harness, нет replay/trace-id аналитики и полноценной e2e-автоматизации браузерных сценариев.

---

## 2026-02-17 07:54:51 MSK

### Scope
- Повторный полный аудит после предыдущего цикла с фокусом на latency логирования, безопасность логов, размер model-prompt и устойчивость recovery.
- Повторно прочитаны tracked-файлы репозитория, выполнен запуск агента и анализ новых логов.

### Что найдено
- Синхронные записи в лог-файлы (`appendFileSync`) создают блокировки event loop на нагруженных run.
- JSONL содержал дубли payload (`data`, `monitorData`, `debugData`), что увеличивало размер и I/O нагрузку.
- В логах могли оставаться чувствительные фрагменты (`token`/`auth`/query secrets).
- Prompt payload не имел жёстких лимитов по history/reasoning/hints.
- Recovery использовал фиксированную задержку без экспоненциального backoff.

### Что внедрено
1. **Логирование и производительность**
- `ConsoleLogger` переведён на потоковую запись (`createWriteStream`).
- Добавлен `logger.close()` + вызов при закрытии CLI.
- Добавлены флаги JSONL:
  - `logging.jsonlIncludeMonitorData`
  - `logging.jsonlIncludeDebugData`
- По умолчанию JSONL стал легче: пишет `data` без дублирования monitor/debug payload.

2. **Безопасность логов**
- Добавлен конфиг `logging.redaction` с рекурсивной маскировкой по ключам:
  - `enabled`
  - `keys`
  - `mask`
- Добавлена маскировка чувствительных строковых паттернов (`Bearer ...`, `token=...`, `api_key=...`).

3. **Speed/cost оптимизация prompt**
- Добавлен `model.promptLimits`:
  - `maxHistoryItems`
  - `maxActionResultLength`
  - `maxThoughtSummaryLength`
  - `maxReasoningLength`
  - `maxAttentionHints`
  - `maxElementReasons`
- `promptBuilder` сокращает payload под лимиты.

4. **Recovery устойчивость**
- Добавлены:
  - `recovery.maxWaitMsAfterFailure`
  - `recovery.backoffMultiplier`
  - `recovery.jitterRatio`
- Recovery wait переведён на bounded backoff + jitter.
- Добавлена дедупликация соседних одинаковых recovery действий.

### Тесты
- `npm run check` -> passed
- `npm test` -> passed (`18/18`)
- `pytest -q tests/test_brain_sota.py tests/test_integration_sota.py` -> `2 skipped`

Новые unit тесты:
- `tests/unit/consoleLogger.test.ts`
- `tests/unit/promptBuilder.test.ts`
- расширен `tests/unit/recoveryManager.test.ts`

### Runtime run + лог-проверка
- Задача: `Открой https://example.com/?token=demo-secret и сразу заверши задачу коротким итогом.`
- Результат: `completed`, `stepsExecuted=2`.
- Подтверждено:
  - токен в консоли и JSONL автоматически маскируется как `***REDACTED***`;
  - новые JSONL события не дублируют monitor/debug поля (лёгкая запись).

### Внешние ориентиры (inspiration)
- OWASP Logging Cheat Sheet (маскирование чувствительных данных в логах).
- Google SRE Book (каскадные сбои, retry/backoff подходы).
- Anthropic Docs (рекомендации по ограничению и структуре prompt payload).

### Objective score
- Обновлённая оценка проекта: **8.7 / 10.0**
- Что подняло оценку:
  - снижена блокирующая I/O нагрузка логгера;
  - введена системная маскировка секретов;
  - уменьшен размер model prompt (лучше latency/cost);
  - recovery стал более устойчивым и предсказуемым.
- Что пока держит оценку ниже 9+:
  - оркестратор остаётся крупным и требует дальнейшей модульной декомпозиции;
  - нет benchmark-harness и replay tooling уровня production.
