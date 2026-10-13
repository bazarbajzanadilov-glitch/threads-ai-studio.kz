# Recovery и резервные копии

Цель восстановления — не только вернуть строки, но и не создать дубль уже опубликованного материала.

## Что сохраняется

- D1 содержит расписание, revisions, attempts, events, OAuth/account tokens в AES-GCM виде и operational state.
- R2 media bucket содержит готовые оптимизированные изображения/видео.
- R2 backup bucket ежедневно получает небольшой JSON manifest и неизменяемые JSONL shards максимум по 50 записей; хранится 30 daily + 12 monthly manifests вместе со всеми referenced shards.
- Snapshot исключает plaintext/encrypted Meta access token; он годится для аудита/восстановления контента, но не заменяет D1 Time Travel для account credentials.
- `publisherctl export --format json --scope recovery` даёт независимый безопасный export расписания, media links, revisions, attempts и events без account tokens. CSV предназначен только для `schedule` или `events`.

`TOKEN_ENCRYPTION_KEY` храните в password manager отдельно от Cloudflare. Без него сохранённые D1 tokens бесполезны; после потери ключа требуется повторный OAuth каждого аккаунта.

## Регулярная проверка

Раз в месяц:

1. Убедитесь, что в `publisher-ENV-backups` есть свежий `snapshots/daily/YYYY-MM-DD.manifest.json`.
2. Скачайте manifest и все перечисленные в нём shards. Сверьте SHA-256 manifest с R2 custom metadata/D1 `snapshots`; smoke-скрипт отдельно проверит hash, размер и число строк каждого shard.
3. Сделайте content export:

   ```powershell
   npm run publisherctl -- export --format json --scope recovery --output .\backup\content-YYYY-MM-DD.json
   ```

4. Проверьте чтение snapshot/export на отдельной машине.
5. Запишите фактический RTO/RPO.

Наличие файла без теста чтения не считается backup.

## Перед рискованной миграцией

```powershell
npx wrangler d1 export publisher-production `
  --env production `
  --remote `
  --config workers/api/wrangler.toml `
  --output publisher-production-before-change.sql
```

Храните export зашифрованно: он может содержать encrypted tokens и пользовательский контент. Не коммитьте его.

## Инцидент без потери D1

1. В админке включите global pause либо остановите cron triggers в Cloudflare dashboard.
2. Зафиксируйте timestamp, affected content IDs и последние events.
3. Для `publish_unknown` вручную проверьте профиль Meta и permalink/время. Если публикация существует, не повторяйте.
4. Отзовите скомпрометированный agent token/Access service token.
5. Исправьте причину в test и только затем production.
6. Включите cron и проверьте `/health` после первого нового run.

## D1 Time Travel

Сначала получите доступную точку восстановления:

```powershell
npx wrangler d1 time-travel info publisher-production `
  --env production `
  --remote `
  --config workers/api/wrangler.toml
```

Restore меняет production данные и может вернуть item в состояние «ещё не опубликовано», хотя Meta уже принял публикацию. Поэтому до restore:

- остановите cron;
- экспортируйте текущее повреждённое состояние;
- запишите все posts, реально появившиеся в Instagram/Threads после restore point;
- проверьте точный Wrangler command по текущей официальной документации;
- получите ручное подтверждение production environment.

После подтверждения используйте точный bookmark/timestamp, выданный Time Travel. Не вставляйте примерное время «на глаз». Сразу после restore оставьте global pause включённым и пометьте потенциально затронутые items как `publish_unknown`/`needs_attention` до сверки с Meta.

## Восстановление только из sharded snapshot

Sharded snapshot — последняя линия защиты, а не автоматический one-click restore. Manifest сам по себе не является резервной копией: для восстановления нужны все перечисленные в нём JSONL shards.

1. Создайте новую D1 recovery-базу, не перезаписывайте production.
2. Примените актуальные migrations.
3. Проверьте manifest header, SHA-256 manifest, а также SHA-256/размер/число records каждого shard.
4. Импортируйте content/media/link rows скриптом, написанным под конкретную schema version.
5. Не импортируйте старые leases, container polling state и «готово к публикации» без ручной нормализации.
6. Reconnect Instagram/Threads через OAuth.
7. Сверьте опубликованные items с платформами.
8. Переключайте binding только после test queries и ручного approval.

В репозитории нет автоматического production restore: корректная нормализация зависит от причины инцидента и уже совершённых внешних публикаций. `scripts/restore-snapshot.mjs` предназначен только для безопасной smoke-проверки в чистой test/recovery D1 и hard-blocked для production.

## Ежемесячный recovery smoke test

Раз в месяц восстанавливайте последний monthly manifest и его shards в **новую чистую test D1**, никогда сразу в production.

Перед cloud-проверкой запустите встроенный schema-level safety test. Он применяет все migrations к чистой in-memory D1 и доказывает две разные ветки восстановления: published identity сохраняется, а неопубликованная запись становится disabled/paused без remote identity.

```powershell
npm run test:restore
```

1. Скачайте manifest:

   ```powershell
   npx wrangler r2 object get `
     publisher-production-backups/snapshots/monthly/2026-08.manifest.json `
     --remote `
     --file .\recovery\2026-08.manifest.json
   ```

   Затем скачайте каждый shard, перечисленный в manifest. Скрипт принимает как сохранённое дерево `snapshots/staging/...`, так и flat-каталог с исходными basename:

   ```powershell
   New-Item -ItemType Directory -Force .\recovery\shards | Out-Null
   $snapshotManifest = Get-Content .\recovery\2026-08.manifest.json -Raw | ConvertFrom-Json
   foreach ($snapshotShard in $snapshotManifest.shards) {
     $snapshotFile = Join-Path .\recovery\shards ([IO.Path]::GetFileName($snapshotShard.key))
     npx wrangler r2 object get `
       "publisher-production-backups/$($snapshotShard.key)" `
       --remote `
       --file $snapshotFile
     if ($LASTEXITCODE -ne 0) { throw "Failed to download $($snapshotShard.key)" }
   }
   ```

2. Найдите ожидаемый SHA-256 в production таблице `snapshots` и выполните локальную проверку без cloud writes:

   ```powershell
   node scripts/restore-snapshot.mjs .\recovery\2026-08.manifest.json `
     --shards-dir .\recovery\shards `
     --expected-sha256 EXPECTED_HEX
   ```

3. Создайте одноразовую D1, например `publisher-recovery-2026-08`, и примените migrations:

   ```powershell
   npx wrangler d1 create publisher-recovery-2026-08
   npx wrangler d1 migrations apply publisher-recovery-2026-08 `
     --env test `
     --remote `
     --config workers/api/wrangler.toml
   ```

4. Только после dry-run примените smoke import четырьмя явными подтверждениями цели:

   ```powershell
   node scripts/restore-snapshot.mjs .\recovery\2026-08.manifest.json `
     --shards-dir .\recovery\shards `
     --expected-sha256 EXPECTED_HEX `
     --environment test `
     --database publisher-recovery-2026-08 `
     --apply `
     --remote `
     --confirm publisher-recovery-2026-08
   ```

Скрипт hard-blocked для production, отказывается от непустой D1, не импортирует account tokens и проверяет каждый shard. Media помечается `invalid`. Ранее опубликованный content остаётся `published` с сохранёнными `platform_media_id`/permalink/published_at, но получает `enabled=0` и пустой `resume_state`; все остальные записи становятся `paused` + `enabled=0`, а container и remote publication IDs у них очищаются. Поэтому recovery smoke не превращает уже опубликованный пост в resumable и не создаёт очевидный дубль. Скрипт удаляет временный SQL и отдельно сверяет aggregate counts и state/remote identity каждой content-записи. Та же проверка входит в общий `npm run check`. Legacy version 1 monolithic JSONL по-прежнему принимается для старых копий. После теста вручную осмотрите schema/data, запишите результат и только затем удалите одноразовую D1 через подтверждаемую Cloudflare-команду.

Monthly checklist: manifest и все shards скачаны, все digests/размеры/counts совпали, clean-D1 guard сработал, import завершён, все items disabled; published identity сохранена и не resumable, остальные items paused без remote identity; account count требует OAuth, отчёт приложен к журналу восстановления, временная база удалена после review.

## Потеря R2 media

- Не отменяйте записи, пока не проверены исходные локальные файлы/Drive reference.
- Повторно выполните `prepare → validate → upload`.
- Создайте новую media asset; существующий SHA/ID не подменяйте вручную.
- Обновите только неопубликованные items через revision-aware upsert.
- Published items не трогайте.

## Потеря/ротация ключей

- Agent token: создать новый, обновить CLI/CI, проверить, затем revoke старый.
- Access service token: добавить новый policy credential, проверить оба слоя, затем удалить старый.
- Meta App Secret: обновить API + соответствующий Public `INSTAGRAM_APP_SECRET`/`THREADS_APP_SECRET`, затем повторно проверить data deletion HMAC.
- `INTERNAL_SHARED_SECRET`: сначала поставить новое значение API, затем Public сразу вслед; короткое окно callback failure допустимо. Проверить service binding.
- `TOKEN_ENCRYPTION_KEY`: нельзя просто заменить — старые tokens перестанут расшифровываться. Требуется staged re-auth/migration либо повторное подключение всех accounts.
