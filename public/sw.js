const CACHE_NAME = 'coffeemania-v2.0.0';
const urlsToCache = [
  '/',
  '/index.html',
  '/card.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/icon.svg',
  // Google Fonts
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap',
  // jsQR Library
  'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js'
];

// Install event - cache resources
self.addEventListener('install', event => {
  console.log('COFFEEMANIA SW: Installing...');
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
  console.log('COFFEEMANIA SW: Активация...');
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
  // Игнорируем запросы к API для динамических данных
  if (event.request.url.includes('/api/')) {
    // Для API запросов используем network-first стратегию
    event.respondWith(
      fetch(event.request)
        .then(response => {
          // Если запрос успешен, возвращаем ответ
          return response;
        })
        .catch(() => {
          // Если сеть недоступна, возвращаем кэшированную версию если есть
          return caches.match(event.request);
        })
    );
    return;
  }

  // Для статических ресурсов используем cache-first стратегию
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Если есть в кэше, возвращаем кэшированную версию
        if (response) {
          // Параллельно обновляем кэш в фоне
          fetch(event.request)
            .then(fetchResponse => {
              if (fetchResponse && fetchResponse.status === 200) {
                const responseClone = fetchResponse.clone();
                caches.open(CACHE_NAME)
                  .then(cache => {
                    cache.put(event.request, responseClone);
                  });
              }
            })
            .catch(() => {
              // Игнорируем ошибки фонового обновления
            });
          
          return response;
        }

        // Если нет в кэше, загружаем из сети
        return fetch(event.request)
          .then(fetchResponse => {
            // Проверяем валидность ответа
            if (!fetchResponse || fetchResponse.status !== 200 || fetchResponse.type !== 'basic') {
              return fetchResponse;
            }

            // Клонируем ответ для кэширования
            const responseToCache = fetchResponse.clone();

            caches.open(CACHE_NAME)
              .then(cache => {
                cache.put(event.request, responseToCache);
              });

            return fetchResponse;
          })
          .catch(() => {
            // Если запрос не удался и это HTML страница, возвращаем офлайн страницу
            if (event.request.destination === 'document') {
              return caches.match('/index.html');
            }
          });
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
