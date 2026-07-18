/* FleetView — service worker. Vanilla, zéro dépendance.
   Rend la coquille disponible hors-ligne ; ne met JAMAIS en cache l'API GitHub. */
"use strict";

// Version du cache : à incrémenter quand la coquille change (purge les anciens à l'activation).
const VERSION = "fleetview-shell-v6";

// Coquille pré-cachée. Chemins RELATIFS : le SW vit sous /fleetview/ sur GitHub Pages,
// ils résolvent donc dans ce sous-dossier (et en local sous /).
const SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./icon.svg",
  "./icon-192.png",
  "./icon-512.png",
  "./maskable-192.png",
  "./maskable-512.png",
  "./apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Clic sur une notification native : rouvre (ou re-focalise) FleetView sur le bon projet.
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "./";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ("focus" in c) { if ("navigate" in c) c.navigate(url); return c.focus(); }
      }
      return self.clients.openWindow(url);
    })
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Cross-origin (api.github.com, Google Fonts…) : réseau direct, jamais mis en cache.
  if (url.origin !== self.location.origin) return;

  // Navigation : réseau d'abord (HTML toujours frais après déploiement),
  // repli sur la coquille en cache si hors-ligne.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req).catch(() => caches.match("./index.html").then((r) => r || caches.match("./")))
    );
    return;
  }

  // Autres ressources same-origin : stale-while-revalidate
  // (sert le cache tout de suite, met à jour en arrière-plan — la coquille se rafraîchit seule).
  e.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok && res.type === "basic") {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
