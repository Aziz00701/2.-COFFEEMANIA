const ADMIN_CACHE_NAME = 'coffeemania-admin-v1.1.0';
const adminUrlsToCache = [
  '/admin.html',
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

// Install event - cache admin resources
self.addEventListener('install', event => {
  console.log('🔧 ADMIN SW v1.1.0: Installing...');
  event.waitUntil(
    caches.open(ADMIN_CACHE_NAME)
      .then(cache => {
        console.log('🔧 ADMIN SW: Кэширование админских файлов');
        return cache.addAll(adminUrlsToCache);
      })
      .then(() => {
        console.log('✅ ADMIN SW: Установлен успешно');
        return self.skipWaiting();
      })
      .catch(error => {
        console.error('❌ ADMIN SW: Ошибка установки:', error);
      })
  );
});

// Activate event - cleanup old caches and take control
self.addEventListener('activate', event => {
  console.log('🔧 ADMIN SW v1.1.0: Активация...');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName.startsWith('coffeemania-admin-') && cacheName !== ADMIN_CACHE_NAME) {
            console.log('🗑️ ADMIN SW: Удаление старого кэша', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      console.log('✅ ADMIN SW: Активирован успешно');
      return self.clients.claim();
    })
  );
});

// Fetch event - admin specific caching strategy
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  
  // Only handle requests within admin scope
  if (!url.pathname.includes('admin') && !adminUrlsToCache.includes(url.pathname) && !adminUrlsToCache.includes(event.request.url)) {
    return;
  }
  
  // API requests - Network First with fast timeout
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      Promise.race([
        fetch(event.request, { 
          signal: AbortSignal.timeout(3000),
          cache: 'no-cache' 
        }).catch(error => {
          console.log('⚡ ADMIN SW: API недоступен:', url.pathname);
          
          // Return fallback data for critical APIs
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
          setTimeout(() => reject(new Error('API timeout')), 3000)
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
  
  // Static files - Cache First for admin resources
  if (adminUrlsToCache.some(cachedUrl => url.pathname === cachedUrl || event.request.url === cachedUrl)) {
    event.respondWith(
      caches.match(event.request)
        .then(response => {
          if (response) {
            console.log('⚡ ADMIN SW: Мгновенная загрузка из кэша:', url.pathname);
            
            // Background update for better UX
            fetch(event.request).then(fetchResponse => {
              if (fetchResponse && fetchResponse.status === 200) {
                caches.open(ADMIN_CACHE_NAME).then(cache => {
                  cache.put(event.request, fetchResponse.clone());
                });
              }
            }).catch(() => {
              // Silent fail for background updates
            });
            
            return response;
          }
          
          return fetch(event.request).then(fetchResponse => {
            if (fetchResponse && fetchResponse.status === 200) {
              caches.open(ADMIN_CACHE_NAME).then(cache => {
                cache.put(event.request, fetchResponse.clone());
              });
            }
            return fetchResponse;
          });
        })
    );
    return;
  }
  
  // Everything else - Network First with timeout
  event.respondWith(
    fetch(event.request, { signal: AbortSignal.timeout(5000) })
      .catch(() => {
        return caches.match(event.request);
      })
  );
});

// Handle PWA installation events
self.addEventListener('beforeinstallprompt', event => {
  console.log('📱 ADMIN SW: beforeinstallprompt готов');
  // Don't prevent the default here, let the main thread handle it
});

self.addEventListener('appinstalled', event => {
  console.log('🎉 ADMIN SW: PWA приложение успешно установлено');
});

console.log('🔧 COFFEEMANIA Admin Service Worker v1.1.0 загружен'); 