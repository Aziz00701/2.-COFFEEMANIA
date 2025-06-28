const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const sqlite3 = require('sqlite3').verbose();
const QRCode = require('qrcode');
const { nanoid } = require('nanoid');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 1000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Database configuration - ОБНОВЛЕНО ДЛЯ SUPABASE
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    max: 5, // Уменьшено для Supabase free tier
    min: 1,
    idleTimeoutMillis: 20000, // Уменьшено для transaction mode
    connectionTimeoutMillis: 10000, // Увеличено для стабильности
    acquireTimeoutMillis: 60000,
    createTimeoutMillis: 30000,
    destroyTimeoutMillis: 5000,
    reapIntervalMillis: 1000,
    createRetryIntervalMillis: 200,
    // Дополнительные настройки для Supabase
    statement_timeout: 30000,
    query_timeout: 30000,
    application_name: 'COFFEEMANIA',
    // Для transaction mode pooler
    ...(process.env.DATABASE_URL && process.env.DATABASE_URL.includes(':6543') && {
        max: 3, // Меньше соединений для transaction mode
        idleTimeoutMillis: 1000,
    })
});

// Database type
let usePostgreSQL = false;
let db = null; // SQLite database instance

// Initialize database
async function initializeDatabase() {
    // Try PostgreSQL/Supabase first
    try {
        console.log('🔌 Подключение к базе данных...');
        
        // Detect database type from connection string
        const dbUrl = process.env.DATABASE_URL;
        let dbType = 'PostgreSQL';
        let poolMode = 'Direct';
        
        if (dbUrl) {
            if (dbUrl.includes('supabase.com')) {
                dbType = 'Supabase PostgreSQL';
                if (dbUrl.includes(':6543')) {
                    poolMode = 'Transaction Mode Pooler';
                } else if (dbUrl.includes(':5432') && dbUrl.includes('pooler')) {
                    poolMode = 'Session Mode Pooler';
                } else {
                    poolMode = 'Direct Connection';
                }
            } else if (dbUrl.includes('neon.tech')) {
                dbType = 'Neon PostgreSQL';
            }
        }
        
        // Test connection with detailed info
        const client = await pool.connect();
        const result = await client.query('SELECT version(), current_database(), current_user');
        const dbInfo = result.rows[0];
        client.release();
        
        console.log(`✅ ${dbType} подключен успешно`);
        console.log(`📊 Режим: ${poolMode}`);
        console.log(`🗄️ База: ${dbInfo.current_database}`);
        console.log(`👤 Пользователь: ${dbInfo.current_user}`);
        
        // Create tables if they don't exist (with better indexes for Supabase)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS customers (
                id VARCHAR(50) PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                phone VARCHAR(20) NOT NULL,
                purchases INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // Add index for faster phone searches
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone)
        `);
        
        await pool.query(`
            CREATE TABLE IF NOT EXISTS purchase_history (
                purchase_id SERIAL PRIMARY KEY,
                customer_id VARCHAR(50) REFERENCES customers(id) ON DELETE CASCADE,
                purchase_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                action VARCHAR(20) DEFAULT 'purchase'
            )
        `);
        
        // Add index for faster customer history lookups
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_purchase_history_customer_id ON purchase_history(customer_id)
        `);
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_purchase_history_date ON purchase_history(purchase_date)
        `);
        
        await pool.query(`
            CREATE TABLE IF NOT EXISTS settings (
                key VARCHAR(50) PRIMARY KEY,
                value TEXT,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // Add default barista phone if not exists
        await pool.query(`
            INSERT INTO settings (key, value) 
            VALUES ('barista_phone', $1) 
            ON CONFLICT (key) DO NOTHING
        `, [process.env.BARISTA_PHONE || '+7 (775) 455-55-70']);
        
        console.log('✅ Таблицы и индексы готовы');
        usePostgreSQL = true;
        
        // Check existing customers
        const customerCount = await pool.query('SELECT COUNT(*) as count FROM customers');
        const count = parseInt(customerCount.rows[0].count);
        
        if (count > 0) {
            console.log(`📊 Найдено ${count} клиентов в базе данных`);
        } else {
            console.log('📝 База данных пуста, готова к работе');
        }
        
        return;
    } catch (error) {
        if (process.env.NODE_ENV === 'production') {
            console.error('❌ PostgreSQL/Supabase подключение не удалось в продакшене:', error.message);
            console.error('🔧 Проверьте DATABASE_URL и убедитесь что используете правильный pooler mode');
            throw error; // В продакшене не должно быть fallback к SQLite
        }
        console.log('❌ PostgreSQL connection error:');
        console.log(`   ${error.message}`);
        console.log('🔄 Switching to SQLite database...');
    }
    
    // Fallback to SQLite
    try {
        const dbPath = path.join(__dirname, 'coffeemania.db');
        db = new sqlite3.Database(dbPath);
        
        // Create tables if they don't exist
        await new Promise((resolve, reject) => {
            db.serialize(() => {
                db.run(`
                    CREATE TABLE IF NOT EXISTS customers (
                        id TEXT PRIMARY KEY,
                        name TEXT NOT NULL,
                        phone TEXT NOT NULL,
                        purchases INTEGER DEFAULT 0,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                `, (err) => {
                    if (err) reject(err);
                });
                
                db.run(`
                    CREATE TABLE IF NOT EXISTS purchase_history (
                        purchase_id INTEGER PRIMARY KEY AUTOINCREMENT,
                        customer_id TEXT REFERENCES customers(id),
                        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                `, (err) => {
                    if (err) reject(err);
                });
                
                db.run(`
                    CREATE TABLE IF NOT EXISTS settings (
                        key TEXT PRIMARY KEY,
                        value TEXT
                    )
                `, (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
        });
        
        console.log('✅ SQLite database ready');
        console.log(`📁 Database file: ${dbPath}`);
        
        // Check if we need to create initial data
        const customerCount = await new Promise((resolve, reject) => {
            db.get('SELECT COUNT(*) as count FROM customers', (err, row) => {
                if (err) reject(err);
                else resolve(row.count);
            });
        });
        
        // Only create test data if database is empty
        if (customerCount === 0) {
            console.log('📝 Creating initial test customers...');
            await createTestCustomers();
        } else {
            console.log(`📊 Found ${customerCount} existing customers in database`);
        }
        
        usePostgreSQL = false;
    } catch (error) {
        console.error('❌ SQLite initialization error:', error);
        process.exit(1);
    }
}

// Create test customers for demo (only when database is empty)
async function createTestCustomers() {
    try {
        // Insert test customers
        await new Promise((resolve, reject) => {
            db.serialize(() => {
                const stmt = db.prepare('INSERT INTO customers (id, name, phone, purchases, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)');
                
                const now = new Date().toISOString();
                
                stmt.run('demo123', 'Тестовый клиент', '+7 (777) 123-45-67', 3, now, now);
                stmt.run('test456', 'Анна Иванова', '+7 (999) 888-77-66', 2, now, now);
                
                stmt.finalize((err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
        });
        
        // Insert purchase history
        await new Promise((resolve, reject) => {
            db.serialize(() => {
                const stmt = db.prepare('INSERT INTO purchase_history (customer_id, timestamp) VALUES (?, ?)');
                
                // History for demo123 (3 purchases)
                for (let i = 1; i <= 3; i++) {
                    const purchaseDate = new Date(Date.now() - (4-i) * 24 * 60 * 60 * 1000).toISOString();
                    stmt.run('demo123', purchaseDate);
                }
                
                // History for test456 (8 purchases = 1 completed card + 2 in new card)
                for (let i = 1; i <= 8; i++) {
                    const purchaseDate = new Date(Date.now() - (9-i) * 24 * 60 * 60 * 1000).toISOString();
                    stmt.run('test456', purchaseDate);
                }
                
                stmt.finalize((err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
        });
        
        // Insert settings
        await new Promise((resolve, reject) => {
            db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ['barista_phone', '+77754555570'], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
        
        console.log('✅ Test customers created:');
        console.log('   - demo123: Тестовый клиент (3/6 покупок в карточке #1)');
        console.log('   - test456: Анна Иванова (2/6 покупок в карточке #2, карточка #1 завершена)');
        console.log('🔗 Test links:');
        console.log(`   - http://localhost:${PORT}/card.html?id=demo123`);
        console.log(`   - http://localhost:${PORT}/card.html?id=test456`);
    } catch (error) {
        console.error('❌ Error creating test customers:', error);
    }
}

// Smart customer search with error correction
function findCustomerByIdSmart(customers, searchId) {
    if (!searchId || !customers) return null;
    
    // Прямой поиск (точное совпадение)
    let customer = customers.find(c => c.id === searchId);
    if (customer) return customer;
    
    // Поиск без учета регистра
    customer = customers.find(c => c.id.toLowerCase() === searchId.toLowerCase());
    if (customer) return customer;
    
    // Автоисправление распространенных ошибок
    const correctedId = searchId
        .replace(/O/gi, '0')    // O -> 0
        .replace(/I/gi, 'l')    // I -> l  
        .replace(/1/g, 'l')     // 1 -> l
        .replace(/S/gi, '5')    // S -> 5
        .replace(/G/gi, '6')    // G -> 6
        .replace(/B/gi, '8');   // B -> 8
    
    // Поиск с исправлениями
    customer = customers.find(c => c.id.toLowerCase() === correctedId.toLowerCase());
    if (customer) return customer;
    
    // Обратное исправление
    const reverseId = searchId
        .replace(/0/g, 'O')     // 0 -> O
        .replace(/l/gi, 'I')    // l -> I
        .replace(/5/g, 'S')     // 5 -> S
        .replace(/6/g, 'G')     // 6 -> G
        .replace(/8/g, 'B');    // 8 -> B
    
    customer = customers.find(c => c.id.toLowerCase() === reverseId.toLowerCase());
    if (customer) return customer;
    
    // Нечеткий поиск по схожести (Levenshtein distance <= 2)
    const similar = customers.find(c => {
        const distance = levenshteinDistance(searchId.toLowerCase(), c.id.toLowerCase());
        return distance <= 2;
    });
    
    return similar || null;
}

// Простая реализация расстояния Левенштейна
function levenshteinDistance(str1, str2) {
    const matrix = [];
    const len1 = str1.length;
    const len2 = str2.length;
    
    for (let i = 0; i <= len1; i++) {
        matrix[i] = [i];
    }
    
    for (let j = 0; j <= len2; j++) {
        matrix[0][j] = j;
    }
    
    for (let i = 1; i <= len1; i++) {
        for (let j = 1; j <= len2; j++) {
            if (str1.charAt(i - 1) === str2.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j] + 1
                );
            }
        }
    }
    
    return matrix[len1][len2];
}

// API Routes

// Get statistics
app.get('/api/stats', async (req, res) => {
    try {
        // Check if database is ready
        if (!usePostgreSQL && !db) {
            return res.status(503).json({ 
                error: 'Database not ready yet',
                retry: true 
            });
        }
        
        let totalCustomers, totalPurchases, readyForFreeCoffee;
        
        if (usePostgreSQL) {
            // PostgreSQL queries
            const totalCustomersResult = await pool.query('SELECT COUNT(*) FROM customers');
            totalCustomers = parseInt(totalCustomersResult.rows[0].count);

            const totalPurchasesResult = await pool.query('SELECT SUM(purchases) FROM customers');
            totalPurchases = parseInt(totalPurchasesResult.rows[0].sum) || 0;

            const readyResult = await pool.query('SELECT COUNT(*) FROM customers WHERE purchases >= 6');
            readyForFreeCoffee = parseInt(readyResult.rows[0].count);
        } else {
            // SQLite queries with null check
            if (!db) {
                return res.status(503).json({ 
                    error: 'SQLite database not initialized',
                    retry: true 
                });
            }
            
            const totalCustomersResult = await new Promise((resolve, reject) => {
                db.get('SELECT COUNT(*) as count FROM customers', (err, row) => {
                    if (err) reject(err);
                    else resolve(row.count);
                });
            });
            totalCustomers = totalCustomersResult;

            const totalPurchasesResult = await new Promise((resolve, reject) => {
                db.get('SELECT SUM(purchases) as sum FROM customers', (err, row) => {
                    if (err) reject(err);
                    else resolve(row.sum || 0);
                });
            });
            totalPurchases = totalPurchasesResult;

            const readyResult = await new Promise((resolve, reject) => {
                db.get('SELECT COUNT(*) as count FROM customers WHERE purchases >= 6', (err, row) => {
                    if (err) reject(err);
                    else resolve(row.count);
                });
            });
            readyForFreeCoffee = readyResult;
        }

        res.json({
            totalCustomers,
            totalPurchases,
            readyForFreeCoffee
        });
    } catch (error) {
        console.error('Stats error:', error);
        res.status(500).json({ error: 'Failed to get statistics' });
    }
});

// Register new customer
app.post('/api/register', async (req, res) => {
    try {
        const { name, phone } = req.body;
        
        if (!name || !phone) {
            return res.status(400).json({ error: 'Name and phone are required' });
        }

        const customerId = nanoid(10);
        
        if (usePostgreSQL) {
            // PostgreSQL
            await pool.query(
                'INSERT INTO customers (id, name, phone) VALUES ($1, $2, $3)',
                [customerId, name, phone]
            );
            
            res.json({ 
                success: true, 
                customerId,
                message: 'Customer registered successfully' 
            });
        } else {
            // SQLite
            await new Promise((resolve, reject) => {
                db.run('INSERT INTO customers (id, name, phone, purchases, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, phone = excluded.phone, purchases = excluded.purchases, updated_at = excluded.updated_at', [customerId, name, phone, 0, new Date().toISOString(), new Date().toISOString()], (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
            
            res.json({ 
                success: true, 
                customerId,
                message: 'Customer registered successfully' 
            });
        }
    } catch (error) {
        console.error('Registration error:', error);
        if (error.code === '23505') { // PostgreSQL unique constraint
            res.status(400).json({ error: 'Клиент с таким номером уже существует' });
        } else {
            res.status(500).json({ error: 'Failed to register customer' });
        }
    }
});

// Search customers
app.get('/api/search', async (req, res) => {
    try {
        const { q } = req.query;
        
        if (!q || q.length < 2) {
            return res.json([]);
        }

        let customers;
        
        if (usePostgreSQL) {
            // PostgreSQL
            const result = await pool.query(
                'SELECT * FROM customers WHERE name ILIKE $1 OR phone ILIKE $1 ORDER BY created_at DESC',
                [`%${q}%`]
            );
            customers = result.rows;
        } else {
            // SQLite
            customers = await new Promise((resolve, reject) => {
                db.all('SELECT * FROM customers WHERE name LIKE ? OR phone LIKE ? ORDER BY created_at DESC', [q, q], (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                });
            });
        }

        res.json(customers);
    } catch (error) {
        console.error('Search error:', error);
        res.status(500).json({ error: 'Search failed' });
    }
});

// Get all customers
app.get('/api/customers', async (req, res) => {
    try {
        let customers;
        
        if (usePostgreSQL) {
            // PostgreSQL
            const result = await pool.query('SELECT * FROM customers ORDER BY created_at DESC');
            customers = result.rows;
        } else {
            // SQLite
            customers = await new Promise((resolve, reject) => {
                db.all('SELECT * FROM customers ORDER BY created_at DESC', [], (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                });
            });
        }

        res.json(customers);
    } catch (error) {
        console.error('Get customers error:', error);
        res.status(500).json({ error: 'Failed to get customers' });
    }
});

// Get customer by ID
app.get('/api/customer/:id', async (req, res) => {
    try {
        const { id } = req.params;
        let customers, foundCustomer;
        
        if (usePostgreSQL) {
            // PostgreSQL - получаем всех клиентов для умного поиска
            const result = await pool.query('SELECT * FROM customers');
            customers = result.rows;
            foundCustomer = findCustomerByIdSmart(customers, id);
        } else {
            // SQLite - получаем всех клиентов для умного поиска
            customers = await new Promise((resolve, reject) => {
                db.all('SELECT * FROM customers', [], (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                });
            });
            foundCustomer = findCustomerByIdSmart(customers, id);
        }

        if (!foundCustomer) {
            return res.status(404).json({ 
                error: 'Customer not found',
                suggestion: `Проверьте правильность ID "${id}". Возможные проблемы: регистр букв, похожие символы (0/O, l/I, 1/l)`
            });
        }

        // Логируем если ID был исправлен
        if (foundCustomer.id !== id) {
            console.log(`🔧 ID исправлен: "${id}" -> "${foundCustomer.id}"`);
        }

        res.json(foundCustomer);
    } catch (error) {
        console.error('Get customer error:', error);
        res.status(500).json({ error: 'Failed to get customer' });
    }
});

// Add purchase
app.post('/api/purchase/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        // Сначала получаем текущее количество покупок
        let customer;
        if (usePostgreSQL) {
            const result = await pool.query('SELECT * FROM customers WHERE id = $1', [id]);
            customer = result.rows[0];
        } else {
            customer = await new Promise((resolve, reject) => {
                db.get('SELECT * FROM customers WHERE id = ?', [id], (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                });
            });
        }
        
        if (!customer) {
            return res.status(404).json({ error: 'Customer not found' });
        }
        
        const currentPurchases = customer.purchases;
        let newPurchases;
        let isComplete = false;
        let isFreeDelivery = false;
        
        // ИСПРАВЛЕНО: Правильная логика для бесплатного кофе
        if (currentPurchases >= 6) {
            // Выдача бесплатного кофе - сбрасываем счетчик в 0 (НЕ в 1!)
            newPurchases = 0;
            isFreeDelivery = true;
            isComplete = false;
        } else {
            // Обычная покупка - увеличиваем счетчик
            newPurchases = currentPurchases + 1;
            if (newPurchases >= 6) {
                isComplete = true; // Готов к получению бесплатного кофе
            }
        }
        
        if (usePostgreSQL) {
            // PostgreSQL
            await pool.query('BEGIN');
            
            // Обновляем счетчик покупок
            await pool.query(
                'UPDATE customers SET purchases = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
                [newPurchases, id]
            );
            
            // Записываем в историю ТОЛЬКО реальные покупки (НЕ бесплатный кофе)
            if (!isFreeDelivery) {
                await pool.query(
                    'INSERT INTO purchase_history (customer_id, action) VALUES ($1, $2)',
                    [id, 'purchase']
                );
            }
            
            await pool.query('COMMIT');
        } else {
            // SQLite
            await new Promise((resolve, reject) => {
                db.serialize(() => {
                    db.run('BEGIN TRANSACTION');
                    
                    db.run(
                        'UPDATE customers SET purchases = ?, updated_at = ? WHERE id = ?',
                        [newPurchases, new Date().toISOString(), id],
                        (err) => {
                            if (err) {
                                db.run('ROLLBACK');
                                reject(err);
                                return;
                            }
                        }
                    );
                    
                    // Записываем в историю ТОЛЬКО реальные покупки (НЕ бесплатный кофе)
                    if (!isFreeDelivery) {
                        db.run(
                            'INSERT INTO purchase_history (customer_id, timestamp) VALUES (?, ?)',
                            [id, new Date().toISOString()],
                            (err) => {
                                if (err) {
                                    db.run('ROLLBACK');
                                    reject(err);
                                    return;
                                }
                                
                                db.run('COMMIT', (err) => {
                                    if (err) reject(err);
                                    else resolve();
                                });
                            }
                        );
                    } else {
                        // Для бесплатного кофе просто коммитим без записи в историю
                        db.run('COMMIT', (err) => {
                            if (err) reject(err);
                            else resolve();
                        });
                    }
                });
            });
        }
        
        res.json({ 
            success: true, 
            message: isFreeDelivery ? 
                '🎉 Бесплатный кофе выдан! Новая карта начинается с 0.' : 
                `✅ Покупка добавлена! Прогресс: ${newPurchases}/6`,
            newPurchases: newPurchases,
            isComplete: isComplete,
            isFreeDelivery: isFreeDelivery,
            totalCards: Math.floor((customer.purchases + (!isFreeDelivery ? 1 : 0)) / 7) + 1
        });
    } catch (error) {
        console.error('Add purchase error:', error);
        if (usePostgreSQL) {
            await pool.query('ROLLBACK');
        } else {
            db.run('ROLLBACK');
        }
        res.status(500).json({ error: 'Failed to add purchase' });
    }
});

// Update customer
app.put('/api/customer/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { name, phone } = req.body;
        
        if (usePostgreSQL) {
            // PostgreSQL
            await pool.query(
                'UPDATE customers SET name = $1, phone = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3',
                [name, phone, id]
            );
        } else {
            // SQLite
            await new Promise((resolve, reject) => {
                db.run(
                    'UPDATE customers SET name = ?, phone = ?, updated_at = ? WHERE id = ?',
                    [name, phone, new Date().toISOString(), id],
                    (err) => {
                        if (err) reject(err);
                        else resolve();
                    }
                );
            });
        }
        
        res.json({ success: true, message: 'Customer updated successfully' });
    } catch (error) {
        console.error('Update customer error:', error);
        res.status(500).json({ error: 'Failed to update customer' });
    }
});

// Delete customer
app.delete('/api/customer/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        if (usePostgreSQL) {
            // PostgreSQL
            await pool.query('DELETE FROM customers WHERE id = $1', [id]);
        } else {
            // SQLite
            await new Promise((resolve, reject) => {
                db.run('DELETE FROM customers WHERE id = ?', [id], (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
        }
        
        res.json({ success: true, message: 'Customer deleted successfully' });
    } catch (error) {
        console.error('Delete customer error:', error);
        res.status(500).json({ error: 'Failed to delete customer' });
    }
});

// Get purchase history
app.get('/api/history/:id', async (req, res) => {
    try {
        const { id } = req.params;
        let history;
        
        if (usePostgreSQL) {
            // PostgreSQL
            const result = await pool.query(
                'SELECT *, purchase_date, action FROM purchase_history WHERE customer_id = $1 ORDER BY purchase_date ASC',
                [id]
            );
            history = result.rows.map(row => ({
                ...row,
                purchase_date: row.purchase_date,
                action: row.action || 'purchase'
            }));
        } else {
            // SQLite
            history = await new Promise((resolve, reject) => {
                db.all(
                    'SELECT * FROM purchase_history WHERE customer_id = ? ORDER BY timestamp ASC',
                    [id],
                    (err, rows) => {
                        if (err) reject(err);
                        else {
                            const mapped = rows.map(row => ({
                                ...row,
                                purchase_date: row.timestamp,
                                action: 'purchase'
                            }));
                            resolve(mapped);
                        }
                    }
                );
            });
        }

        res.json(history);
    } catch (error) {
        console.error('Get history error:', error);
        res.status(500).json({ error: 'Failed to get purchase history' });
    }
});

// Reset customer purchases
app.post('/api/customer/:id/reset', async (req, res) => {
    try {
        const { id } = req.params;
        
        if (usePostgreSQL) {
            // PostgreSQL
            await pool.query(
                'UPDATE customers SET purchases = 0, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
                [id]
            );
        } else {
            // SQLite
            await new Promise((resolve, reject) => {
                db.run('UPDATE customers SET purchases = 0, updated_at = ? WHERE id = ?', [new Date().toISOString(), id], (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
        }
        
        res.json({ success: true, message: 'Customer purchases reset successfully' });
    } catch (error) {
        console.error('Reset customer error:', error);
        res.status(500).json({ error: 'Failed to reset customer purchases' });
    }
});

// Generate QR code
app.get('/api/qr/:id', async (req, res) => {
    try {
        const { id } = req.params;
        let customers, foundCustomer;
        
        // ИСПРАВЛЕНО: Используем умный поиск для получения корректного ID
        if (usePostgreSQL) {
            const result = await pool.query('SELECT * FROM customers');
            customers = result.rows;
            foundCustomer = findCustomerByIdSmart(customers, id);
        } else {
            customers = await new Promise((resolve, reject) => {
                db.all('SELECT * FROM customers', [], (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                });
            });
            foundCustomer = findCustomerByIdSmart(customers, id);
        }

        if (!foundCustomer) {
            return res.status(404).json({ 
                error: 'Customer not found',
                suggestion: `Проверьте правильность ID "${id}" для генерации QR кода`
            });
        }

        // ИСПРАВЛЕНО: Используем корректный ID для генерации ссылки в QR коде
        const correctId = foundCustomer.id;
        const cardUrl = `${req.protocol}://${req.get('host')}/card.html?id=${correctId}`;
        
        // Логируем если ID был исправлен
        if (correctId !== id) {
            console.log(`🔧 ID исправлен для QR кода: "${id}" -> "${correctId}"`);
        }
        
        const qrCode = await QRCode.toDataURL(cardUrl, {
            width: 300,
            margin: 2,
            color: {
                dark: '#000000',
                light: '#FFFFFF'
            }
        });
        
        res.json({ 
            qrCode, 
            url: cardUrl,
            originalId: id,
            correctedId: correctId,
            corrected: correctId !== id
        });
    } catch (error) {
        console.error('QR generation error:', error);
        res.status(500).json({ error: 'Failed to generate QR code' });
    }
});

// Generate secure client app link
app.get('/api/client-link/:id', async (req, res) => {
    try {
        const { id } = req.params;
        let customers, foundCustomer;
        
        // ИСПРАВЛЕНО: Используем умный поиск для получения корректного клиента
        if (usePostgreSQL) {
            const result = await pool.query('SELECT * FROM customers');
            customers = result.rows;
            foundCustomer = findCustomerByIdSmart(customers, id);
        } else {
            customers = await new Promise((resolve, reject) => {
                db.all('SELECT * FROM customers', [], (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                });
            });
            foundCustomer = findCustomerByIdSmart(customers, id);
        }
        
        if (!foundCustomer) {
            return res.status(404).json({ 
                error: 'Customer not found',
                suggestion: `Проверьте правильность ID "${id}" для генерации ссылки`
            });
        }
        
        // ИСПРАВЛЕНО: Используем корректный ID для генерации ссылки
        const correctId = foundCustomer.id;
        const clientAppUrl = `${req.protocol}://${req.get('host')}/card.html?id=${correctId}`;
        
        // Логируем если ID был исправлен
        if (correctId !== id) {
            console.log(`🔧 ID исправлен для client-link: "${id}" -> "${correctId}"`);
        }
        
        res.json({ 
            url: clientAppUrl,
            customer: foundCustomer,
            originalId: id,
            correctedId: correctId,
            corrected: correctId !== id,
            message: 'Secure client app link generated' 
        });
    } catch (error) {
        console.error('Client link generation error:', error);
        res.status(500).json({ error: 'Failed to generate client link' });
    }
});

// Get barista phone
app.get('/api/barista-phone', async (req, res) => {
    try {
        let phone;
        
        if (usePostgreSQL) {
            // PostgreSQL
            const result = await pool.query('SELECT value FROM settings WHERE key = $1', ['barista_phone']);
            phone = result.rows[0]?.value || '+7 (999) 123-45-67';
        } else {
            // SQLite
            phone = await new Promise((resolve, reject) => {
                db.get('SELECT value FROM settings WHERE key = ?', ['barista_phone'], (err, row) => {
                    if (err) reject(err);
                    else resolve(row.value || '+7 (999) 123-45-67');
                });
            });
        }

        res.json({ phone });
    } catch (error) {
        console.error('Get barista phone error:', error);
        res.json({ phone: '+7 (999) 123-45-67' });
    }
});

// Update barista phone
app.post('/api/barista-phone', async (req, res) => {
    try {
        const { phone } = req.body;
        
        if (usePostgreSQL) {
            // PostgreSQL
            await pool.query(
                'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2',
                ['barista_phone', phone]
            );
        } else {
            // SQLite
            await new Promise((resolve, reject) => {
                db.run('UPDATE settings SET value = ? WHERE key = ?', [phone, 'barista_phone'], (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
        }
        
        res.json({ success: true, message: 'Phone updated successfully' });
    } catch (error) {
        console.error('Update barista phone error:', error);
        res.status(500).json({ error: 'Failed to update phone' });
    }
});

// Clean duplicate purchase history records (admin only)
app.post('/api/cleanup-duplicates', async (req, res) => {
    try {
        console.log('🧹 Начинаем очистку дублирующихся записей...');
        
        if (usePostgreSQL) {
            // PostgreSQL cleanup
            await pool.query('BEGIN');
            
            // Удаляем дублирующиеся записи, оставляя только самую раннюю для каждого клиента и времени
            const cleanupResult = await pool.query(`
                DELETE FROM purchase_history 
                WHERE purchase_id NOT IN (
                    SELECT MIN(purchase_id) 
                    FROM purchase_history 
                    GROUP BY customer_id, DATE_TRUNC('minute', timestamp)
                )
            `);
            
            await pool.query('COMMIT');
            
            console.log(`✅ Удалено ${cleanupResult.rowCount} дублирующихся записей`);
            res.json({ 
                success: true, 
                message: `Очистка завершена. Удалено ${cleanupResult.rowCount} дублей.`,
                deleted: cleanupResult.rowCount
            });
            
        } else {
            // SQLite cleanup
            const duplicates = await new Promise((resolve, reject) => {
                db.all(`
                    SELECT customer_id, 
                           strftime('%Y-%m-%d %H:%M', timestamp) as minute_group,
                           COUNT(*) as count,
                           MIN(purchase_id) as keep_id
                    FROM purchase_history 
                    GROUP BY customer_id, minute_group
                    HAVING COUNT(*) > 1
                `, [], (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                });
            });
            
            let totalDeleted = 0;
            
            for (const group of duplicates) {
                const deleted = await new Promise((resolve, reject) => {
                    db.run(`
                        DELETE FROM purchase_history 
                        WHERE customer_id = ? 
                        AND strftime('%Y-%m-%d %H:%M', timestamp) = ?
                        AND purchase_id != ?
                    `, [group.customer_id, group.minute_group, group.keep_id], function(err) {
                        if (err) reject(err);
                        else resolve(this.changes);
                    });
                });
                totalDeleted += deleted;
            }
            
            console.log(`✅ Удалено ${totalDeleted} дублирующихся записей`);
            res.json({ 
                success: true, 
                message: `Очистка завершена. Удалено ${totalDeleted} дублей.`,
                deleted: totalDeleted
            });
        }
        
    } catch (error) {
        if (usePostgreSQL) {
            await pool.query('ROLLBACK');
        }
        console.error('❌ Ошибка очистки дублей:', error);
        res.status(500).json({ error: 'Ошибка очистки дублей' });
    }
});

// Serve admin manifest
app.get('/admin-manifest.json', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin-manifest.json'));
});

// Serve personalized client manifest
app.get('/manifest-:clientId.json', async (req, res) => {
    try {
        const { clientId } = req.params;
        
        // Проверяем что клиент существует
        let customers, foundCustomer;
        
        if (usePostgreSQL) {
            const result = await pool.query('SELECT * FROM customers');
            customers = result.rows;
            foundCustomer = findCustomerByIdSmart(customers, clientId);
        } else {
            customers = await new Promise((resolve, reject) => {
                db.all('SELECT * FROM customers', [], (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                });
            });
            foundCustomer = findCustomerByIdSmart(customers, clientId);
        }
        
        if (!foundCustomer) {
            return res.status(404).json({ error: 'Client not found' });
        }
        
        // Генерируем персональный манифест
        const personalManifest = {
            "name": `COFFEEMANIA - ${foundCustomer.name}`,
            "short_name": "COFFEEMANIA",
            "description": `Персональная карта лояльности ${foundCustomer.name} в COFFEEMANIA`,
            "start_url": `/card.html?id=${foundCustomer.id}`,
            "display": "standalone",
            "background_color": "#0F0C29",
            "theme_color": "#0F0C29",
            "orientation": "portrait",
            "categories": ["food", "lifestyle"],
            "lang": "ru",
            "scope": "/card.html",
            "icons": [
                {
                    "src": "/icon-192.png",
                    "sizes": "192x192",
                    "type": "image/png",
                    "purpose": "any maskable"
                },
                {
                    "src": "/icon-512.png",
                    "sizes": "512x512",
                    "type": "image/png",
                    "purpose": "any maskable"
                }
            ]
        };
        
        res.json(personalManifest);
        
    } catch (error) {
        console.error('Personal manifest error:', error);
        res.status(500).json({ error: 'Failed to generate personal manifest' });
    }
});

// Serve client router for PWA
app.get('/client.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'client.html'));
});

// Serve main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
async function startServer() {
    try {
        await initializeDatabase();
        
        app.listen(PORT, () => {
            console.log(`🚀 COFFEEMANIA server running on port ${PORT}`);
            console.log(`📱 Admin panel: http://localhost:${PORT}/admin.html`);
            console.log(`☕ Main page: http://localhost:${PORT}`);
            console.log(`📷 Для работы камеры используйте LOCALHOST: http://localhost:${PORT}/admin.html`);
        });
    } catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
}

startServer();

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n🛑 Получен сигнал завершения...');
    try {
        if (usePostgreSQL) {
            await pool.end();
            console.log('👋 PostgreSQL connection closed');
        } else if (db) {
            db.close((err) => {
                if (err) {
                    console.error('❌ Error closing SQLite database:', err);
                } else {
                    console.log('👋 SQLite database closed');
                }
            });
        }
    } catch (error) {
        console.error('❌ Error during shutdown:', error);
    }
    process.exit(0);
}); 