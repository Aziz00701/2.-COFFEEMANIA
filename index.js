const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
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
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://database_nnzy_user:aZfYtJkSb0f3wULFIzrYaWE6J6dV96ck@dpg-cthjaq3tq21c73f7uoag-a.oregon-postgres.render.com/database_nnzy',
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// In-memory storage fallback
let memoryStorage = {
    customers: new Map(),
    purchases: new Map(),
    settings: new Map()
};

let useMemory = false;

// Database connection check and table creation
async function initializeDatabase() {
    try {
        await pool.query('SELECT NOW()');
        console.log('✅ PostgreSQL connected successfully');
        
        // Create tables if they don't exist
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
        
        await pool.query(`
            CREATE TABLE IF NOT EXISTS purchase_history (
                purchase_id SERIAL PRIMARY KEY,
                customer_id VARCHAR(50) REFERENCES customers(id),
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        await pool.query(`
            CREATE TABLE IF NOT EXISTS settings (
                key VARCHAR(50) PRIMARY KEY,
                value TEXT
            )
        `);
        
        console.log('✅ Database tables ready');
        useMemory = false;
    } catch (error) {
        console.log('❌ Database connection error:', error.message);
        console.log('🔄 Using in-memory storage...');
        useMemory = true;
    }
}

// API Routes

// Get statistics
app.get('/api/stats', async (req, res) => {
    try {
        let totalCustomers, totalPurchases, readyForFreeCoffee;
        
        if (useMemory) {
            // In-memory storage queries
            totalCustomers = memoryStorage.customers.size;
            totalPurchases = memoryStorage.purchases.size;
            readyForFreeCoffee = 0;
        } else {
            // PostgreSQL queries
            const totalCustomersResult = await pool.query('SELECT COUNT(*) FROM customers');
            totalCustomers = parseInt(totalCustomersResult.rows[0].count);

            const totalPurchasesResult = await pool.query('SELECT SUM(purchases) FROM customers');
            totalPurchases = parseInt(totalPurchasesResult.rows[0].sum) || 0;

            const readyResult = await pool.query('SELECT COUNT(*) FROM customers WHERE purchases >= 6');
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
        
        if (useMemory) {
            // In-memory storage
            memoryStorage.customers.set(customerId, { id: customerId, name, phone, purchases: 0 });
            res.json({ 
                success: true, 
                customerId,
                message: 'Customer registered successfully' 
            });
        } else {
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
        
        if (useMemory) {
            // In-memory storage
            customers = Array.from(memoryStorage.customers.values()).filter(c => c.name.toLowerCase().includes(q.toLowerCase()) || c.phone.includes(q));
        } else {
            // PostgreSQL
            const result = await pool.query(
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
        
        if (useMemory) {
            // In-memory storage
            customers = Array.from(memoryStorage.customers.values());
        } else {
            // PostgreSQL
            const result = await pool.query('SELECT * FROM customers ORDER BY created_at DESC');
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
        
        if (useMemory) {
            // In-memory storage
            customer = memoryStorage.customers.get(id);
        } else {
            // PostgreSQL
            const result = await pool.query('SELECT * FROM customers WHERE id = $1', [id]);
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
        if (useMemory) {
            customer = memoryStorage.customers.get(id);
        } else {
            const result = await pool.query('SELECT * FROM customers WHERE id = $1', [id]);
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
        
        if (useMemory) {
            // In-memory storage
            memoryStorage.customers.set(id, { ...customer, purchases: newPurchases });
            memoryStorage.purchases.set(id, { customer_id: id, timestamp: new Date() });
            res.json({ 
                success: true, 
                message: 'Purchase added successfully',
                newPurchases: newPurchases,
                isComplete: isComplete
            });
        } else {
            // PostgreSQL
            await pool.query('BEGIN');
            
            await pool.query(
                'UPDATE customers SET purchases = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
                [newPurchases, id]
            );
            
            await pool.query(
                'INSERT INTO purchase_history (customer_id) VALUES ($1)',
                [id]
            );
            
            await pool.query('COMMIT');
            
            res.json({ 
                success: true, 
                message: 'Purchase added successfully',
                newPurchases: newPurchases,
                isComplete: isComplete
            });
        }
    } catch (error) {
        console.error('Add purchase error:', error);
        if (!useMemory) {
            await pool.query('ROLLBACK');
        }
        res.status(500).json({ error: 'Failed to add purchase' });
    }
});

// Update customer
app.put('/api/customer/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { name, phone } = req.body;
        
        if (useMemory) {
            // In-memory storage
            memoryStorage.customers.set(id, { ...memoryStorage.customers.get(id), name, phone });
            res.json({ success: true, message: 'Customer updated successfully' });
        } else {
            // PostgreSQL
            await pool.query(
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
        
        if (useMemory) {
            // In-memory storage
            memoryStorage.customers.delete(id);
            res.json({ success: true, message: 'Customer deleted successfully' });
        } else {
            // PostgreSQL
            await pool.query('DELETE FROM customers WHERE id = $1', [id]);
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
        
        if (useMemory) {
            // In-memory storage
            history = Array.from(memoryStorage.purchases.values()).filter(p => p.customer_id === id);
        } else {
            // PostgreSQL
            const result = await pool.query(
                'SELECT * FROM purchase_history WHERE customer_id = $1 ORDER BY timestamp DESC',
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
        
        if (useMemory) {
            // In-memory storage
            memoryStorage.customers.set(id, { ...memoryStorage.customers.get(id), purchases: 0 });
            res.json({ success: true, message: 'Customer purchases reset successfully' });
        } else {
            // PostgreSQL
            await pool.query(
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

// Generate secure client app link
app.get('/api/client-link/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        // Проверяем существование клиента
        let customer;
        if (useMemory) {
            customer = memoryStorage.customers.get(id);
        } else {
            const result = await pool.query('SELECT * FROM customers WHERE id = $1', [id]);
            customer = result.rows[0];
        }
        
        if (!customer) {
            return res.status(404).json({ error: 'Customer not found' });
        }
        
        const clientAppUrl = `${req.protocol}://${req.get('host')}/client-app.html?id=${id}`;
        
        res.json({ 
            url: clientAppUrl,
            customer: customer,
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
        
        if (useMemory) {
            // In-memory storage
            phone = memoryStorage.settings.get('barista_phone') || '+7 (999) 123-45-67';
        } else {
            // PostgreSQL
            const result = await pool.query('SELECT value FROM settings WHERE key = $1', ['barista_phone']);
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
        
        if (useMemory) {
            // In-memory storage
            memoryStorage.settings.set('barista_phone', phone);
            res.json({ success: true, message: 'Phone updated successfully' });
        } else {
            // PostgreSQL
            await pool.query(
                'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2',
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
    
    await initializeDatabase();
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n👋 Shutting down server...');
    if (pool.end) {
        await pool.end();
    }
    if (useMemory) {
        console.log('👋 In-memory storage cleared');
    }
    process.exit(0);
}); 