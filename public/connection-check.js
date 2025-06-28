// Проверка соединения с сервером
async function checkConnection() {
    const connectionEl = document.getElementById('connection-status');
    if (!connectionEl) return;
    
    const startTime = Date.now();
    
    try {
        const response = await fetch('/api/stats', {
            method: 'GET',
            cache: 'no-cache',
            signal: AbortSignal.timeout(5000) // Таймаут 5 секунд
        });
        
        const endTime = Date.now();
        const responseTime = endTime - startTime;
        
        if (response.ok) {
            updateConnectionStatus('online', responseTime);
        } else {
            updateConnectionStatus('slow', responseTime);
        }
        
    } catch (error) {
        console.log('Соединение недоступно:', error.message);
        updateConnectionStatus('offline', null);
    }
}

// Обновление статуса соединения
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
            if (responseTime < 500) {
                textEl.textContent = `🟢 Отличное соединение (${responseTime}мс)`;
            } else if (responseTime < 1000) {
                textEl.textContent = `🟡 Хорошее соединение (${responseTime}мс)`;
            } else {
                textEl.textContent = `🟠 Медленное соединение (${responseTime}мс)`;
            }
            break;
        case 'slow':
            textEl.textContent = `🟡 Медленное соединение (${responseTime || '?'}мс)`;
            break;
        case 'offline':
            textEl.textContent = '🔴 Нет соединения с сервером';
            break;
    }
}

// Запуск проверки соединения
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        checkConnection();
        setInterval(checkConnection, 10000); // Каждые 10 секунд
    }, 1000);
}); 