# Эксплуатация, Telegram и мониторинг

## Нормальный режим

Владелец работает через web-admin. Raspberry Pi, MacBook и Windows-компьютер не обязаны быть включены после загрузки контента. Cloudflare cron запускается каждую минуту, выбирает due items, создаёт/poll-ит Meta containers и публикует готовые.

Ежедневно достаточно посмотреть:

- `/health` — D1 доступна и последний cron младше 3 минут;
- Telegram summary/critical alerts;
- `needs_attention`, `failed`, `publish_unknown` в админке;
- срок Meta token;
- Cloudflare Workers/D1/R2 Usage.

## Telegram

1. Создайте bot через официального `@BotFather`.
2. Отправьте bot любое сообщение из нужного личного чата или группы.
3. Получите numeric chat ID через Bot API `getUpdates` локально. Не публикуйте URL с bot token и удалите его из shell/browser history.
4. Запустите интерактивную загрузку secrets:

   ```powershell
   ./scripts/set-secrets.ps1 -Environment test -IncludeTelegram
   ```

5. В `workers/api/wrangler.toml` задайте `TELEGRAM_DAILY_HOUR_UTC` целым числом `0–23`. Алматы/Астана — UTC+5; например `15` означает 20:00 локального времени. Единственный Cron Trigger `* * * * *` читает эту переменную: в минуту `HH:00` он сначала отправляет date-deduplicated сводку и ставит daily maintenance в очередь, не ожидая завершения многошагового snapshot.

Telegram является каналом уведомлений, а не второй админкой. Команды изменения расписания остаются в web-admin/CLI с revision и idempotency checks.

## UptimeRobot

Создайте обычный HTTPS monitor:

```text
https://PUBLIC_HOST/health
```

Рекомендуемые настройки:

- interval: 5 минут на бесплатном плане;
- alert after: 1–2 failed checks для test, 1 для production;
- expected HTTP: 200;
- follow redirects: off;
- alert contacts: Telegram/email владельца.

Endpoint возвращает 503, если:

- D1 query не проходит;
- таблица `cron_runs` пуста;
- последний cron start старше 180 секунд;
- последний cron завершился `failed`;
- cron остаётся `running` дольше 90 секунд.

Response не содержит credentials или содержимое постов. Сразу после первого deploy endpoint может быть 503 до первого минутного trigger.

Не мониторьте защищённый `/api/v1/system/status` обычным публичным monitor и не вкладывайте agent/Access secrets в URL. Для глубокого synthetic check используйте `scripts/verify-deployment.mjs` в доверенном CI с secrets.

## Что делать по состояниям

| Состояние | Действие |
| --- | --- |
| `retry_wait`, `delayed` | проверить event и дождаться следующего backoff, если окно публикации ещё открыто |
| `needs_attention` | исправить media/text/token или явно reschedule/cancel |
| `failed` | проверить последнюю попытку и platform error; не нажимать publish-now циклически |
| `publish_unknown` | сначала проверить Instagram/Threads вручную; возможна уже опубликованная запись |
| `paused` | resume только после проверки текущей revision |

`publish_unknown` — защита от дублей при сетевом разрыве после Meta publish. Никогда не клонируйте и не публикуйте такой item вслепую.

## Первый тестовый прогон

1. Test Meta account, test D1/R2, один image на +15 минут.
2. Проверить staging/container/publish events и permalink.
3. Reel на +90 минут, чтобы увидеть раннее создание container.
4. Threads text.
5. Один carousel.
6. Pause/resume/reschedule с revision conflict test.
7. Оборвать большую загрузку и выполнить resume.
8. Временно отключить cron более чем на 3 минуты и убедиться, что `/health`/UptimeRobot сработал; затем включить обратно.
9. Проверить Telegram critical + daily summary.
10. Выполнить dry-run recovery.

Только после этого импортируйте три месяца расписания — сначала dry-run, затем небольшими batch.

## Обновление

```powershell
npm install
npm run check
node scripts/assert-configured.mjs --environment test
npm run db:migrate:test -w @publisher/api-worker
npm run deploy:test -w @publisher/api-worker
npm run deploy:test -w @publisher/public-worker
node scripts/verify-deployment.mjs --public-url https://TEST-PUBLIC-HOST --wait-seconds 180
```

После test soak повторите через ручной GitHub workflow для production. API всегда раньше Public из-за service binding.

## Cost guardrails

- Включите billing notifications в Cloudflare.
- Проверяйте Workers CPU errors; Free имеет малый CPU budget на request.
- Следите за R2 stored bytes, Class A/B operations и незавершёнными multipart uploads.
- Для предварительной оценки используйте `publisherctl storage-plan`: для R2 Standard бесплатный объём считается как 10 GB-month (`10_000_000_000` bytes), а превышение консервативно округляется вверх до billed GB по `$0.015/GB-month`. Free tier не относится к Infrequent Access. Это прогноз для постоянного объёма за полный месяц, а не обещание суммы счёта.
- Начальный application storage limit равен `10_000_000_000` bytes. В него входят уже сохранённые объекты, активные upload reservations и учитываемые backup snapshots; при достижении лимита API отклоняет новые загрузки до освобождения места или явного повышения лимита. Snapshot PUT сначала атомарно создаёт в D1 reservation intent вместе с увеличением счётчика; intent исчезает только в одной транзакции с привязкой shard/manifest. Поэтому обрыв на неоднозначной границе R2 PUT/HEAD возобновляется без повторной брони, а privacy cleanup удаляет intents порциями не более 50 объектов.
- Повысить лимит может только владелец через «Система → Медиа → Изменить лимит». Перед записью админка показывает оценку для случая, когда выбранный объём занят весь месяц, и требует отдельное подтверждение. Значение выше 10 GB означает согласие на возможную плату R2, но не является покупкой фиксированного тарифа и не гарантирует сумму счёта.
- Лимит никогда не повышается автоматически. Режима `unlimited` нет: всегда хранится конечный целочисленный `limit_bytes`, минимум 10 GB. Workers Paid также не включается этим действием.
- Если API отвечает `STORAGE_LIMIT_BELOW_USAGE`, сначала удалите или дедуплицируйте готовые медиа; нельзя опустить лимит ниже уже учтённого объёма. После изменения проверьте `used_bytes`, `remaining_bytes`, `over_limit` и прогноз стоимости в системной карточке.
- Не включайте invocation logs или traces Public Worker: Meta OAuth передаёт одноразовые `code`/`state` в callback query string. В versioned Wrangler config они явно отключены; для наблюдаемости используйте агрегированные Worker metrics и `/health` без query-секретов.
- Не сокращайте cron ниже минуты и не делайте один trigger «обходом всей базы».
- Подготовку видео выполняйте локально; FFmpeg никогда не должен запускаться в Worker.
- При CPU-limit сначала уменьшайте chunks/объём работы и профилируйте. Затем Pi 5 допустим как бесплатный scheduler fallback с Cloudflare/R2. Workers Paid включается только после отдельного согласия владельца, никогда автоматически.

Квоты и цены меняются; перед production сверяйте текущие страницы Cloudflare Workers, D1 и R2 pricing/limits.
