const express = require('express');
const { Pool } = require('pg');
const { nanoid } = require('nanoid');
const QRCode = require('qrcode');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

// Подключение к PostgreSQL
const connectionString = process.env.DATABASE_URL || 'postgresql://coffeemania_db_user:H9eKkNMYufnRZsMlfmc4NokQhMcGCE3K@dpg-d1c2soer433s7381rgfg-a.frankfurt-postgres.render.com/coffeemania_db';

const pool = new Pool({
    connectionString: connectionString,
    ssl: { rejectUnauthorized: false }
});

// Логирование
const log = {
    info: (msg, ...args) => console.log(`ℹ️  ${new Date().toISOString()} - ${msg}`, ...args),
    error: (msg, ...args) => console.error(`❌ ${new Date().toISOString()} - ${msg}`, ...args),
    success: (msg, ...args) => console.log(`✅ ${new Date().toISOString()} - ${msg}`, ...args),
    warn: (msg, ...args) => console.warn(`⚠️  ${new Date().toISOString()} - ${msg}`, ...args)
};

// Инициализация базы данных
async function initializeDatabase() {
    try {
        log.info('Подключение к PostgreSQL...');
        
        const client = await pool.connect();
        log.success('Успешное подключение к PostgreSQL');
        client.release();

        // Создание таблицы клиентов (если не существует)
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
        log.info('Таблица customers проверена/создана');

        // Создание таблицы истории покупок (если не существует)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS purchase_history (
                id SERIAL PRIMARY KEY,
                customer_id TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
            )
        `);
        log.info('Таблица purchase_history проверена/создана');

        const result = await pool.query('SELECT COUNT(*) as count FROM customers');
        log.info(`В базе зарегистрировано клиентов: ${result.rows[0].count}`);

    } catch (error) {
        log.error('Ошибка инициализации базы данных:', error.message);
        process.exit(1);
    }
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use((req, res, next) => {
    if (req.path.startsWith('/api/')) {
        log.info(`${req.method} ${req.path}`);
    }
    next();
});

// API Routes

// 1. Регистрация клиента
app.post('/api/register', async (req, res) => {
    const client = await pool.connect();
    try {
        const { name, phone } = req.body;
        
        if (!name || !phone) {
            return res.status(400).json({ error: 'Имя и телефон обязательны' });
        }

        if (name.length < 2) {
            return res.status(400).json({ error: 'Имя должно содержать минимум 2 символа' });
        }

        const id = nanoid(10);
        
        await client.query('BEGIN');
        
        await client.query(
            'INSERT INTO customers (id, name, phone, purchases) VALUES ($1, $2, $3, 0)',
            [id, name, phone]
        );
        
        await client.query('COMMIT');
        
        const customerUrl = `${req.protocol}://${req.get('host')}/card.html?id=${id}`;
        
        log.success(`Новый клиент: ${name} (${phone}) - ID: ${id}`);
        
        res.status(201).json({ 
            message: 'Клиент зарегистрирован!',
            customerId: id,
            customerUrl,
            customer: { id, name, phone, purchases: 0 }
        });
        
    } catch (error) {
        await client.query('ROLLBACK');
        if (error.constraint === 'customers_phone_key') {
            return res.status(409).json({ error: 'Клиент с таким номером уже существует' });
        }
        log.error("Ошибка регистрации:", error.message);
        res.status(500).json({ error: 'Ошибка регистрации клиента' });
    } finally {
        client.release();
    }
});

// 2. Поиск клиентов
app.get('/api/search', async (req, res) => {
    try {
        const { q } = req.query;
        
        if (!q || q.length < 2) {
            return res.json([]);
        }

        const result = await pool.query(
            'SELECT id, name, phone, purchases, created_at FROM customers WHERE name ILIKE $1 OR phone LIKE $2 ORDER BY name ASC LIMIT 20',
            [`%${q}%`, `%${q}%`]
        );
        
        res.json(result.rows);
        
    } catch (error) {
        log.error("Ошибка поиска:", error.message);
        res.status(500).json({ error: 'Ошибка поиска' });
    }
});

// 3. Получение всех клиентов
app.get('/api/customers', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, name, phone, purchases, created_at FROM customers ORDER BY created_at DESC'
        );
        
        res.json(result.rows);
        
    } catch (error) {
        log.error("Ошибка загрузки клиентов:", error.message);
        res.status(500).json({ error: 'Ошибка загрузки клиентов' });
    }
});

// 4. Получение данных клиента
app.get('/api/customer/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        const result = await pool.query(
            'SELECT id, name, phone, purchases, created_at FROM customers WHERE id = $1',
            [id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Клиент не найден' });
        }
        
        res.json(result.rows[0]);
        
    } catch (error) {
        log.error("Ошибка получения клиента:", error.message);
        res.status(500).json({ error: 'Ошибка получения данных клиента' });
    }
});

// 5. Добавление покупки
app.post('/api/purchase/:customerId', async (req, res) => {
    const client = await pool.connect();
    try {
        const { customerId } = req.params;
        
        if (!customerId) {
            return res.status(400).json({ error: 'ID клиента обязателен' });
        }

        await client.query('BEGIN');

        const customerResult = await client.query(
            'SELECT id, name, phone, purchases FROM customers WHERE id = $1',
            [customerId]
        );

        if (customerResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Клиент не найден' });
        }

        const customer = customerResult.rows[0];
        let currentPurchases = customer.purchases;
        let newPurchases;
        let isComplete = false;

        if (currentPurchases >= 6) {
            // Сброс после получения бесплатного кофе
            newPurchases = 1;
            isComplete = true;
        } else {
            newPurchases = currentPurchases + 1;
            if (newPurchases === 6) {
                isComplete = true;
            }
        }
        
        await client.query(
            'UPDATE customers SET purchases = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
            [newPurchases, customerId]
        );
        
        // Добавляем запись в историю
        await client.query(
            'INSERT INTO purchase_history (customer_id) VALUES ($1)',
            [customerId]
        );
        
        await client.query('COMMIT');
        
        log.success(`Покупка: ${customer.name} (${currentPurchases} → ${newPurchases})`);
        
        res.json({ 
            customer: { ...customer, purchases: newPurchases },
            newPurchases,
            isComplete
        });
        
    } catch (error) {
        await client.query('ROLLBACK');
        log.error("Ошибка добавления покупки:", error.message);
        res.status(500).json({ error: 'Не удалось добавить покупку' });
    } finally {
        client.release();
    }
});

// 6. История покупок
app.get('/api/history/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        const [customerResult, historyResult] = await Promise.all([
            pool.query('SELECT id, name, phone, purchases FROM customers WHERE id = $1', [id]),
            pool.query('SELECT created_at FROM purchase_history WHERE customer_id = $1 ORDER BY created_at ASC', [id])
        ]);
        
        if (customerResult.rows.length === 0) {
            return res.status(404).json({ error: 'Клиент не найден' });
        }
        
        res.json({
            customer: customerResult.rows[0],
            history: historyResult.rows
        });
        
    } catch (error) {
        log.error("Ошибка получения истории:", error.message);
        res.status(500).json({ error: 'Ошибка получения истории' });
    }
});

// 7. QR код клиента
app.get('/api/qr/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        const result = await pool.query('SELECT id FROM customers WHERE id = $1', [id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Клиент не найден' });
        }
        
        const customerUrl = `${req.protocol}://${req.get('host')}/card.html?id=${id}`;
        const qrCodeBuffer = await QRCode.toBuffer(customerUrl, {
            type: 'png',
            width: 256,
            margin: 1
        });
        
        res.setHeader('Content-Type', 'image/png');
        res.send(qrCodeBuffer);
        
    } catch (error) {
        log.error('Ошибка QR:', error);
        res.status(500).json({ error: 'Ошибка генерации QR' });
    }
});

// 8. Удаление клиента
app.delete('/api/customer/:id', async (req, res) => {
    const client = await pool.connect();
    try {
        const { id } = req.params;

        await client.query('BEGIN');

        const customerResult = await client.query('SELECT name FROM customers WHERE id = $1', [id]);

        if (customerResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Клиент не найден' });
        }

        const customerName = customerResult.rows[0].name;

        await client.query('DELETE FROM purchase_history WHERE customer_id = $1', [id]);
        await client.query('DELETE FROM customers WHERE id = $1', [id]);

        await client.query('COMMIT');
        
        log.success(`Клиент удален: ${customerName}`);
        res.json({ message: 'Клиент удален' });
        
    } catch (error) {
        await client.query('ROLLBACK');
        log.error("Ошибка удаления:", error.message);
        res.status(500).json({ error: 'Ошибка удаления клиента' });
    } finally {
        client.release();
    }
});

// 9. Статистика
app.get('/api/stats', async (req, res) => {
    try {
        const [customersResult, purchasesResult, readyResult] = await Promise.all([
            pool.query('SELECT COUNT(*) as total FROM customers'),
            pool.query('SELECT COUNT(*) as total FROM purchase_history'),
            pool.query('SELECT COUNT(*) as ready FROM customers WHERE purchases >= 6')
        ]);

        const stats = {
            totalCustomers: parseInt(customersResult.rows[0].total),
            totalPurchases: parseInt(purchasesResult.rows[0].total),
            readyForFreeCoffee: parseInt(readyResult.rows[0].ready)
        };

        res.json(stats);
        
    } catch (error) {
        log.error('Ошибка получения статистики:', error);
        res.status(500).json({ error: 'Ошибка получения статистики' });
    }
});

// Главная страница - редирект на админ панель
app.get('/', (req, res) => {
    res.redirect('/admin.html');
});

// Обработка ошибок
app.use((err, req, res, next) => {
    log.error('Ошибка:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

// Graceful shutdown
process.on('SIGINT', async () => {
    log.info('Закрытие сервера...');
    try {
        await pool.end();
        log.success('База данных закрыта');
    } catch (error) {
        log.error('Ошибка закрытия:', error.message);
    }
    process.exit(0);
});

// Запуск сервера
async function startServer() {
    try {
        await initializeDatabase();
        
        app.listen(PORT, () => {
            log.success(`🚀 COFFEEMANIA сервер запущен на порту ${PORT}`);
            log.info(`📱 Админ панель: http://localhost:${PORT}/admin.html`);
        });
    } catch (error) {
        log.error('Ошибка запуска:', error);
        process.exit(1);
    }
}

startServer(); 