# Personal Browser Agent

Личный автономный агент для управления браузером в реальном времени:
- видимый браузер (`Playwright`, non-headless),
- pause/resume/stop во время выполнения,
- safety-confirmation для рискованных шагов,
- цветные live-логи решений, действий и наблюдений,
- JSONL-аудит всех шагов.

## Что уже реализовано

1. Оркестратор шагов `observe -> decide -> act -> verify`.
2. Управление с консоли:
   - `/run <задача>`
   - `/pause`
   - `/resume`
   - `/stop`
   - `/approve`
   - `/deny`
   - `/status`
   - `/help`
   - `/exit`
3. Механизм подтверждения перед рискованными действиями.
4. Цветная телеметрия по типам событий и параллельная запись в `logs/agent-events.jsonl`.
5. Поддержка `persistent session` через `.browser-profile`.
6. Подключаемый model-gateway:
   - `openai_compatible`
   - `rule_based` fallback
7. Context-engine:
   - ранжирование элементов по релевантности задаче,
   - сжатый контекст для модели,
   - attention hints и метрики компрессии.

## Быстрый старт

```bash
npm install
npx playwright install chromium
cp .env.example .env
npm run dev
```

## Конфигурация

Все основные параметры вынесены в `config/default.json`:
- лимиты шагов,
- таймауты,
- промпты,
- safety-политики,
- формат логирования,
- модельный провайдер.

Переменные окружения:

```env
MODEL_API_KEY=
MODEL_API_BASE_URL=
MODEL_NAME=glm-4.7
MODEL_PROVIDER=openai_compatible
```

Если `MODEL_PROVIDER=rule_based`, агент работает без API-ключа (ограниченный fallback-режим).

## Как использовать паузу

1. Запусти задачу: `/run ...`.
2. В любой момент введи `/pause`.
3. Выполни нужные ручные действия в браузере.
4. Введи `/resume` и агент продолжит с текущего состояния страницы.

## Структура проекта

- `src/index.ts` — bootstrap.
- `src/cli/repl.ts` — интерактивная консоль.
- `src/core/orchestrator.ts` — цикл агента и контроль статуса.
- `src/core/pauseController.ts` — pause/resume/stop.
- `src/core/approvalGate.ts` — подтверждение рискованных действий.
- `src/browser/browserRuntime.ts` — Playwright runtime + snapshot страницы.
- `src/model/*` — модельные адаптеры.
- `src/tools/toolRegistry.ts` — выполнение действий агента.
- `src/telemetry/consoleLogger.ts` — цветной логгер + JSONL аудит.
- `config/default.json` — все параметры.

## Ограничения текущей версии

1. Для production-качества нужно усилить стратегию извлечения DOM и ранжирования элементов.
2. `openai_compatible` ожидает совместимый endpoint `/chat/completions`.
3. Есть fallback-режим, но он не заменяет полноценное reasoning-ядро модели.
