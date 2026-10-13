# Threads Studio

Автономный сервис управления и авто-публикаций в **Threads (Meta)** с адаптивной веб-панелью управления для Linux VPS (`89.207.249.39` / `https://threads.ai-studio.kz`).

Дизайн и интерфейс выполнены в эстетике **Trantor Luxury Minimalism** (глубокий контраст, закругленные pill-кнопки, адаптивный dock-бар, поддержка экранов от 240px до 4K). Платформа оптимизирована строго под Threads: публикации **Текст (до 500 символов) + 1 Изображение** (JPG, PNG, WebP), локальное хранение медиа, встроенная база данных SQLite (WAL) и планировщик с анти-спам джиттером (Jitter).

---

## Стек технологий

- **Backend (`apps/server`)**: Node.js 22+, Express, SQLite (`better-sqlite3`), Meta Threads Graph API v24.0.
- **Frontend (`apps/admin`)**: Preact, Vite, TypeScript, Lucide Icons. Mobile-First (iPhone 14–18 Pro Max, Dynamic Island, Safe Areas, 240px–4K).
- **Core (`packages/core`)**: Модели валидации контента, планировщик интервалов (jitter), криптография сессий.
- **CLI (`packages/cli`)**: Командная строка для пакетной загрузки и синхронизации.
- **Инфраструктура**: Nginx (SSL Let's Encrypt), PM2 / Systemd, Ubuntu 24.04 LTS VPS.

---

## Требования к окружению

- **Node.js**: `>= 22.0.0`
- **npm**: `>= 10.0.0`
- **Git**

---

## Быстрый старт (Локальная разработка)

1. **Клонирование и установка зависимостей**:
   ```bash
   git clone https://github.com/bazarbajzanadilov-glitch/threads-ai-studio.kz.git
   cd threads-publisher
   npm install
   ```

2. **Настройка переменных окружения**:
   ```bash
   cp .env.example .env
   ```
   Основные переменные:
   - `PORT=3000`
   - `BASE_URL=https://threads.ai-studio.kz`
   - `ADMIN_EMAIL=bazarbajzanadilov@gmail.com`
   - `SECOND_ADMIN_EMAIL=reli.sheets1@gmail.com`
   - `SESSION_SECRET=admin_master_secret_2026`

3. **Запуск тестов и сборки**:
   ```bash
   npm test
   npm run build
   ```

4. **Запуск в режиме разработки**:
   - Сервер: `npm run dev:server` (на порту `3000`)
   - Админ-панель: `npm run dev:admin` (на порту `4173` с прокси на `3000`)

5. **Запуск в продакшене**:
   ```bash
   npm start
   ```
   Панель доступна по адресу `http://localhost:3000/`.

---

## Развёртывание на VPS (`89.207.249.39` / `https://threads.ai-studio.kz`)

1. **Подключение к серверу**:
   ```bash
   ssh root@89.207.249.39
   ```

2. **Обновление репозитория и сборка**:
   ```bash
   cd /var/www/threads-publisher
   git fetch origin && git reset --hard origin/main
   npm install
   npm run build
   ```

3. **Перезапуск через PM2**:
   ```bash
   pm2 restart ecosystem.config.cjs
   pm2 save
   ```

4. **Nginx & SSL**:
   - Конфигурация Nginx: `/etc/nginx/sites-available/threads.ai-studio.kz.conf`
   - Перезагрузка: `nginx -t && systemctl reload nginx`
   - SSL сертификат: `certbot --nginx -d threads.ai-studio.kz`

---

## Вход в админ-панель

1. Откройте: `https://threads.ai-studio.kz`
2. **Email**: `bazarbajzanadilov@gmail.com` или `reli.sheets1@gmail.com`
3. **Пароль (`SESSION_SECRET`)**: `admin_master_secret_2026`
