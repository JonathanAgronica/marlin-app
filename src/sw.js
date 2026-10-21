/* Mac's Marlin service worker __BUILD__ — only touches caches prefixed "macsmarlin-" (the github.io origin is shared with Mac's Jacks) */
const CACHE='macsmarlin-__BUILD__',DATA='macsmarlin-data',TILES='macsmarlin-tiles',TILE_MAX=600;
const ASSETS=['./','./index.html','./manifest.webmanifest','./icons/icon-180.png','./icons/icon-192.png','./icons/icon-512.png','./icons/icon-64.png','./icons/maskable-192.png','./icons/maskable-512.png','./vendor/leaflet/leaflet.js','./vendor/leaflet/leaflet.css'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS.map(u=>new Request(u,{cache:'reload'})))).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>/^macsmarlin-\d/.test(k)&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
const put=(name,req,res)=>caches.open(name).then(c=>c.put(req,res));
self.addEventListener('fetch',e=>{const r=e.request;if(r.method!=='GET')return;const u=new URL(r.url);
  if(u.hostname==='server.arcgisonline.com'){e.respondWith(fetch(r).then(res=>{if(res.ok||res.type==='opaque'){const c=res.clone();caches.open(TILES).then(ca=>ca.put(r,c).then(()=>ca.keys()).then(ks=>ks.length>TILE_MAX&&Promise.all(ks.slice(0,ks.length-TILE_MAX).map(k=>ca.delete(k)))));}return res;}).catch(()=>caches.open(TILES).then(ca=>ca.match(r)).then(m=>m||new Response('',{status:504}))));return;}
  if(u.origin!==location.origin||!u.pathname.includes('/marlin-app/'))return; /* APIs (Open-Meteo): network only */
  if(u.pathname.includes('/data/')){e.respondWith(fetch(r,{cache:'no-cache'}).then(res=>{if(res.ok)put(DATA,u.pathname,res.clone());return res;}).catch(()=>caches.open(DATA).then(c=>c.match(u.pathname)).then(m=>m||caches.match(r)).then(m=>m||new Response('{}',{status:503}))));return;}
  if(r.mode==='navigate'){e.respondWith(fetch(r).then(res=>{if(res.ok)put(CACHE,'./index.html',res.clone());return res;}).catch(()=>caches.match('./index.html')));return;}
  e.respondWith(caches.match(r,{ignoreSearch:true}).then(m=>m||fetch(r)));});
