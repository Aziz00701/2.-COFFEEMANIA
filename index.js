const express = require('express');
const { Pool } = require('pg');
const { nanoid } = require('nanoid');
const QRCode = require('qrcode');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

// Подключение к PostgreSQL (замените на вашу ссылку из Render)
const connectionString = process.env.DATABASE_URL || 'postgresql://coffeemania_db_user:H9eKkNMYufnRZsMlfmc4NokQhMcGCE3K@dpg-d1c2soer433s7381rgfg-a.frankfurt-postgres.render.com/coffeemania_db';

const pool = new Pool({
    connectionString: connectionString,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : { rejectUnauthorized: false }
});

// --- Логирование ---
const log = {
    info: (msg, ...args) => console.log(`ℹ️  ${new Date().toISOString()} - ${msg}`, ...args),
    error: (msg, ...args) => console.error(`❌ ${new Date().toISOString()} - ${msg}`, ...args),
    success: (msg, ...args) => console.log(`✅ ${new Date().toISOString()} - ${msg}`, ...args),
    warn: (msg, ...args) => console.warn(`⚠️  ${new Date().toISOString()} - ${msg}`, ...args)
};

// --- Database Setup ---
async function initializeDatabase() {
    try {
        log.info('Подключение к PostgreSQL...');
        
        // Проверяем подключение
        const client = await pool.connect();
        log.success('Успешное подключение к PostgreSQL');
        client.release();

        // Создание таблицы клиентов
        await pool.query(`
            CREATE TABLE IF NOT EXISTS customers (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                phone TEXT NOT NULL UNIQUE,
                purchases INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        log.info('Таблица customers готова');

        // Создание таблицы истории покупок
        await pool.query(`
            CREATE TABLE IF NOT EXISTS purchase_history (
                purchase_id SERIAL PRIMARY KEY,
                customer_id TEXT NOT NULL,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
            )
        `);
        log.info('Таблица purchase_history готова');

        // Получение статистики
        const result = await pool.query('SELECT COUNT(*) as count FROM customers');
        log.info(`В базе зарегистрировано клиентов: ${result.rows[0].count}`);

    } catch (error) {
        log.error('Ошибка инициализации базы данных:', error.message);
        process.exit(1);
    }
}

// --- Middleware ---
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Middleware для логирования запросов
app.use((req, res, next) => {
    if (req.path.startsWith('/api/')) {
        log.info(`${req.method} ${req.path}`, req.query || req.body);
    }
    next();
});

// --- API Routes ---

// 1. Регистрация нового клиента
app.post('/api/register', async (req, res) => {
    const client = await pool.connect();
    try {
        const { name, phone } = req.body;
        
        // Валидация данных
        if (!name || !phone) {
            return res.status(400).json({ error: 'Имя и телефон обязательны для заполнения.' });
        }

        if (name.length < 2 || name.length > 50) {
            return res.status(400).json({ error: 'Имя должно содержать от 2 до 50 символов.' });
        }

        if (!/^\+7 \(\d{3}\) \d{3} \d{2} \d{2}$/.test(phone)) {
            return res.status(400).json({ error: 'Неверный формат номера телефона.' });
        }

        const id = nanoid(10);
        
        await client.query('BEGIN');
        
        const result = await client.query(
            'INSERT INTO customers (id, name, phone, purchases) VALUES ($1, $2, $3, 0) RETURNING id',
            [id, name, phone]
        );
        
        await client.query('COMMIT');
        
        const customerUrl = `https://2-coffeemania.vercel.app/card.html?id=${id}`;
        
        const qrCode = await QRCode.toDataURL(customerUrl, {
            type: 'image/png',
            quality: 0.92,
            margin: 1,
            color: {
                dark: '#000000',
                light: '#FFFFFF'
            },
            width: 256
        });

        log.success(`Новый клиент зарегистрирован: ${name} (${phone})`);
        
        res.status(201).json({ 
            message: 'Клиент успешно зарегистрирован!',
            customerId: id,
            customerUrl,
            qrCode 
        });
        
    } catch (error) {
        await client.query('ROLLBACK');
        if (error.constraint === 'customers_phone_key') {
            log.warn(`Попытка регистрации существующего номера: ${req.body.phone}`);
            return res.status(409).json({ error: 'Клиент с таким номером телефона уже зарегистрирован.' });
        }
        log.error("Ошибка регистрации клиента:", error.message);
        res.status(500).json({ error: 'Не удалось зарегистрировать клиента.' });
    } finally {
        client.release();
    }
});

// 2. Поиск клиента
app.get('/api/search', async (req, res) => {
    try {
        const { q } = req.query;
        
        if (!q || q.length < 2) {
            return res.status(400).json({ error: 'Поисковый запрос должен содержать минимум 2 символа.' });
        }

        const result = await pool.query(
            'SELECT id, name, phone, purchases, created_at FROM customers WHERE name ILIKE $1 OR phone LIKE $2 ORDER BY name ASC LIMIT 20',
            [`%${q}%`, `%${q}%`]
        );
        
        log.info(`Поиск "${q}" - найдено результатов: ${result.rows.length}`);
        res.json(result.rows);
        
    } catch (error) {
        log.error("Ошибка поиска клиентов:", error.message);
        res.status(500).json({ error: 'Ошибка поиска клиентов.' });
    }
});

// 2.1. Получение всех клиентов
app.get('/api/customers', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, name, phone, purchases, created_at FROM customers ORDER BY created_at DESC'
        );
        
        log.info(`Загружено клиентов: ${result.rows.length}`);
        res.json(result.rows);
        
    } catch (error) {
        log.error("Ошибка загрузки клиентов:", error.message);
        res.status(500).json({ error: 'Ошибка загрузки клиентов.' });
    }
});

// 3. Засчитывание покупки
app.post('/api/purchase/:customerId', async (req, res) => {
    const client = await pool.connect();
    try {
        const { customerId } = req.params;
        
        if (!customerId) {
            return res.status(400).json({ error: 'ID клиента обязателен.' });
        }

        await client.query('BEGIN');

        const customerResult = await client.query(
            'SELECT id, name, phone, purchases FROM customers WHERE id = $1',
            [customerId]
        );

        if (customerResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Клиент не найден.' });
        }

        const customer = customerResult.rows[0];
        let currentPurchases = customer.purchases;
        let newPurchases;
        let message;
        let isComplete = false;

        if (currentPurchases >= 6) {
            newPurchases = 1; // Начинаем новый цикл
            message = 'Клиент получил бесплатный кофе! Начат новый цикл.';
            isComplete = true;
        } else {
            newPurchases = currentPurchases + 1;
            if (newPurchases === 6) {
                message = `Покупка засчитана. Следующий кофе бесплатно!`;
                isComplete = true;
            } else {
                message = `Покупка засчитана. Прогресс: ${newPurchases}/6.`;
            }
        }
        
        await client.query(
            'UPDATE customers SET purchases = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
            [newPurchases, customerId]
        );
        
        // Всегда логируем покупку
        await client.query(
            'INSERT INTO purchase_history (customer_id) VALUES ($1)',
            [customerId]
        );
        
        await client.query('COMMIT');
        log.success(`Покупка засчитана: ${customer.name} (${currentPurchases} → ${newPurchases})`);
        res.json({ 
            message, 
            customer,
            newPurchases,
            isComplete
        });
        
    } catch (error) {
        await client.query('ROLLBACK');
        log.error("Ошибка обновления покупок:", error.message);
        res.status(500).json({ error: 'Не удалось обновить количество покупок.' });
    } finally {
        client.release();
    }
});

// 4. Получение истории покупок
app.get('/api/history/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        const [customerResult, historyResult] = await Promise.all([
            pool.query('SELECT id, name, phone, purchases FROM customers WHERE id = $1', [id]),
            pool.query('SELECT created_at FROM purchase_history WHERE customer_id = $1 ORDER BY created_at ASC', [id])
        ]);
        
        if (customerResult.rows.length === 0) {
            return res.status(404).json({ error: 'Клиент не найден.' });
        }
        
        res.json({
            customer: customerResult.rows[0],
            history: historyResult.rows
        });
        
    } catch (error) {
        log.error("Ошибка получения истории:", error.message);
        res.status(500).json({ error: 'Не удалось получить историю покупок.' });
    }
});

// 5. Получение данных клиента для карты
app.get('/api/customer/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        const result = await pool.query(
            'SELECT id, name, purchases FROM customers WHERE id = $1',
            [id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Клиент не найден.' });
        }
        
        res.json(result.rows[0]);
        
    } catch (error) {
        log.error("Ошибка получения данных клиента:", error.message);
        res.status(500).json({ error: 'Не удалось получить данные клиента.' });
    }
});

// 6. Генерация QR-кода для карты клиента
app.get('/api/qr/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        const result = await pool.query('SELECT id FROM customers WHERE id = $1', [id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Клиент не найден' });
        }
        
        const customerUrl = `https://2-coffeemania.vercel.app/card.html?id=${id}`;
        const qrCodeBuffer = await QRCode.toBuffer(customerUrl, {
            type: 'png',
            quality: 0.92,
            margin: 1,
            color: {
                dark: '#000000',
                light: '#FFFFFF'
            },
            width: 256
        });
        
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Content-Disposition', 'inline; filename="qr-code.png"');
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.send(qrCodeBuffer);
        
    } catch (error) {
        log.error('Ошибка генерации QR-кода:', error);
        res.status(500).json({ error: 'Не удалось сгенерировать QR-код' });
    }
});

// 7. Статистика системы
app.get('/api/stats', async (req, res) => {
    try {
        const [totalCustomers, totalPurchases, readyForFreeCoffee] = await Promise.all([
            pool.query('SELECT COUNT(*) as total FROM customers'),
            pool.query('SELECT COUNT(*) as total FROM purchase_history'),
            pool.query('SELECT COUNT(*) as ready FROM customers WHERE purchases >= 6')
        ]);

        const stats = {
            totalCustomers: parseInt(totalCustomers.rows[0].total),
            totalPurchases: parseInt(totalPurchases.rows[0].total),
            readyForFreeCoffee: parseInt(readyForFreeCoffee.rows[0].ready)
        };

        res.json(stats);
        
    } catch (error) {
        log.error('Ошибка получения статистики:', error);
        res.status(500).json({ error: 'Не удалось получить статистику' });
    }
});

// 8. Удаление клиента
app.delete('/api/customer/:id', async (req, res) => {
    const client = await pool.connect();
    try {
        const { id } = req.params;
        
        if (!id) {
            return res.status(400).json({ error: 'ID клиента обязателен.' });
        }

        await client.query('BEGIN');

        const customerResult = await client.query('SELECT id, name FROM customers WHERE id = $1', [id]);

        if (customerResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Клиент не найден.' });
        }

        const customer = customerResult.rows[0];

        // Удаляем историю покупок (CASCADE должен это сделать автоматически, но для надежности)
        await client.query('DELETE FROM purchase_history WHERE customer_id = $1', [id]);

        // Удаляем клиента
        await client.query('DELETE FROM customers WHERE id = $1', [id]);

        await client.query('COMMIT');
        log.success(`Клиент удален: ${customer.name} (ID: ${id})`);
        res.json({ 
            message: `Клиент "${customer.name}" успешно удален.`,
            deletedCustomer: customer
        });
        
    } catch (error) {
        await client.query('ROLLBACK');
        log.error("Ошибка удаления клиента:", error.message);
        res.status(500).json({ error: 'Не удалось удалить клиента.' });
    } finally {
        client.release();
    }
});

// 8.5. Редактирование клиента
app.put('/api/customer/:id', async (req, res) => {
    const client = await pool.connect();
    try {
        const { id } = req.params;
        const { name, phone } = req.body;
        
        if (!id) {
            return res.status(400).json({ error: 'ID клиента обязателен.' });
        }

        // Валидация данных
        if (!name || !phone) {
            return res.status(400).json({ error: 'Имя и телефон обязательны для заполнения.' });
        }

        if (name.length < 2 || name.length > 50) {
            return res.status(400).json({ error: 'Имя должно содержать от 2 до 50 символов.' });
        }

        if (!/^\+7 \(\d{3}\) \d{3} \d{2} \d{2}$/.test(phone)) {
            return res.status(400).json({ error: 'Неверный формат номера телефона.' });
        }

        await client.query('BEGIN');

        const customerResult = await client.query('SELECT id, name, phone FROM customers WHERE id = $1', [id]);

        if (customerResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Клиент не найден.' });
        }

        const customer = customerResult.rows[0];

        // Проверяем, не занят ли новый номер телефона другим клиентом
        if (phone !== customer.phone) {
            const phoneCheckResult = await client.query('SELECT id FROM customers WHERE phone = $1 AND id != $2', [phone, id]);
            
            if (phoneCheckResult.rows.length > 0) {
                await client.query('ROLLBACK');
                return res.status(409).json({ error: 'Клиент с таким номером телефона уже существует.' });
            }
        }

        await client.query(
            'UPDATE customers SET name = $1, phone = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3',
            [name, phone, id]
        );

        await client.query('COMMIT');
        log.success(`Клиент обновлен: ${customer.name} → ${name}, ${customer.phone} → ${phone}`);
        res.json({ 
            message: 'Данные клиента успешно обновлены.',
            customer: { id, name, phone }
        });
        
    } catch (error) {
        await client.query('ROLLBACK');
        log.error("Ошибка обновления клиента:", error.message);
        res.status(500).json({ error: 'Не удалось обновить данные клиента.' });
    } finally {
        client.release();
    }
});

// 9. Получение всех клиентов с подробной информацией
app.get('/api/customers/all', async (req, res) => {
    try {
        const { sort = 'name', order = 'ASC' } = req.query;
        
        const validSorts = ['name', 'purchases', 'created_at', 'updated_at'];
        const validOrders = ['ASC', 'DESC'];
        
        const sortField = validSorts.includes(sort) ? sort : 'name';
        const sortOrder = validOrders.includes(order.toUpperCase()) ? order.toUpperCase() : 'ASC';
        
        const result = await pool.query(`
            SELECT 
                c.id,
                c.name,
                c.phone,
                c.purchases,
                c.created_at,
                c.updated_at,
                (SELECT MAX(timestamp) FROM purchase_history WHERE customer_id = c.id) as last_purchase,
                (SELECT COUNT(*) FROM purchase_history WHERE customer_id = c.id) as total_history_purchases
            FROM customers c
            ORDER BY ${sortField} ${sortOrder}
        `);
        
        const formattedCustomers = result.rows.map(customer => ({
            ...customer,
            created_at: customer.created_at ? new Date(customer.created_at).toLocaleDateString('ru-RU') : 'Не указано',
            updated_at: customer.updated_at ? new Date(customer.updated_at).toLocaleDateString('ru-RU') : 'Не указано',
            last_purchase: customer.last_purchase ? new Date(customer.last_purchase).toLocaleDateString('ru-RU') : null,
            status: customer.purchases >= 6 ? 'ready' : 'progress',
            total_history_purchases: parseInt(customer.total_history_purchases) || 0
        }));
        
        log.info(`Запрошен список всех клиентов (${formattedCustomers.length} клиентов)`);
        res.json(formattedCustomers);
        
    } catch (error) {
        log.error("Ошибка получения всех клиентов:", error.message);
        res.status(500).json({ error: 'Не удалось получить список клиентов.' });
    }
});

// --- Обработка ошибок ---
app.use((err, req, res, next) => {
    log.error('Необработанная ошибка:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

// --- Graceful shutdown ---
process.on('SIGINT', async () => {
    log.info('Получен сигнал SIGINT, закрытие сервера...');
    try {
        await pool.end();
        log.success('Подключения к базе данных закрыты.');
    } catch (error) {
        log.error('Ошибка закрытия подключений:', error.message);
    }
    process.exit(0);
});

// --- Инициализация и запуск сервера ---
async function startServer() {
    try {
        await initializeDatabase();
        
        app.listen(PORT, () => {
            log.success(`🚀 Сервер COFFEEMANIA запущен на http://localhost:${PORT}`);
            log.info(`📱 Панель бариста: http://localhost:${PORT}/admin.html`);
            log.info(`💾 База данных: PostgreSQL`);
        });
    } catch (error) {
        log.error('Ошибка запуска сервера:', error);
        process.exit(1);
    }
}

startServer(); 