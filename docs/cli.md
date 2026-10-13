# `publisherctl`

CLI предназначен и для человека, и для будущего Codex/agent workflow. Все writes получают `Idempotency-Key`; опасные изменения существующей записи требуют актуальную revision.

## Запуск

```powershell
npm run build -w @publisher/cli
npm run publisherctl -- help
```

Для FFmpeg-команд установите `ffmpeg` и `ffprobe` в `PATH` либо укажите `--ffmpeg` / `--ffprobe`. Рабочий upload-профиль проекта: JPEG/PNG для изображений и MP4 (`video/mp4`) для видео. MOV может быть входом `prepare`, но не загружается напрямую.

## Профиль и два токена

Application token — `pub_...`, созданный после D1 migration. Если API закрыт Access, дополнительно нужны service-token credentials:

```powershell
$env:PUBLISHER_API_TOKEN = "pub_..."
$env:CF_ACCESS_CLIENT_ID = "...access"
$env:CF_ACCESS_CLIENT_SECRET = "..."
npm run publisherctl -- auth login `
  --profile test `
  --api-url https://YOUR-API-HOST
```

Можно указать `--cf-access-client-id`; secret CLI запросит скрыто. Для CI и общей машины используйте environment и `--no-store`. Не передавайте secrets флагами: command line может сохраниться в history/process list.

```powershell
npm run publisherctl -- config show
npm run publisherctl -- status --profile test --json
```

`config show` показывает только факт наличия credentials. `auth logout` удаляет Bearer token из профиля, не удаляя Access pair.

## Обязательный media workflow

### 1. Prepare

Reel 9:16 с полями:

```powershell
npm run publisherctl -- prepare .\raw.mov `
  --output .\ready.mp4 `
  --kind reel `
  --fit contain
```

`contain` не обрезает кадр и добавляет поля. `cover` заполняет 1080×1920 через crop. Без `--force` существующий output не перезаписывается.

### 2. Validate

```powershell
npm run publisherctl -- validate .\ready.mp4 `
  --kind reel `
  --platform instagram `
  --json
```

Ошибки дают ненулевой exit code. Warning (например, aspect recommendation) не блокирует сам по себе, но должен быть просмотрен.

### 3. Upload

```powershell
npm run publisherctl -- upload .\ready.mp4 `
  --kind video `
  --content-type video/mp4 `
  --concurrency 3 `
  --json
```

Upload автоматически запускает FFprobe и отправляет API `width`, `height`, `duration_ms`, `fps`,
`video_codec`, `audio_codec`, `video_bitrate_bps`, `audio_bitrate_bps`,
`audio_sample_rate_hz`, size и SHA-256. API повторно проверяет эти метаданные перед
привязкой файла к публикации: отсутствие обязательного bitrate/FPS/размера считается
ошибкой, а не поводом «попробовать загрузить как есть».

- до 64 MiB: presigned PUT прямо в R2;
- больше 64 MiB: multipart прямо в R2;
- API выдаёт только временные credentials, ограниченные одним object key;
- multipart concurrency разрешена только от 1 до 4 (`3` по умолчанию);
- resume-файл создаётся рядом с media как `*.publisher-upload.json` и удаляется после complete.

Если сеть оборвалась:

```powershell
npm run publisherctl -- upload resume --state .\ready.mp4.publisher-upload.json
```

Для отказа и очистки incomplete multipart:

```powershell
npm run publisherctl -- upload abort --state .\ready.mp4.publisher-upload.json
```

Не редактируйте resume JSON и не меняйте исходный файл: CLI сравнивает size/mtime и откажется от небезопасного resume.

## Manifest

Минимальный пример:

```json
{
  "version": 1,
  "items": [
    {
      "external_id": "ig-2026-09-01-reel",
      "account_id": "IG_ACCOUNT_UUID",
      "platform": "instagram",
      "format": "reel",
      "scheduled_at": "2026-09-01T09:00:00+05:00",
      "text": "Как проверить скорость сайта до запуска",
      "media_ids": ["MEDIA_UUID_FROM_UPLOAD"],
      "share_to_feed": true,
      "late_policy": "publish_within_window",
      "late_window_minutes": 240,
      "enabled": true
    },
    {
      "external_id": "threads-2026-09-01-tip",
      "account_id": "THREADS_ACCOUNT_UUID",
      "platform": "threads",
      "format": "text",
      "scheduled_at": "2026-09-01T10:30:00+05:00",
      "text": "Три вопроса, которые стоит задать до заказа сайта.",
      "topic_tag": "веб-разработка",
      "enabled": true
    }
  ]
}
```

Правила:

- `external_id` стабилен между повторными sync и уникален внутри platform;
- timestamp обязательно содержит `Z` или offset (`+05:00` для Алматы/Астаны);
- `reel`, `image`, `video` требуют ровно один media ID;
- Instagram carousel: 2–10; Threads carousel: 2–20;
- media IDs внутри одного item должны быть уникальны;
- Threads text-only требует непустой text и не содержит media;
- Threads text ограничен 500 символами, Instagram caption — 2200;
- Instagram text-only отклоняется;
- `alt_texts` не может быть длиннее `media_ids`.
- `location_id`, если задан, — числовой ID локации Meta, а не название города.

Проверка:

```powershell
npm run publisherctl -- validate .\content.json --manifest --json
```

Dry-run upsert (ничего не пишет):

```powershell
npm run publisherctl -- bulk-upsert .\content.json --json
```

Применение после просмотра diff/result:

```powershell
npm run publisherctl -- bulk-upsert .\content.json --apply --json
```

`sync` сравнивает весь remote calendar постранично и создаёт/обновляет только различия. Remote-only записи выводятся в отчёте, но **никогда не удаляются и не отменяются**:

```powershell
npm run publisherctl -- sync .\content.json
npm run publisherctl -- sync .\content.json --apply
```

Обход revision-проверки намеренно отсутствует даже у agent token: запись с ручными
изменениями обновляется только с её точным `expected_revision`. Поэтому старый
manifest не сможет затереть более свежее исправление из админки. Обычный `sync`
сам перечитывает текущие revision перед формированием update.

И dry-run, и apply отправляются chunks максимум по 25 items — это одновременно server cap и запас против CPU-limit на Workers Free. У каждого chunk свой idempotency key, производный от operation key; повтор с тем же `--idempotency-key` безопасно попадает в те же ключи.

После каждого apply CLI атомарно создаёт рядом с исходником файл вида:

```text
content.json.publisher-applied-20260825T153000000Z-a1b2c3d4.json
```

Receipt содержит полный manifest, summary/ответы всех chunks, `manifest_sha256` и SHA-256 payload receipt. Файл создаётся с уникальным именем и переводится read-only; не редактируйте его. Если manifest лежит в Google Drive sync folder, receipt автоматически синхронизируется рядом. Другой каталог задаётся явно:

```powershell
npm run publisherctl -- bulk-upsert .\content.json --apply --receipt-dir D:\PublisherReceipts
```

Receipt не содержит Access/application/Meta tokens.

Если API вернул `conflicts` или `errors`, stdout показывает `partial`, а CLI завершает команду с exit code 3 даже в dry-run. При apply receipt всё равно создаётся для аудита и тоже получает `status: "partial"`. Это означает, что часть предыдущих apply chunks могла уже примениться. Не удаляйте receipt и не запускайте новый случайный apply: исправьте причины и повторите с осознанным idempotency/revision plan. `status: "complete"` означает отсутствие reported conflicts/errors во всех chunks.

## Storage forecast без загрузки

Перед импортом трёх месяцев посчитайте локальные unique bytes по SHA-256:

```powershell
npm run publisherctl -- storage-plan .\ready\reel-01.mp4 .\ready\reel-02.mp4 --json
```

Directory обходится только с явным согласием:

```powershell
npm run publisherctl -- storage-plan .\ready --recursive --json
```

Команда ничего не загружает, не обращается к R2 и не создаёт billable operation. Она не следует symbolic links, дедуплицирует одинаковые файлы по SHA-256/size и сравнивает их с бесплатными 10 GB-month R2 Standard (десятичные GB: `10_000_000_000` bytes; free tier не относится к Infrequent Access). В результате `extra_gb` показывает фактическое превышение, `billed_gb` консервативно округляет его вверх до целого GB, а `projected_usd` использует `$0.015` за billed GB-month. Прогноз предполагает, что каждый unique digest будет загружен один раз/переиспользован по media ID, в bucket больше ничего нет и указанный объём хранится постоянно весь месяц. Добавьте текущее R2 usage и неизбежные дубликаты вручную. Это ориентир, а не счёт: перед production проверьте актуальный R2 pricing.

## Операционные команды

```powershell
npm run publisherctl -- list --state needs_attention --json
npm run publisherctl -- events --limit 100 --json
npm run publisherctl -- accounts --json
npm run publisherctl -- export --format json --scope recovery --output .\content-recovery.json
npm run publisherctl -- export --format csv --scope events --output .\events.csv
```

Перед изменением получите актуальную запись и её `revision`:

```powershell
npm run publisherctl -- pause CONTENT_ID --revision 4
npm run publisherctl -- resume CONTENT_ID --revision 5
npm run publisherctl -- reschedule CONTENT_ID --revision 5 --at 2026-09-02T11:00:00+05:00
npm run publisherctl -- publish-now CONTENT_ID --revision 6
npm run publisherctl -- cancel CONTENT_ID --revision 6
npm run publisherctl -- duplicate CONTENT_ID --revision 6
```

HTTP 409 означает stale revision. Не повторяйте ту же команду с угаданным номером: перечитайте item, разберите изменения и только затем отправьте новую revision.
