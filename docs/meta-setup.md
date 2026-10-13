# Настройка Meta: Instagram и Threads

Проект использует только официальные publish API. Для первого прогона заведите отдельные test-профили и держите Meta app в development/test режиме, пока полный путь не проверен.

## Требования к аккаунтам

- Instagram: Professional account, доступный приложению в Meta dashboard.
- Threads: профиль Threads, связанный с владельцем приложения/tester.
- Владелец, developer/tester и нужные business assets должны быть явно добавлены в app roles/Business settings.

Точные требования App Review и доступные продукты меняются. Перед production сверяйте текущую документацию Meta и экран App Review, а не старые статьи.

## OAuth scopes, которые запрашивает код

Instagram:

- `instagram_business_basic`;
- `instagram_business_content_publish`.

Threads:

- `threads_basic`;
- `threads_content_publish`;
- `threads_location_tagging` — только для публикаций, где владелец явно указал Threads location metadata.

Если Meta переименует scope или изменит review, обновите одновременно конфигурацию приложения и `workers/api/src/accounts.ts`; не добавляйте лишние права «на будущее».

## Callback URLs

Callback должен совпадать символ в символ, включая HTTPS, hostname и отсутствие лишнего slash:

```text
https://PUBLIC_HOST/oauth/callback/instagram
https://PUBLIC_HOST/oauth/callback/threads
```

API генерирует opaque одноразовый state на 10 минут. Public Worker не декодирует его и передаёт code/state через service binding в API; API сверяет provider, redirect URI, срок и single-use запись в D1.

Для Meta app также укажите:

```text
Privacy Policy URL:        https://PUBLIC_HOST/privacy
Data Deletion Instructions: https://PUBLIC_HOST/data-deletion
Instagram Deletion Callback: https://PUBLIC_HOST/data-deletion/instagram
Threads Deletion Callback:   https://PUBLIC_HOST/data-deletion/threads
```

Public hostname нельзя закрывать Cloudflare Access. API/admin hostname, наоборот, должен быть закрыт.

## Первый connect

1. Откройте админку через Cloudflare Access.
2. На странице аккаунтов нажмите подключение Instagram или Threads.
3. Завершите OAuth тем же Meta-пользователем, который добавлен tester/developer.
4. Проверьте, что callback показывает только результат, но не code/state.
5. В админке проверьте username, status и expiry.
6. Сначала опубликуйте один безобидный test draft вручную через очередь.

Не используйте production media и расписание на три месяца, пока не пройдены: image, Reel/video, carousel, Threads text, отмена, повтор после временной ошибки и re-auth.

## Ограничения и безопасная автоматизация

В проекте сознательно отсутствуют:

- автоматические follow/unfollow;
- автолайк собственных или чужих публикаций;
- scraping пользователей по городу;
- browser automation и хранение Instagram password/session cookies.

Такие функции не являются частью Content Publishing API, легко выглядят как spam и могут привести к challenge, отзыву token или блокировке. Географическую аудиторию лучше строить контентом, topic/location metadata и официальной рекламой, а не автоматическими действиями аккаунта.

Планировщик соблюдает собственные безопасные batch/retry правила, но окончательный publish quota задаёт Meta для конкретного account. Смотрите события `needs_attention`, `publish_unknown`, rate-limit errors и platform publishing limit; не повышайте частоту повтора вслепую.

## Data deletion

Meta отправляет `signed_request` в Public Worker. Worker:

1. принимает только bounded JSON или `application/x-www-form-urlencoded` body до 20 KiB;
2. проверяет HMAC соответствующим Instagram/Threads App Secret;
3. требует целочисленный `issued_at`: callback не может быть из будущего или старше 10 минут;
4. передаёт API SHA-256 digest точного `signed_request`, чтобы повтор старого callback после переподключения аккаунта не удалил новые данные;
5. создаёт confirmation code из provider, user, `issued_at` и digest: точный повтор получает тот же code, а новый свежий callback после переподключения — новый;
6. через internal service binding просит API отозвать account token и отменить неопубликованный контент;
7. возвращает URL статуса.

Проверьте callback из Meta dashboard до App Review. Никогда не логируйте `signed_request`, OAuth code, state или access token.
