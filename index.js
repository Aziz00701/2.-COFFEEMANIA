const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { nanoid } = require('nanoid');
const QRCode = require('qrcode');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = './coffeemania.db';

// --- Логирование ---
const log = {
    info: (msg, ...args) => console.log(`ℹ️  ${new Date().toISOString()} - ${msg}`, ...args),
    error: (msg, ...args) => console.error(`❌ ${new Date().toISOString()} - ${msg}`, ...args),
    success: (msg, ...args) => console.log(`✅ ${new Date().toISOString()} - ${msg}`, ...args),
    warn: (msg, ...args) => console.warn(`⚠️  ${new Date().toISOString()} - ${msg}`, ...args)
};

// --- Database Setup ---
const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        log.error("Ошибка подключения к базе данных:", err.message);
        process.exit(1);
    } else {
        log.success("Успешное подключение к базе данных SQLite");
        initializeDatabase();
    }
});

function initializeDatabase() {
    db.serialize(() => {
        // Создание таблицы клиентов
        db.run(`CREATE TABLE IF NOT EXISTS customers (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            phone TEXT NOT NULL UNIQUE,
            purchases INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`, (err) => {
            if (err) {
                log.error("Ошибка создания таблицы customers:", err);
            } else {
                log.info("Таблица customers готова");
                
                // Проверяем и добавляем недостающие колонки (миграция)
                db.all("PRAGMA table_info(customers)", [], (err, columns) => {
                    if (!err && columns) {
                        const columnNames = columns.map(col => col.name);
                        
                        if (!columnNames.includes('created_at')) {
                            db.run(`ALTER TABLE customers ADD COLUMN created_at DATETIME`, (err) => {
                                if (err) {
                                    log.error("Ошибка добавления колонки created_at:", err);
                                } else {
                                    log.success("Добавлена колонка created_at");
                                    // Заполняем существующие записи текущей датой
                                    db.run(`UPDATE customers SET created_at = CURRENT_TIMESTAMP WHERE created_at IS NULL`, (updateErr) => {
                                        if (updateErr) {
                                            log.error("Ошибка обновления created_at:", updateErr);
                                        } else {
                                            log.success("Обновлены даты создания для существующих клиентов");
                                        }
                                    });
                                }
                            });
                        }
                        
                        if (!columnNames.includes('updated_at')) {
                            db.run(`ALTER TABLE customers ADD COLUMN updated_at DATETIME`, (err) => {
                                if (err) {
                                    log.error("Ошибка добавления колонки updated_at:", err);
                                } else {
                                    log.success("Добавлена колонка updated_at");
                                    // Заполняем существующие записи текущей датой
                                    db.run(`UPDATE customers SET updated_at = CURRENT_TIMESTAMP WHERE updated_at IS NULL`, (updateErr) => {
                                        if (updateErr) {
                                            log.error("Ошибка обновления updated_at:", updateErr);
                                        } else {
                                            log.success("Обновлены даты обновления для существующих клиентов");
                                        }
                                    });
                                }
                            });
                        }
                    }
                });
            }
        });

        // Создание таблицы истории покупок
        db.run(`CREATE TABLE IF NOT EXISTS purchase_history (
            purchase_id INTEGER PRIMARY KEY AUTOINCREMENT,
            customer_id TEXT NOT NULL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (customer_id) REFERENCES customers(id)
        )`, (err) => {
            if (err) {
                log.error("Ошибка создания таблицы purchase_history:", err);
            } else {
                log.info("Таблица purchase_history готова");
            }
        });

        // Получение статистики
        db.get("SELECT COUNT(*) as count FROM customers", (err, row) => {
            if (!err && row) {
                log.info(`В базе зарегистрировано клиентов: ${row.count}`);
            }
        });
    });
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
    const sql = `INSERT INTO customers (id, name, phone, purchases) VALUES (?, ?, ?, 0)`;

    db.run(sql, [id, name, phone], async function(err) {
        if (err) {
            if (err.message.includes('UNIQUE constraint failed')) {
                log.warn(`Попытка регистрации существующего номера: ${phone}`);
                return res.status(409).json({ error: 'Клиент с таким номером телефона уже зарегистрирован.' });
            }
            log.error("Ошибка регистрации клиента:", err.message);
            return res.status(500).json({ error: 'Не удалось зарегистрировать клиента.' });
        }
        
        const customerUrl = `${req.protocol}://${req.get('host')}/card.html?id=${id}`;
        
        try {
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
        } catch (qrErr) {
            log.error("Ошибка генерации QR-кода:", qrErr);
            res.status(500).json({ error: 'Не удалось сгенерировать QR-код.' });
        }
    });
});

// 2. Поиск клиента
app.get('/api/search', (req, res) => {
    const { term } = req.query;
    
    if (!term || term.length < 2) {
        return res.status(400).json({ error: 'Поисковый запрос должен содержать минимум 2 символа.' });
    }

    const sql = `SELECT id, name, phone, purchases FROM customers 
                 WHERE name LIKE ? OR phone LIKE ? 
                 ORDER BY name ASC LIMIT 20`;
    const searchTerm = `%${term}%`;

    db.all(sql, [searchTerm, searchTerm], (err, rows) => {
        if (err) {
            log.error("Ошибка поиска клиентов:", err.message);
            return res.status(500).json({ error: 'Ошибка поиска клиентов.' });
        }
        
        log.info(`Поиск "${term}" - найдено результатов: ${rows.length}`);
        res.json(rows);
    });
});

// 3. Засчитывание покупки
app.post('/api/purchase', (req, res) => {
    const { customerId } = req.body;
    
    if (!customerId) {
        return res.status(400).json({ error: 'ID клиента обязателен.' });
    }

    // Начинаем транзакцию
    db.serialize(() => {
        db.run("BEGIN TRANSACTION");

        const findSql = `SELECT id, name, purchases FROM customers WHERE id = ?`;
        db.get(findSql, [customerId], (err, customer) => {
            if (err) {
                db.run("ROLLBACK");
                log.error("Ошибка поиска клиента:", err.message);
                return res.status(500).json({ error: 'Ошибка базы данных при поиске клиента.' });
            }

            if (!customer) {
                db.run("ROLLBACK");
                return res.status(404).json({ error: 'Клиент не найден.' });
            }

            let currentPurchases = customer.purchases;
            let newPurchases;
            let message;
            let isFreeCoffee = false;

            if (currentPurchases >= 6) {
                newPurchases = 0; // Сброс после бесплатного кофе
                message = 'Клиент получил бесплатный кофе! Счетчик обнулен.';
                isFreeCoffee = true;
            } else {
                newPurchases = currentPurchases + 1;
                if (newPurchases === 6) {
                    message = `Покупка засчитана. Следующий кофе бесплатно!`;
                } else {
                    message = `Покупка засчитана. Прогресс: ${newPurchases}/6.`;
                }
            }
            
            const updateSql = `UPDATE customers SET purchases = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`;
            db.run(updateSql, [newPurchases, customerId], function(updateErr) {
                if (updateErr) {
                    db.run("ROLLBACK");
                    log.error("Ошибка обновления покупок:", updateErr.message);
                    return res.status(500).json({ error: 'Не удалось обновить количество покупок.' });
                }
                
                // Логируем покупку только если это не получение бесплатного кофе
                if (!isFreeCoffee) {
                    const historySql = `INSERT INTO purchase_history (customer_id) VALUES (?)`;
                    db.run(historySql, [customerId], (historyErr) => {
                        if (historyErr) {
                            log.error("Ошибка записи истории покупок:", historyErr.message);
                            // Не возвращаем ошибку клиенту, так как основная операция успешна
                        }
                        
                        db.run("COMMIT");
                        log.success(`Покупка засчитана: ${customer.name} (${currentPurchases} → ${newPurchases})`);
                        res.json({ message, purchases: newPurchases });
                    });
                } else {
                    db.run("COMMIT");
                    log.success(`Бесплатный кофе выдан: ${customer.name} (сброс с ${currentPurchases} на 0)`);
                    res.json({ message, purchases: newPurchases });
                }
            });
        });
    });
});

// 4. Получение истории покупок
app.get('/api/history/:id', (req, res) => {
    const { id } = req.params;
    
    const sql = `SELECT timestamp FROM purchase_history 
                 WHERE customer_id = ? 
                 ORDER BY timestamp DESC 
                 LIMIT 50`;
                 
    db.all(sql, [id], (err, rows) => {
        if (err) {
            log.error("Ошибка получения истории:", err.message);
            return res.status(500).json({ error: 'Не удалось получить историю покупок.' });
        }
        res.json(rows);
    });
});

// 5. Получение данных клиента для карты
app.get('/api/customer/:id', (req, res) => {
    const { id } = req.params;
    
    const sql = `SELECT id, name, purchases FROM customers WHERE id = ?`;
    db.get(sql, [id], (err, row) => {
        if (err) {
            log.error("Ошибка получения данных клиента:", err.message);
            return res.status(500).json({ error: 'Не удалось получить данные клиента.' });
        }
        
        if (!row) {
            return res.status(404).json({ error: 'Клиент не найден.' });
        }
        
        res.json(row);
    });
});

// 6. Генерация QR-кода для карты клиента
app.get('/api/qr/:id', async (req, res) => {
    const { id } = req.params;
    
    try {
        // Проверяем существование клиента
        const checkSql = `SELECT id FROM customers WHERE id = ?`;
        db.get(checkSql, [id], async (err, customer) => {
            if (err) {
                log.error("Ошибка проверки клиента:", err.message);
                return res.status(500).json({ error: 'Ошибка базы данных' });
            }
            
            if (!customer) {
                return res.status(404).json({ error: 'Клиент не найден' });
            }
            
            const customerUrl = `${req.protocol}://${req.get('host')}/card.html?id=${id}`;
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
            res.setHeader('Cache-Control', 'public, max-age=3600'); // Кеш на 1 час
            res.send(qrCodeBuffer);
        });
    } catch (error) {
        log.error('Ошибка генерации QR-кода:', error);
        res.status(500).json({ error: 'Не удалось сгенерировать QR-код' });
    }
});

// 7. Статистика системы (дополнительно)
app.get('/api/stats', (req, res) => {
    const queries = [
        new Promise((resolve) => {
            db.get("SELECT COUNT(*) as total FROM customers", (err, row) => {
                resolve({ totalCustomers: err ? 0 : row.total });
            });
        }),
        new Promise((resolve) => {
            db.get("SELECT COUNT(*) as total FROM purchase_history", (err, row) => {
                resolve({ totalPurchases: err ? 0 : row.total });
            });
        }),
        new Promise((resolve) => {
            db.get("SELECT COUNT(*) as ready FROM customers WHERE purchases >= 6", (err, row) => {
                resolve({ readyForFreeCoffee: err ? 0 : row.ready });
            });
        })
    ];

    Promise.all(queries).then(results => {
        const stats = Object.assign({}, ...results);
        res.json(stats);
    });
});

// 8. Удаление клиента
app.delete('/api/customer/:id', (req, res) => {
    const { id } = req.params;
    
    if (!id) {
        return res.status(400).json({ error: 'ID клиента обязателен.' });
    }

    // Начинаем транзакцию
    db.serialize(() => {
        db.run("BEGIN TRANSACTION");

        // Сначала проверяем существование клиента
        const checkSql = `SELECT id, name FROM customers WHERE id = ?`;
        db.get(checkSql, [id], (err, customer) => {
            if (err) {
                db.run("ROLLBACK");
                log.error("Ошибка проверки клиента:", err.message);
                return res.status(500).json({ error: 'Ошибка базы данных при проверке клиента.' });
            }

            if (!customer) {
                db.run("ROLLBACK");
                return res.status(404).json({ error: 'Клиент не найден.' });
            }

            // Удаляем историю покупок клиента
            const deleteHistorySql = `DELETE FROM purchase_history WHERE customer_id = ?`;
            db.run(deleteHistorySql, [id], (historyErr) => {
                if (historyErr) {
                    db.run("ROLLBACK");
                    log.error("Ошибка удаления истории покупок:", historyErr.message);
                    return res.status(500).json({ error: 'Не удалось удалить историю покупок.' });
                }

                // Удаляем самого клиента
                const deleteCustomerSql = `DELETE FROM customers WHERE id = ?`;
                db.run(deleteCustomerSql, [id], (customerErr) => {
                    if (customerErr) {
                        db.run("ROLLBACK");
                        log.error("Ошибка удаления клиента:", customerErr.message);
                        return res.status(500).json({ error: 'Не удалось удалить клиента.' });
                    }

                    db.run("COMMIT");
                    log.success(`Клиент удален: ${customer.name} (ID: ${id})`);
                    res.json({ 
                        message: `Клиент "${customer.name}" успешно удален.`,
                        deletedCustomer: customer
                    });
                });
            });
        });
    });
});

// 8.5. Редактирование клиента
app.put('/api/customer/:id', (req, res) => {
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

    // Начинаем транзакцию
    db.serialize(() => {
        db.run("BEGIN TRANSACTION");

        // Сначала проверяем существование клиента
        const checkSql = `SELECT id, name, phone FROM customers WHERE id = ?`;
        db.get(checkSql, [id], (err, customer) => {
            if (err) {
                db.run("ROLLBACK");
                log.error("Ошибка проверки клиента:", err.message);
                return res.status(500).json({ error: 'Ошибка базы данных при проверке клиента.' });
            }

            if (!customer) {
                db.run("ROLLBACK");
                return res.status(404).json({ error: 'Клиент не найден.' });
            }

            // Проверяем, не занят ли новый номер телефона другим клиентом
            if (phone !== customer.phone) {
                const phoneCheckSql = `SELECT id FROM customers WHERE phone = ? AND id != ?`;
                db.get(phoneCheckSql, [phone, id], (phoneErr, existingCustomer) => {
                    if (phoneErr) {
                        db.run("ROLLBACK");
                        log.error("Ошибка проверки номера телефона:", phoneErr.message);
                        return res.status(500).json({ error: 'Ошибка проверки номера телефона.' });
                    }

                    if (existingCustomer) {
                        db.run("ROLLBACK");
                        return res.status(409).json({ error: 'Клиент с таким номером телефона уже существует.' });
                    }

                    // Обновляем данные клиента
                    updateCustomerData();
                });
            } else {
                // Номер не изменился, сразу обновляем
                updateCustomerData();
            }

            function updateCustomerData() {
                const updateSql = `UPDATE customers SET name = ?, phone = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`;
                db.run(updateSql, [name, phone, id], function(updateErr) {
                    if (updateErr) {
                        db.run("ROLLBACK");
                        log.error("Ошибка обновления клиента:", updateErr.message);
                        return res.status(500).json({ error: 'Не удалось обновить данные клиента.' });
                    }

                    db.run("COMMIT");
                    log.success(`Клиент обновлен: ${customer.name} → ${name}, ${customer.phone} → ${phone}`);
                    res.json({ 
                        message: 'Данные клиента успешно обновлены.',
                        customer: { id, name, phone }
                    });
                });
            }
        });
    });
});

// 9. Получение всех клиентов с подробной информацией
app.get('/api/customers/all', (req, res) => {
    const { sort = 'name', order = 'ASC' } = req.query;
    
    // Валидация параметров сортировки
    const validSorts = ['name', 'purchases', 'created_at', 'updated_at'];
    const validOrders = ['ASC', 'DESC'];
    
    const sortField = validSorts.includes(sort) ? sort : 'name';
    const sortOrder = validOrders.includes(order.toUpperCase()) ? order.toUpperCase() : 'ASC';
    
    // Сначала проверяем структуру таблицы
    db.all("PRAGMA table_info(customers)", [], (err, columns) => {
        if (err) {
            log.error("Ошибка получения структуры таблицы:", err.message);
            return res.status(500).json({ error: 'Ошибка базы данных.' });
        }
        
        const columnNames = columns.map(col => col.name);
        const hasTimestamps = columnNames.includes('created_at') && columnNames.includes('updated_at');
        
        // Формируем запрос в зависимости от наличия колонок
        const sql = hasTimestamps ? `
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
        ` : `
            SELECT 
                c.id,
                c.name,
                c.phone,
                c.purchases,
                NULL as created_at,
                NULL as updated_at,
                (SELECT MAX(timestamp) FROM purchase_history WHERE customer_id = c.id) as last_purchase,
                (SELECT COUNT(*) FROM purchase_history WHERE customer_id = c.id) as total_history_purchases
            FROM customers c
            ORDER BY ${sortField === 'created_at' || sortField === 'updated_at' ? 'name' : sortField} ${sortOrder}
        `;
        
        db.all(sql, [], (err, rows) => {
            if (err) {
                log.error("Ошибка получения всех клиентов:", err.message);
                return res.status(500).json({ error: 'Не удалось получить список клиентов.' });
            }
            
            // Форматируем данные для фронтенда
            const formattedCustomers = rows.map(customer => ({
                ...customer,
                created_at: customer.created_at ? new Date(customer.created_at).toLocaleDateString('ru-RU') : 'Не указано',
                updated_at: customer.updated_at ? new Date(customer.updated_at).toLocaleDateString('ru-RU') : 'Не указано',
                last_purchase: customer.last_purchase ? new Date(customer.last_purchase).toLocaleDateString('ru-RU') : null,
                status: customer.purchases >= 6 ? 'ready' : 'progress'
            }));
            
            log.info(`Запрошен список всех клиентов (${formattedCustomers.length} клиентов)`);
            res.json(formattedCustomers);
        });
    });
});

// --- Обработка ошибок ---
app.use((err, req, res, next) => {
    log.error('Необработанная ошибка:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

// --- Graceful shutdown ---
process.on('SIGINT', () => {
    log.info('Получен сигнал SIGINT, закрытие сервера...');
    db.close((err) => {
        if (err) {
            log.error('Ошибка закрытия базы данных:', err.message);
        } else {
            log.success('База данных закрыта.');
        }
        process.exit(0);
    });
});

// --- Запуск сервера ---
app.listen(PORT, () => {
    log.success(`🚀 Сервер COFFEEMANIA запущен на http://localhost:${PORT}`);
    log.info(`📱 Панель бариста: http://localhost:${PORT}/admin.html`);
    log.info(`💾 База данных: ${DB_PATH}`);
}); 