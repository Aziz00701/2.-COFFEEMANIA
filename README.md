# ☕ COFFEEMANIA - Progressive Web App (PWA)

Система лояльности для кофейни с полной PWA поддержкой и веб-сервером.

## 🚀 Особенности

### PWA (Progressive Web App)
- ✅ **Нативная установка** - реальные приложения (не закладки)
- 📱 **Админ PWA**: "ADM - Панель Бариста" (`/admin.html`)
- ☕ **Клиент PWA**: "COFFEEMANIA - Client Name" (`/card.html`)
- 🔄 **Service Workers** для офлайн работы
- 🎨 **Красивые иконки** и правильная изоляция приложений

### Функциональность
- 👥 **Регистрация клиентов** с QR-кодами
- ☕ **Система лояльности** (каждый 7-й кофе бесплатно)
- 📱 **QR-сканер** с поддержкой камеры
- 📊 **История покупок** с красивыми карточками
- 💬 **WhatsApp интеграция** для отправки карт клиентам
- 🗂️ **База данных**: PostgreSQL + SQLite fallback
- 🧹 **Очистка дублей** в истории покупок

### Производительность
- ⚡ **Быстрая загрузка**: 1-5 сек (вместо 20-30 сек)
- 🔄 **Оптимизированные таймауты** и повторы
- 🚫 **Неблокирующая обработка ошибок**
- 💫 **Легкие проверки соединения**

## 🌐 Запуск на веб-сервере

### Требования
- Node.js 16+ 
- npm или yarn
- PostgreSQL (опционально, есть SQLite fallback)

### 1. Клонирование репозитория
```bash
git clone https://github.com/Aziz00701/2.-COFFEEMANIA.git
cd 2.-COFFEEMANIA
```

### 2. Установка зависимостей
```bash
npm install
```

### 3. Настройка переменных окружения (опционально)
```bash
# Создайте .env файл для настройки PostgreSQL
PORT=1000
DATABASE_URL=postgresql://username:password@localhost/coffeemania
```

### 4. Запуск сервера
```bash
# Производственный запуск
npm start

# Или напрямую
node index.js
```

### 5. Доступ к приложению
- 🌐 **Основная страница**: `http://your-server:1000`
- 👨‍💼 **Админ-панель**: `http://your-server:1000/admin.html`
- ☕ **Клиентские карты**: `http://your-server:1000/card.html?id=CUSTOMER_ID`

## 🔐 Авторизация администратора

```
Логин: coffemania
Пароль: 787898
```

## 📱 PWA Установка

### Для администраторов
1. Откройте `http://your-server:1000/admin.html`
2. Войдите в систему
3. Нажмите кнопку "📱 Установить ADM" 
4. Приложение установится как "ADM - Панель Бариста"

### Для клиентов
1. Отправьте клиенту QR-код или ссылку на его карту
2. Клиент открывает `http://your-server:1000/card.html?id=CUSTOMER_ID`
3. Нажимает "📱 Установить приложение"
4. Приложение устанавливается как "COFFEEMANIA - Имя Клиента"

## 🗄️ База данных

### Автоматическая настройка
- ✅ **PostgreSQL** (если доступен)
- 🔄 **SQLite fallback** (автоматически если PostgreSQL недоступен)
- 📊 **Автосоздание таблиц** при первом запуске
- 🧹 **Очистка дублей** через админ-панель

### Структура данных
- `customers` - клиенты и их прогресс
- `purchase_history` - история всех покупок
- `barista_phone` - номер для предзаказов

## 🚀 Развертывание на хостинге

### Heroku
```bash
# Установите Heroku CLI
heroku create your-app-name
heroku addons:create heroku-postgresql:hobby-dev
git push heroku main
```

### VPS/Dedicated Server
```bash
# Установите PM2 для production
npm install -g pm2

# Запустите с PM2
pm2 start index.js --name "coffeemania"
pm2 startup
pm2 save
```

### Docker (опционально)
```dockerfile
FROM node:16-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --only=production
COPY . .
EXPOSE 1000
CMD ["node", "index.js"]
```

## 🛠️ Технические детали

### Стек технологий
- **Backend**: Node.js + Express
- **Database**: PostgreSQL/SQLite3
- **Frontend**: Vanilla JS + PWA
- **UI**: CSS3 с градиентами и glassmorphism
- **PWA**: Service Workers + Web App Manifest

### API Endpoints
- `GET /api/customers` - список клиентов
- `POST /api/register` - регистрация клиента
- `POST /api/purchase/:id` - добавить покупку
- `GET /api/history/:id` - история покупок
- `POST /api/cleanup-duplicates` - очистка дублей

### Производительность
- Оптимизированные SQL запросы
- Кэширование статических файлов
- Gzip сжатие
- Минимальные зависимости

## 📞 Поддержка

При возникновении проблем:

1. **Проверьте логи**: `tail -f logs/app.log` (если настроены)
2. **База данных**: Проверьте подключение к PostgreSQL/SQLite
3. **PWA**: Убедитесь что сервер доступен по HTTPS (для production)
4. **Камера**: QR-сканер работает только на HTTPS или localhost

## 🎯 Особенности PWA

### Требования для установки
- ✅ HTTPS (или localhost для разработки)
- ✅ Valid Web App Manifest
- ✅ Registered Service Worker  
- ✅ Icons (192x192 и 512x512)
- ✅ start_url доступен

### Офлайн поддержка
- Кэширование критических ресурсов
- Graceful degradation при отсутствии сети
- Синхронизация при восстановлении соединения

---

**Разработано для COFFEEMANIA** ☕ 
*Лучший кофе с современными технологиями!*