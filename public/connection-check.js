// МГНОВЕННАЯ ЗАГРУЗКА: Проверка соединения без блокировки интерфейса
async function checkConnection() {
    const connectionEl = document.getElementById('connection-status');
    if (!connectionEl) return;
    
    const startTime = Date.now();
    
    try {
        // УСКОРЕНО: Таймаут всего 3 секунды вместо 8
        const response = await fetch('/api/stats', {
            method: 'GET',
            cache: 'no-cache',
            signal: AbortSignal.timeout(3000)
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
            // База данных еще не готова - но НЕ блокируем интерфейс
            updateConnectionStatus('slow', null);
        } else {
            updateConnectionStatus('slow', responseTime);
        }
        
    } catch (error) {
        console.log('Соединение проверяется:', error.message);
        if (error.name === 'TimeoutError') {
            updateConnectionStatus('slow', null);
        } else {
            updateConnectionStatus('offline', null);
        }
        
        // НЕ блокируем интерфейс при ошибках
    }
}

// Обновление статуса соединения - БЕЗ БЛОКИРОВКИ
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
            textEl.textContent = '🟡 Подключение...';
            break;
        case 'offline':
            textEl.textContent = '🔴 Офлайн';
            break;
    }
}

// МГНОВЕННЫЙ ЗАПУСК: Показываем интерфейс сразу, проверка в фоне
document.addEventListener('DOMContentLoaded', () => {
    // СРАЗУ показываем что идет подключение
    updateConnectionStatus('slow', null);
    
    // МГНОВЕННАЯ первая проверка (без задержки)
    setTimeout(() => {
        checkConnection();
    }, 500); // Всего 0.5 секунды задержки
    
    // Регулярные проверки каждые 10 секунд (вместо 15)
    setInterval(checkConnection, 10000);
}); 