const CACHE_NAME = 'coffeemania-v2.4.0';
const urlsToCache = [
  '/',
  '/index.html',
  '/card.html',
  '/manifest.json',
  '/client-manifest.json',
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
  console.log('COFFEEMANIA SW v2.4.0: Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('COFFEEMANIA SW: Кэширование файлов');
        return cache.addAll(urlsToCache);
      })
      .then(() => {
        console.log('COFFEEMANIA SW: Установлен успешно');
        return self.skipWaiting();
      })
  );
});

// Activate event - cleanup old caches and take control
self.addEventListener('activate', event => {
  console.log('COFFEEMANIA SW v2.4.0: Активация...');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName.startsWith('coffeemania-v') && cacheName !== CACHE_NAME) {
            console.log('COFFEEMANIA SW: Удаление старого кэша', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      console.log('COFFEEMANIA SW: Активирован успешно');
      return self.clients.claim();
    })
  );
});

// Fetch event - serve from cache when offline, update cache when online
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  
  // Skip admin requests - they have their own SW
  if (url.pathname.includes('admin')) {
    return;
  }
  
  // Handle personalized manifests
  if (url.pathname.match(/^\/manifest-[\w\d-]+\.json$/)) {
    event.respondWith(
      fetch(event.request, { 
        signal: AbortSignal.timeout(5000),
        cache: 'no-cache' 
      }).then(response => {
        if (response.ok) {
          // Cache personalized manifest for short time
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, response.clone());
          });
        }
        return response;
      }).catch(() => {
        // Fallback to cached version if available
        return caches.match(event.request);
      })
    );
    return;
  }
  
  // API requests - Network First with timeout
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      Promise.race([
        fetch(event.request, { 
          signal: AbortSignal.timeout(2000),
          cache: 'no-cache' 
        }).catch(error => {
          console.log('SW: API недоступен, используем заглушку:', url.pathname);
          
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
          
          return new Response(JSON.stringify({ error: 'Сервер недоступен' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' }
          });
        }),
        
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('API timeout')), 2000)
        )
      ]).catch(() => {
        return new Response(JSON.stringify({ error: 'Соединение недоступно' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        });
      })
    );
    return;
  }
  
  // Static files - Cache First
  if (urlsToCache.some(cachedUrl => url.pathname === cachedUrl || event.request.url === cachedUrl)) {
    event.respondWith(
      caches.match(event.request)
        .then(response => {
          if (response) {
            console.log('SW: Мгновенная загрузка из кэша:', url.pathname);
            
            // Background update
            fetch(event.request).then(fetchResponse => {
              if (fetchResponse && fetchResponse.status === 200) {
                caches.open(CACHE_NAME).then(cache => {
                  cache.put(event.request, fetchResponse.clone());
                });
              }
            }).catch(() => {});
            
            return response;
          }
          
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
  
  // Everything else - Network First
  event.respondWith(
    fetch(event.request, { signal: AbortSignal.timeout(3000) })
      .catch(() => {
        return caches.match(event.request);
      })
  );
});

// Background sync
self.addEventListener('sync', event => {
  console.log('COFFEEMANIA SW: Background sync', event.tag);
  
  if (event.tag === 'background-sync') {
    event.waitUntil(
      console.log('COFFEEMANIA SW: Выполнение фоновой синхронизации')
    );
  }
});

// Push notifications
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
    event.waitUntil(clients.openWindow('/card.html'));
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

console.log('🔧 COFFEEMANIA Client Service Worker загружен');
