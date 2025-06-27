const express = require('express');
const cors = require('cors');
const { Client } = require('pg');
const QRCode = require('qrcode');
const { nanoid } = require('nanoid');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 1000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// PostgreSQL connection
const connectionString = process.env.DATABASE_URL || 'postgresql://username:password@localhost:5432/coffeemania';
const client = new Client({
    connectionString: connectionString,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Connect to database
async function connectDB() {
    try {
        await client.connect();
        console.log('✅ Connected to PostgreSQL database');
        await initDatabase();
    } catch (error) {
        console.error('❌ Database connection error:', error);
        // Fallback to SQLite for development
        console.log('🔄 Falling back to SQLite...');
        await setupSQLite();
    }
}

// Initialize database tables
async function initDatabase() {
    try {
        // Create customers table
        await client.query(`
            CREATE TABLE IF NOT EXISTS customers (
                id VARCHAR(50) PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                phone VARCHAR(50) NOT NULL UNIQUE,
                purchases INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Create purchase history table
        await client.query(`
            CREATE TABLE IF NOT EXISTS purchase_history (
                purchase_id SERIAL PRIMARY KEY,
                customer_id VARCHAR(50) REFERENCES customers(id) ON DELETE CASCADE,
                purchase_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                action VARCHAR(50) DEFAULT 'purchase'
            )
        `);

        // Create settings table for barista phone
        await client.query(`
            CREATE TABLE IF NOT EXISTS settings (
                key VARCHAR(100) PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Set default barista phone if not exists
        await client.query(`
            INSERT INTO settings (key, value) VALUES ('barista_phone', '+7 (999) 123-45-67')
            ON CONFLICT (key) DO NOTHING
        `);

        console.log('✅ Database tables initialized');
    } catch (error) {
        console.error('❌ Database initialization error:', error);
    }
}

// SQLite fallback for development
async function setupSQLite() {
    const sqlite3 = require('sqlite3').verbose();
    const db = new sqlite3.Database(':memory:');
    
    db.serialize(() => {
        db.run(`CREATE TABLE customers (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            phone TEXT NOT NULL UNIQUE,
            purchases INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        db.run(`CREATE TABLE purchase_history (
            purchase_id INTEGER PRIMARY KEY AUTOINCREMENT,
            customer_id TEXT,
            purchase_date DATETIME DEFAULT CURRENT_TIMESTAMP,
            action TEXT DEFAULT 'purchase',
            FOREIGN KEY(customer_id) REFERENCES customers(id)
        )`);

        db.run(`CREATE TABLE settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        db.run(`INSERT INTO settings (key, value) VALUES ('barista_phone', '+7 (999) 123-45-67')`);
    });

    global.sqliteDB = db;
    console.log('✅ SQLite database initialized');
}

// API Routes

// Get statistics
app.get('/api/stats', async (req, res) => {
    try {
        let totalCustomers, totalPurchases, readyForFreeCoffee;
        
        if (global.sqliteDB) {
            // SQLite queries
            totalCustomers = await new Promise((resolve, reject) => {
                global.sqliteDB.get('SELECT COUNT(*) as count FROM customers', (err, row) => {
                    if (err) reject(err);
                    else resolve(row.count);
                });
            });

            totalPurchases = await new Promise((resolve, reject) => {
                global.sqliteDB.get('SELECT SUM(purchases) as total FROM customers', (err, row) => {
                    if (err) reject(err);
                    else resolve(row.total || 0);
                });
            });

            readyForFreeCoffee = await new Promise((resolve, reject) => {
                global.sqliteDB.get('SELECT COUNT(*) as count FROM customers WHERE purchases >= 6', (err, row) => {
                    if (err) reject(err);
                    else resolve(row.count);
                });
            });
        } else {
            // PostgreSQL queries
            const totalCustomersResult = await client.query('SELECT COUNT(*) FROM customers');
            totalCustomers = parseInt(totalCustomersResult.rows[0].count);

            const totalPurchasesResult = await client.query('SELECT SUM(purchases) FROM customers');
            totalPurchases = parseInt(totalPurchasesResult.rows[0].sum) || 0;

            const readyResult = await client.query('SELECT COUNT(*) FROM customers WHERE purchases >= 6');
            readyForFreeCoffee = parseInt(readyResult.rows[0].count);
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
        
        if (global.sqliteDB) {
            // SQLite
            global.sqliteDB.run(
                'INSERT INTO customers (id, name, phone) VALUES (?, ?, ?)',
                [customerId, name, phone],
                function(err) {
                    if (err) {
                        if (err.message.includes('UNIQUE constraint failed')) {
                            return res.status(400).json({ error: 'Клиент с таким номером уже существует' });
                        }
                        return res.status(500).json({ error: 'Failed to register customer' });
                    }
                    res.json({ 
                        success: true, 
                        customerId,
                        message: 'Customer registered successfully' 
                    });
                }
            );
        } else {
            // PostgreSQL
            await client.query(
                'INSERT INTO customers (id, name, phone) VALUES ($1, $2, $3)',
                [customerId, name, phone]
            );
            
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
        
        if (global.sqliteDB) {
            // SQLite
            customers = await new Promise((resolve, reject) => {
                global.sqliteDB.all(
                    'SELECT * FROM customers WHERE name LIKE ? OR phone LIKE ? ORDER BY created_at DESC',
                    [`%${q}%`, `%${q}%`],
                    (err, rows) => {
                        if (err) reject(err);
                        else resolve(rows);
                    }
                );
            });
        } else {
            // PostgreSQL
            const result = await client.query(
                'SELECT * FROM customers WHERE name ILIKE $1 OR phone ILIKE $1 ORDER BY created_at DESC',
                [`%${q}%`]
            );
            customers = result.rows;
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
        
        if (global.sqliteDB) {
            // SQLite
            customers = await new Promise((resolve, reject) => {
                global.sqliteDB.all(
                    'SELECT * FROM customers ORDER BY created_at DESC',
                    (err, rows) => {
                        if (err) reject(err);
                        else resolve(rows);
                    }
                );
            });
        } else {
            // PostgreSQL
            const result = await client.query('SELECT * FROM customers ORDER BY created_at DESC');
            customers = result.rows;
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
        let customer;
        
        if (global.sqliteDB) {
            // SQLite
            customer = await new Promise((resolve, reject) => {
                global.sqliteDB.get(
                    'SELECT * FROM customers WHERE id = ?',
                    [id],
                    (err, row) => {
                        if (err) reject(err);
                        else resolve(row);
                    }
                );
            });
        } else {
            // PostgreSQL
            const result = await client.query('SELECT * FROM customers WHERE id = $1', [id]);
            customer = result.rows[0];
        }

        if (!customer) {
            return res.status(404).json({ error: 'Customer not found' });
        }

        res.json(customer);
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
        if (global.sqliteDB) {
            customer = await new Promise((resolve, reject) => {
                global.sqliteDB.get(
                    'SELECT * FROM customers WHERE id = ?',
                    [id],
                    (err, row) => {
                        if (err) reject(err);
                        else resolve(row);
                    }
                );
            });
        } else {
            const result = await client.query('SELECT * FROM customers WHERE id = $1', [id]);
            customer = result.rows[0];
        }
        
        if (!customer) {
            return res.status(404).json({ error: 'Customer not found' });
        }
        
        const currentPurchases = customer.purchases;
        let newPurchases;
        let isComplete = false;
        
        // ИСПРАВЛЕНО: Логика счетчика покупок
        if (currentPurchases >= 6) {
            // После 6 покупок - выдаем бесплатный кофе и сбрасываем на 1
            newPurchases = 1;
            isComplete = true;
        } else {
            // Увеличиваем счетчик
            newPurchases = currentPurchases + 1;
            if (newPurchases === 6) {
                isComplete = true;
            }
        }
        
        if (global.sqliteDB) {
            // SQLite
            global.sqliteDB.serialize(() => {
                global.sqliteDB.run('BEGIN TRANSACTION');
                
                global.sqliteDB.run(
                    'UPDATE customers SET purchases = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                    [newPurchases, id],
                    function(err) {
                        if (err) {
                            global.sqliteDB.run('ROLLBACK');
                            return res.status(500).json({ error: 'Failed to add purchase' });
                        }
                        
                        global.sqliteDB.run(
                            'INSERT INTO purchase_history (customer_id) VALUES (?)',
                            [id],
                            function(err) {
                                if (err) {
                                    global.sqliteDB.run('ROLLBACK');
                                    return res.status(500).json({ error: 'Failed to add purchase' });
                                }
                                
                                global.sqliteDB.run('COMMIT');
                                res.json({ 
                                    success: true, 
                                    message: 'Purchase added successfully',
                                    newPurchases: newPurchases,
                                    isComplete: isComplete
                                });
                            }
                        );
                    }
                );
            });
        } else {
            // PostgreSQL
            await client.query('BEGIN');
            
            await client.query(
                'UPDATE customers SET purchases = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
                [newPurchases, id]
            );
            
            await client.query(
                'INSERT INTO purchase_history (customer_id) VALUES ($1)',
                [id]
            );
            
            await client.query('COMMIT');
            
            res.json({ 
                success: true, 
                message: 'Purchase added successfully',
                newPurchases: newPurchases,
                isComplete: isComplete
            });
        }
    } catch (error) {
        console.error('Add purchase error:', error);
        if (!global.sqliteDB) {
            await client.query('ROLLBACK');
        }
        res.status(500).json({ error: 'Failed to add purchase' });
    }
});

// Update customer
app.put('/api/customer/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { name, phone } = req.body;
        
        if (global.sqliteDB) {
            // SQLite
            global.sqliteDB.run(
                'UPDATE customers SET name = ?, phone = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                [name, phone, id],
                function(err) {
                    if (err) {
                        return res.status(500).json({ error: 'Failed to update customer' });
                    }
                    res.json({ success: true, message: 'Customer updated successfully' });
                }
            );
        } else {
            // PostgreSQL
            await client.query(
                'UPDATE customers SET name = $1, phone = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3',
                [name, phone, id]
            );
            
            res.json({ success: true, message: 'Customer updated successfully' });
        }
    } catch (error) {
        console.error('Update customer error:', error);
        res.status(500).json({ error: 'Failed to update customer' });
    }
});

// Delete customer
app.delete('/api/customer/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        if (global.sqliteDB) {
            // SQLite
            global.sqliteDB.run('DELETE FROM customers WHERE id = ?', [id], function(err) {
                if (err) {
                    return res.status(500).json({ error: 'Failed to delete customer' });
                }
                res.json({ success: true, message: 'Customer deleted successfully' });
            });
        } else {
            // PostgreSQL
            await client.query('DELETE FROM customers WHERE id = $1', [id]);
            res.json({ success: true, message: 'Customer deleted successfully' });
        }
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
        
        if (global.sqliteDB) {
            // SQLite
            history = await new Promise((resolve, reject) => {
                global.sqliteDB.all(
                    'SELECT * FROM purchase_history WHERE customer_id = ? ORDER BY purchase_date DESC',
                    [id],
                    (err, rows) => {
                        if (err) reject(err);
                        else resolve(rows);
                    }
                );
            });
        } else {
            // PostgreSQL
            const result = await client.query(
                'SELECT * FROM purchase_history WHERE customer_id = $1 ORDER BY purchase_date DESC',
                [id]
            );
            history = result.rows;
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
        
        if (global.sqliteDB) {
            // SQLite
            global.sqliteDB.run(
                'UPDATE customers SET purchases = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                [id],
                function(err) {
                    if (err) {
                        return res.status(500).json({ error: 'Failed to reset customer purchases' });
                    }
                    res.json({ success: true, message: 'Customer purchases reset successfully' });
                }
            );
        } else {
            // PostgreSQL
            await client.query(
                'UPDATE customers SET purchases = 0, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
                [id]
            );
            
            res.json({ success: true, message: 'Customer purchases reset successfully' });
        }
    } catch (error) {
        console.error('Reset customer error:', error);
        res.status(500).json({ error: 'Failed to reset customer purchases' });
    }
});

// Generate QR code
app.get('/api/qr/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const cardUrl = `${req.protocol}://${req.get('host')}/card.html?id=${id}`;
        
        const qrCode = await QRCode.toDataURL(cardUrl, {
            width: 300,
            margin: 2,
            color: {
                dark: '#000000',
                light: '#FFFFFF'
            }
        });
        
        res.json({ qrCode, url: cardUrl });
    } catch (error) {
        console.error('QR generation error:', error);
        res.status(500).json({ error: 'Failed to generate QR code' });
    }
});

// Get barista phone
app.get('/api/barista-phone', async (req, res) => {
    try {
        let phone;
        
        if (global.sqliteDB) {
            // SQLite
            phone = await new Promise((resolve, reject) => {
                global.sqliteDB.get(
                    'SELECT value FROM settings WHERE key = ?',
                    ['barista_phone'],
                    (err, row) => {
                        if (err) reject(err);
                        else resolve(row ? row.value : '+7 (999) 123-45-67');
                    }
                );
            });
        } else {
            // PostgreSQL
            const result = await client.query('SELECT value FROM settings WHERE key = $1', ['barista_phone']);
            phone = result.rows[0]?.value || '+7 (999) 123-45-67';
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
        
        if (global.sqliteDB) {
            // SQLite
            global.sqliteDB.run(
                'INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
                ['barista_phone', phone],
                function(err) {
                    if (err) {
                        return res.status(500).json({ error: 'Failed to update phone' });
                    }
                    res.json({ success: true, message: 'Phone updated successfully' });
                }
            );
        } else {
            // PostgreSQL
            await client.query(
                'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = CURRENT_TIMESTAMP',
                ['barista_phone', phone]
            );
            
            res.json({ success: true, message: 'Phone updated successfully' });
        }
    } catch (error) {
        console.error('Update barista phone error:', error);
        res.status(500).json({ error: 'Failed to update phone' });
    }
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
app.listen(PORT, async () => {
    console.log(`🚀 COFFEEMANIA server running on port ${PORT}`);
    console.log(`📱 Admin panel: http://localhost:${PORT}/admin.html`);
    console.log(`☕ Main page: http://localhost:${PORT}`);
    console.log(`📷 Для работы камеры используйте LOCALHOST: http://localhost:${PORT}/admin.html`);
    
    await connectDB();
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n👋 Shutting down server...');
    if (client.end) {
        await client.end();
    }
    if (global.sqliteDB) {
        global.sqliteDB.close();
    }
    process.exit(0);
}); 