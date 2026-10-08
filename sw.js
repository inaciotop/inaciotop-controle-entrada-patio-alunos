// IMPORTANTE: toda vez que você editar index.html, app.js ou o CSS,
// troque este número (v2 -> v3 -> v4...). É isso que avisa o navegador
// que existe uma versão nova para baixar.
const CACHE_NOME = 'secretaria-cache-v12';
const ARQUIVOS_ESSENCIAIS = [
    './',
    './index.html',
    './app.js',
    './manifest.webmanifest',
    './icon-192.png',
    './icon-512.png'
];

// Instala o service worker e guarda os arquivos essenciais em cache.
// NÃO chama skipWaiting() aqui de propósito: a nova versão fica "esperando"
// até o usuário confirmar a atualização (veja o banner em app.js).
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NOME).then((cache) => cache.addAll(ARQUIVOS_ESSENCIAIS))
    );
});

// Permite que a página peça para este SW assumir o controle imediatamente
self.addEventListener('message', (event) => {
    if (event.data && event.data.tipo === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});

// Remove caches antigos quando uma nova versão do app é instalada
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((nomes) =>
            Promise.all(
                nomes
                    .filter((nome) => nome !== CACHE_NOME)
                    .map((nome) => caches.delete(nome))
            )
        )
    );
    self.clients.claim();
});

// Estratégia: tenta a rede primeiro; se falhar (offline), usa o cache
self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;

    event.respondWith(
        fetch(event.request)
            .then((resposta) => {
                const respostaClone = resposta.clone();
                caches.open(CACHE_NOME).then((cache) => cache.put(event.request, respostaClone));
                return resposta;
            })
            .catch(() => caches.match(event.request))
    );
});
