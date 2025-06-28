# 🚀 Деплой COFFEEMANIA

## Архитектура продакшена
- **База данных**: Neon PostgreSQL (облачная)  
- **Код**: GitHub репозиторий
- **Хостинг**: Render (автодеплой из GitHub)

## 📝 Пошаговая инструкция

### 1. Настройка Neon (PostgreSQL)
1. Заходим на [neon.tech](https://neon.tech)
2. Создаём аккаунт и новый проект
3. Выбираем регион (лучше EU для России)
4. Копируем **Connection String** из дашборда
   ```
   postgresql://username:password@ep-xxx.eu-central-1.aws.neon.tech/neondb?sslmode=require
   ```

### 2. Загрузка в GitHub
```bash
git add .
git commit -m "Ready for production deployment"
git push origin main
```

### 3. Настройка Render
1. Заходим на [render.com](https://render.com)
2. **New** → **Web Service**
3. Подключаем GitHub репозиторий
4. Настройки:
   - **Name**: `coffeemania`
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: `Free` (для начала)

### 4. Environment Variables в Render
Добавляем переменные окружения:
```
DATABASE_URL=твоя_neon_connection_string
NODE_ENV=production
BARISTA_PHONE=+7 (999) 123-45-67
```

### 5. Деплой
- Render автоматически создаёт и запускает приложение
- Получаем ссылку типа: `https://coffeemania.onrender.com`

## 🔧 Особенности

### Автоматические деплои
- Любой `git push` в main ветку = автоматический деплой
- Render показывает логи сборки и ошибки

### База данных  
- Neon автоматически создаёт все таблицы при первом запуске
- Данные сохраняются навсегда
- Резервные копии и масштабирование

### SSL/HTTPS
- Render автоматически настраивает HTTPS
- Сертификаты обновляются автоматически

## 📱 Доступ после деплоя
- **Главная**: `https://твой-домен.onrender.com`
- **Админка**: `https://твой-домен.onrender.com/admin.html`
- **Клиентские карты**: `https://твой-домен.onrender.com/card.html?id=CUSTOMER_ID`

## 🛠 Мониторинг
- Логи сервера в Render Dashboard
- Метрики базы данных в Neon Console
- Автоматические уведомления об ошибках 