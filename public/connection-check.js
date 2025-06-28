// Проверка соединения с сервером - ИСПРАВЛЕНО: лучшая обработка ошибок
async function checkConnection() {
    const connectionEl = document.getElementById('connection-status');
    if (!connectionEl) return;
    
    const startTime = Date.now();
    
    try {
        const response = await fetch('/api/stats', {
            method: 'GET',
            cache: 'no-cache',
            signal: AbortSignal.timeout(8000) // Увеличенный таймаут
        });
        
        const endTime = Date.now();
        const responseTime = endTime - startTime;
        
        if (response.ok) {
            const data = await response.json();
            // Проверяем что данные корректные
            if (typeof data.totalCustomers === 'number') {
                updateConnectionStatus('online', responseTime);
            } else {
                updateConnectionStatus('slow', responseTime);
            }
        } else if (response.status === 503) {
            // База данных еще не готова
            updateConnectionStatus('slow', null);
        } else {
            updateConnectionStatus('slow', responseTime);
        }
        
    } catch (error) {
        console.log('Соединение недоступно:', error.message);
        if (error.name === 'TimeoutError') {
            updateConnectionStatus('slow', null);
        } else {
            updateConnectionStatus('offline', null);
        }
    }
}

// Обновление статуса соединения - ИСПРАВЛЕНО: упрощенные сообщения
function updateConnectionStatus(status, responseTime) {
    const connectionEl = document.getElementById('connection-status');
    if (!connectionEl) return;
    
    // Удаляем старые классы
    connectionEl.className = 'connection-status';
    
    // Добавляем новый класс статуса
    connectionEl.classList.add(status);
    
    const textEl = connectionEl.querySelector('span');
    
    switch (status) {
        case 'online':
            textEl.textContent = '🟢 Онлайн';
            break;
        case 'slow':
            textEl.textContent = '🟡 Медленно';
            break;
        case 'offline':
            textEl.textContent = '🔴 Офлайн';
            break;
    }
}

// Запуск проверки соединения - ИСПРАВЛЕНО: увеличена задержка
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        checkConnection();
        setInterval(checkConnection, 15000); // Каждые 15 секунд
    }, 3000); // Увеличена задержка до 3 секунд
}); 