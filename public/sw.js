const CACHE_NAME = 'coffeemania-v2.3.0';
const urlsToCache = [
  '/',
  '/index.html',
  '/card.html',
  '/admin.html',
  '/manifest.json',
  '/admin-manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/icon.svg',
  '/connection-check.js',
  // Google Fonts
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap',
  // jsQR Library
  'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js'
];

// Install event - cache resources
self.addEventListener('install', event => {
  console.log('COFFEEMANIA SW v2.3.0: Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('COFFEEMANIA SW: Кэширование файлов');
        return cache.addAll(urlsToCache);
      })
      .then(() => {
        console.log('COFFEEMANIA SW: Установлен успешно');
        // Принудительно активируем новый SW
        return self.skipWaiting();
      })
  );
});

// Activate event - cleanup old caches and take control
self.addEventListener('activate', event => {
  console.log('COFFEEMANIA SW v2.3.0: Активация...');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('COFFEEMANIA SW: Удаление старого кэша', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      console.log('COFFEEMANIA SW: Активирован успешно');
      // Принудительно берем контроль над всеми клиентами
      return self.clients.claim();
    })
  );
});

// Fetch event - serve from cache when offline, update cache when online
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  
  // СТРАТЕГИЯ 1: API запросы - быстрый Network First с коротким таймаутом
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      Promise.race([
        // Быстрый сетевой запрос с таймаутом 2 секунды
        fetch(event.request, { 
          signal: AbortSignal.timeout(2000),
          cache: 'no-cache' 
        }).catch(error => {
          console.log('SW: API недоступен, используем заглушку:', url.pathname);
          
          // Возвращаем заглушки для критических API
          if (url.pathname === '/api/stats') {
            return new Response(JSON.stringify({
              totalCustomers: 0,
              totalPurchases: 0,
              readyForFreeCoffee: 0
            }), {
              status: 503,
              headers: { 'Content-Type': 'application/json' }
            });
          }
          
          // Для остальных API - просто ошибка
          return new Response(JSON.stringify({ error: 'Сервер недоступен' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' }
          });
        }),
        
        // Таймаут через 2 секунды
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('API timeout')), 2000)
        )
      ]).catch(() => {
        // Fallback при полном провале
        return new Response(JSON.stringify({ error: 'Соединение недоступно' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        });
      })
    );
    return;
  }
  
  // СТРАТЕГИЯ 2: Статические файлы - МГНОВЕННЫЙ Cache First
  if (urlsToCache.some(cachedUrl => url.pathname === cachedUrl || event.request.url === cachedUrl)) {
    event.respondWith(
      caches.match(event.request)
        .then(response => {
          if (response) {
            console.log('SW: Мгновенная загрузка из кэша:', url.pathname);
            
            // ПАРАЛЛЕЛЬНО обновляем кэш в фоне (stale-while-revalidate)
            fetch(event.request).then(fetchResponse => {
              if (fetchResponse && fetchResponse.status === 200) {
                caches.open(CACHE_NAME).then(cache => {
                  cache.put(event.request, fetchResponse.clone());
                });
              }
            }).catch(() => {
              // Игнорируем ошибки фонового обновления
            });
            
            return response;
          }
          
          // Если нет в кэше - запрашиваем из сети
          return fetch(event.request).then(fetchResponse => {
            if (fetchResponse && fetchResponse.status === 200) {
              caches.open(CACHE_NAME).then(cache => {
                cache.put(event.request, fetchResponse.clone());
              });
            }
            return fetchResponse;
          });
        })
    );
    return;
  }
  
  // СТРАТЕГИЯ 3: Все остальное - быстрый Network First
  event.respondWith(
    fetch(event.request, { signal: AbortSignal.timeout(3000) })
      .catch(() => {
        // При ошибке - пытаемся найти в кэше
        return caches.match(event.request);
      })
  );
});

// Background sync для отложенных запросов
self.addEventListener('sync', event => {
  console.log('COFFEEMANIA SW: Background sync', event.tag);
  
  if (event.tag === 'background-sync') {
    event.waitUntil(
      // Здесь можно добавить логику для синхронизации данных
      console.log('COFFEEMANIA SW: Выполнение фоновой синхронизации')
    );
  }
});

// Push notifications (для будущего использования)
self.addEventListener('push', event => {
  console.log('COFFEEMANIA SW: Push уведомление получено');
  
  const options = {
    body: event.data ? event.data.text() : 'Новое уведомление от COFFEEMANIA',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    vibrate: [100, 50, 100],
    data: {
      dateOfArrival: Date.now(),
      primaryKey: 1
    },
    actions: [
      {
        action: 'explore',
        title: 'Открыть приложение',
        icon: '/icon-192.png'
      },
      {
        action: 'close',
        title: 'Закрыть',
        icon: '/icon-192.png'
      }
    ]
  };

  event.waitUntil(
    self.registration.showNotification('COFFEEMANIA', options)
  );
});

// Notification click handler
self.addEventListener('notificationclick', event => {
  console.log('COFFEEMANIA SW: Клик по уведомлению');
  
  event.notification.close();

  if (event.action === 'explore') {
    // Открываем приложение
    event.waitUntil(
      clients.openWindow('/')
    );
  } else if (event.action === 'close') {
    // Просто закрываем уведомление
    event.notification.close();
  } else {
    // Действие по умолчанию - открыть приложение
    event.waitUntil(
      clients.openWindow('/')
    );
  }
});

// Message handler для связи с основным потоком
self.addEventListener('message', event => {
  console.log('COFFEEMANIA SW: Сообщение получено', event.data);
  
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  
  if (event.data && event.data.type === 'GET_VERSION') {
    event.ports[0].postMessage({ version: CACHE_NAME });
  }
});

// Error handler
self.addEventListener('error', event => {
  console.error('COFFEEMANIA SW: Ошибка', event.error);
});

// Unhandled rejection handler
self.addEventListener('unhandledrejection', event => {
  console.error('COFFEEMANIA SW: Необработанное отклонение', event.reason);
});

console.log('COFFEEMANIA SW: Service Worker загружен');
