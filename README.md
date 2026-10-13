# Threads Auto-Publisher

Выделенный автономный сервис авто-публикаций в **Threads (Meta)** с удобной веб-панелью управления для Linux VPS (`89.207.249.39` / `thread.ai-studio.kz`).

Платформа спроектирована исключительно для Threads: строго формат **Текст (до 500 символов) + 1 Изображение** (JPG, PNG, WebP), локальное хранение медиа, встроенная SQLite база данных и умный планировщик с анти-спам джиттером (jitter) между аккаунтами.

---

## Архитектура и Возможности

1. **Строго Threads (Без Instagram и видео-сложности)**:
   - Полностью исключены Instagram API, видео, Reels, FFmpeg и карусели.
   - Поддерживаются посты **Текст + 1 Изображение** с проверкой лимитов Meta Graph API v24.0.

2. **Self-hosted Node.js + SQLite**:
   - Работает автономно на сервере без привязки к Cloudflare Workers / D1 / R2.
   - База данных SQLite (`./data/threads.db`) в режиме WAL.
   - Изображения сохраняются локально (`./data/uploads/`) и отдаются Meta краулеру напрямую через публичные URL: `https://thread.ai-studio.kz/uploads/<filename>`.

3. **Мультиаккаунт Threads (~10 аккаунтов)**:
   - Подключение через официальный Threads OAuth или ручной ввод Long-Lived Access Token.
   - Автоматическая проверка профиля, имени пользователя и аватара через Graph API.
   - Управление состоянием: `Активен`, `На паузе`, `Истекает`, `Отозван`.
   - Автоматический фоновый рефреш 60-дневных токенов каждые 12–24 часа при сроке действия < 30 дней.

4. **Авто-публикация с рандомизированным джиттером (Jitter)**:
   - Настраиваемое дневное окно публикаций (по умолчанию `11:00`–`21:00` по времени Алматы Asia/Almaty UTC+5).
   - Настраиваемый диапазон пауз между аккаунтами (`15`–`40` минут) со случайным разбросом интервалов.
   - Полный цикл публикации: создание контейнера (`POST /me/threads`) → опрос готовности (`GET /{id}`) → публикация (`POST /me/threads_publish`) → получение прямой ссылки (`permalink`).

5. **Веб-панель администратора**:
   - Авторизация администратора (`ADMIN_EMAIL=bazarbajzanadilov@gmail.com`, `SECOND_ADMIN_EMAIL=reli.sheets1@gmail.com`, `SESSION_SECRET=admin_master_secret_2026`).
   - **Вкладка 1: Аккаунты** — список аккаунтов, аватары, статус, переключатель активен/пауза, кнопка обновления токена, добавление аккаунта.
   - **Вкладка 2: Публикации / Очередь** — создание поста (текст с живым счётчиком 500 симв., загрузка картинки с превью, выбор конкретного аккаунта или пула "Все аккаунты"), просмотр очереди, статусы, кнопка "Опубликовать сейчас".
   - **Вкладка 3: Расписание & Задержки** — настройка окна (начало/конец), минимальная и максимальная пауза, тумблер рандомизации, интерактивная шкала распределения на сегодня.
   - **Вкладка 4: История & Журнал** — лента опубликованных постов с прямыми кликабельными ссылками в Threads, системные логи.

---

## Структура репозитория

```text
├── apps/
│   ├── admin/             # SPA панель администратора (Vite + Preact + Lucide)
│   └── server/            # Standalone Node.js сервер (Express + SQLite + Threads API + Scheduler)
├── packages/
│   ├── core/              # Валидация Threads, джиттер, криптография, стейт-машина
│   └── cli/               # CLI утилиты
├── deploy/
│   ├── nginx/             # Nginx конфигурация для thread.ai-studio.kz
│   └── systemd/           # Systemd unit сервис для Linux VPS
├── data/                  # Локальная папка базы данных и загрузок (gitignored)
│   ├── threads.db         # SQLite база данных
│   └── uploads/           # Загруженные изображения постов
├── ecosystem.config.cjs   # Конфигурация PM2
└── .env.example           # Пример переменных окружения
```

---

## Быстрый старт локально

1. Установите зависимости:
   ```bash
   npm install
   ```

2. Запустите тесты и сборку:
   ```bash
   npm test
   npm run build
   ```

3. Запустите сервер:
   ```bash
   npm start
   ```
   Сервер запустится на `http://localhost:3000`. Панель администратора доступна по адресу `http://localhost:3000/`.

---

## Развёртывание на VPS (`89.207.249.39` / `thread.ai-studio.kz`)

### 1. Подготовка сервера
Подключитесь к VPS по SSH:
```bash
ssh root@89.207.249.39
```

Установите Node.js 22+ и Nginx:
```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs nginx certbot python3-certbot-nginx git
npm install -g pm2
```

### 2. Клонирование и сборка
```bash
mkdir -p /var/www/thread.ai-studio.kz
cd /var/www/thread.ai-studio.kz
git clone <REPO_URL> .

# Установка зависимостей и сборка
npm install
npm run build
```

### 3. Настройка окружения
Создайте файл `.env`:
```bash
cp .env.example .env
nano .env
```
Убедитесь, что заполнены:
```env
PORT=3000
HOST=0.0.0.0
NODE_ENV=production
BASE_URL=https://thread.ai-studio.kz
ADMIN_EMAIL=bazarbajzanadilov@gmail.com
SECOND_ADMIN_EMAIL=reli.sheets1@gmail.com
SESSION_SECRET=admin_master_secret_2026
```

### 4. Настройка Nginx и SSL
Скопируйте конфигурацию Nginx:
```bash
cp deploy/nginx/thread.ai-studio.kz.conf /etc/nginx/sites-available/thread.ai-studio.kz
ln -s /etc/nginx/sites-available/thread.ai-studio.kz /etc/nginx/sites-enabled/
nginx -t
systemctl reload nginx
```

Получите бесплатный SSL-сертификат Let's Encrypt:
```bash
certbot --nginx -d thread.ai-studio.kz
```

### 5. Запуск через PM2 или Systemd

**Вариант А: PM2 (Рекомендуется)**
```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

**Вариант Б: Systemd**
```bash
cp deploy/systemd/threads-publisher.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable threads-publisher
systemctl start threads-publisher
```

Проверить статус:
```bash
systemctl status threads-publisher
# или
pm2 status
```

---

## Вход в админ-панель
1. Откройте в браузере: `https://thread.ai-studio.kz/`
2. Введите email администратора:
   - `bazarbajzanadilov@gmail.com` или `reli.sheets1@gmail.com`
3. Введите пароль (`SESSION_SECRET`):
   - `admin_master_secret_2026`
4. Добавьте первый аккаунт Threads и начните авто-публикации!
