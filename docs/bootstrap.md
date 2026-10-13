# Cloudflare bootstrap

Эта инструкция поднимает сначала изолированное окружение `test`, затем теми же шагами — `production`. Никакие реальные credentials в репозитории не нужны.

## 1. Локальные требования

- Node.js 22 или новее;
- npm;
- FFmpeg и FFprobe в `PATH` для подготовки/проверки/загрузки;
- Cloudflare account с включёнными Workers, D1 и R2;
- Wrangler login либо `CLOUDFLARE_API_TOKEN` для CI.

```powershell
npm install
node scripts/check-prerequisites.mjs
npx wrangler login
npm run check
```

FFmpeg не нужен самому Worker, но теперь обязателен для `publisherctl upload`: CLI автоматически извлекает и отправляет технические metadata.

## 2. Создание D1 и R2

Сначала посмотрите команды без изменений:

```powershell
./scripts/bootstrap-cloudflare.ps1 -Environment test
```

Затем явно подтвердите создание:

```powershell
./scripts/bootstrap-cloudflare.ps1 -Environment test -Apply
```

Будут созданы:

- D1 `publisher-test`;
- R2 `publisher-test` для медиа;
- R2 `publisher-test-backups` для snapshots.

Перед `-Apply` замените origin в `infra/r2-cors.test.json` на точный HTTPS origin API/admin Worker. Bootstrap затем применит к media bucket:

- CORS только для этого origin;
- только `PUT` для presigned single/UploadPart (complete/abort идут same-origin через API);
- только необходимые browser S3 headers, включая `amz-sdk-invocation-id` и `amz-sdk-request`;
- `ETag` в exposed headers (он нужен browser multipart client);
- lifecycle abort incomplete multipart uploads через 24 часа.

Не ставьте origin `*` вместе с upload authorization. Lifecycle удаляет только незавершённые multipart uploads; срок удаления готовых media по-прежнему контролируется D1/scheduler, а не грубым bucket-wide expiry.

Скрипт не меняет конфиги и не деплоит Worker. Возьмите настоящий D1 ID из вывода `npx wrangler d1 list` и замените `REPLACE_ME` в секциях `test` обоих файлов:

- `workers/api/wrangler.toml`;
- `workers/public/wrangler.jsonc`.

Оба Worker должны быть привязаны к **одной и той же** D1 базе данного окружения.

## 3. URL, email и Access vars

В `workers/api/wrangler.toml` для `env.test` замените:

- `PUBLIC_BASE_URL` на точный origin Public Worker;
- `ACCESS_AUD` на Application Audience (AUD) из Cloudflare Access;
- `ACCESS_TEAM_DOMAIN` на ваш `team.cloudflareaccess.com`.

В `workers/public/wrangler.jsonc` для `env.test` замените:

- `PUBLIC_BASE_URL` на тот же публичный origin;
- `API_INTERNAL_BASE_URL` на origin API Worker — это fallback и корректный origin для формируемого Request;
- `PRIVACY_CONTACT_EMAIL` на действующий адрес;
- D1 ID.

Service binding уже должен выглядеть так:

```json
{ "binding": "API", "service": "social-publisher-api-test" }
```

Для production target должен быть `social-publisher-api`. Если вы переименовали API Worker, одновременно обновите binding. Перед деплоем проверяйте placeholders:

```powershell
node scripts/assert-configured.mjs --environment test
```

## 4. Cloudflare Access

Создайте Access application для hostname API Worker (админка и `/api/v1/*` находятся на одном Worker):

1. Добавьте Allow policy только для email владельца/нужной группы.
2. Создайте Service Token для `publisherctl`.
3. Добавьте отдельную Service Auth policy, которая разрешает этот service token.
4. Скопируйте AUD и team domain в vars API Worker.

Public Worker **не закрывайте Access**. Meta должен без интерактивного login открыть OAuth callback и data-deletion callback, а UptimeRobot — `/health`.

OAuth `code` и одноразовый `state` приходят в query string. Поэтому в `workers/public/wrangler.jsonc` явно отключены automatic invocation logs и traces (`logs.invocation_logs: false`, `traces.enabled: false`): они могли бы сохранить полный callback URL. Метрики Worker остаются доступными. Не включайте request/invocation logging для Public Worker; собственный код также не пишет code, state или `signed_request` в лог.

Access service token не заменяет application token. Первый пропускает запрос через edge, второй задаёт scopes внутри API. Подробнее — в [CLI-инструкции](cli.md).

## 5. Secrets

Сгенерируйте три независимых случайных значения локально:

```powershell
node scripts/generate-secrets.mjs
```

`TOKEN_ENCRYPTION_KEY` — 32-byte base64url AES-GCM key. Потеря ключа означает, что сохранённые Meta tokens расшифровать нельзя. `INTERNAL_SHARED_SECRET` должен иметь одинаковое значение в двух Worker под разными именами:

| API Worker | Public Worker |
| --- | --- |
| `INTERNAL_SHARED_SECRET` | `INTERNAL_API_SECRET` |

Интерактивный скрипт передаёт значения прямо в Wrangler и не пишет их на диск:

```powershell
./scripts/set-secrets.ps1 -Environment test -IncludeTelegram
```

API Worker требует:

- `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`;
- `THREADS_APP_ID`, `THREADS_APP_SECRET`;
- `TOKEN_ENCRYPTION_KEY`;
- `INTERNAL_SHARED_SECRET`;
- `CF_API_TOKEN`, `CF_ACCOUNT_ID`;
- `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`;
- опционально `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`.

Public Worker требует:

- `INTERNAL_API_SECRET` — тот же shared secret;
- `INSTAGRAM_APP_SECRET` — Instagram App Secret для HMAC `signed_request`;
- `THREADS_APP_SECRET` — Threads App Secret для HMAC `signed_request`;
- `DATA_DELETION_SECRET` — отдельный стабильный secret для confirmation code.

Для прямого multipart upload создайте R2 parent access key только к media bucket. `CF_API_TOKEN` должен иметь минимально необходимые account-level R2 permissions для выдачи временных exact-key credentials. Не используйте Global API Key.

Секреты Worker настраиваются отдельно для `test` и `production`; Wrangler не наследует их между environments.

## 6. Первая миграция и порядок deploy

API Worker деплоится **до** Public Worker: public service binding не должен ссылаться на отсутствующий service.

```powershell
npm run db:migrate:test -w @publisher/api-worker
npm run deploy:test -w @publisher/api-worker
npm run deploy:test -w @publisher/public-worker
```

Проверьте privacy и дождитесь первого минутного cron run перед health check:

```powershell
node scripts/verify-deployment.mjs `
  --public-url https://YOUR-PUBLIC-HOST `
  --wait-seconds 180
```

`/health` возвращает 503, если D1 недоступна, последний `cron_runs` отсутствует или старше 3 минут. Поэтому 503 сразу после первого deploy ожидаем до первого cron trigger.

## 7. Application agent token

После миграции откройте защищённую админку и создайте токен в разделе «Система → Доступ publisherctl» — это основной, полностью журналируемый путь. Если интерфейс ещё недоступен, есть аварийный bootstrap-скрипт; он также добавляет событие аудита и требует подтверждения точной целевой базы:

```powershell
node scripts/create-agent-token.mjs `
  --environment test `
  --name my-laptop `
  --confirm publisher-test `
  --apply
```

Plaintext `pub_...` показывается один раз. Сохраните его в password manager. Доступные scopes: `content:read`, `content:write`, `uploads:write`. Для read-only автоматизации укажите `--scopes content:read`.

CLI за Access требует и этот Bearer token, и Access service-token pair:

```powershell
$env:PUBLISHER_API_TOKEN = "pub_..."
$env:CF_ACCESS_CLIENT_ID = "...access"
$env:CF_ACCESS_CLIENT_SECRET = "..."
npm run publisherctl -- auth login --profile test --api-url https://YOUR-API-HOST
```

Чтобы ничего не сохранять в profile, добавьте `--no-store` и оставьте secrets в environment/password manager.

## 8. Production

Не копируйте базу test в production. Повторите создание ресурсов с `-Environment production`, задайте отдельные secrets, Meta redirect URLs и Access application/policies. Сначала выполните:

```powershell
node scripts/assert-configured.mjs --environment production
npm run check
```

Затем используйте только ручной GitHub workflow `Deploy`, привязанный к GitHub Environment `production` с required reviewer. Workflow применяет migrations, деплоит API первым, затем Public Worker.

В каждом GitHub Environment (`test`, `production`) задайте:

- secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`;
- variable `PUBLIC_URL` с точным Public Worker origin;
- для production — required reviewer и запрет self-approval, если доступно.

Deploy token должен иметь только нужные Workers Scripts, D1 и R2 edit permissions. Workflow также повторно применяет versioned CORS/lifecycle JSON, поэтому configuration drift исправляется перед Worker deploy. Он не создаёт и не меняет Worker secrets: они загружаются заранее интерактивным `set-secrets.ps1`.
