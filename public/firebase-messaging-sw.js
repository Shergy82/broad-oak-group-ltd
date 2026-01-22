/* firebase-messaging-sw.js
   No importScripts, no Firebase SDK.
   Handles Web Push payload directly (FCM WebPush payloads too).
*/

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch (e) {
    return {};
  }
}

function pick(obj, path, fallback) {
  // Very small helper to safely read nested values without optional chaining
  var cur = obj;
  for (var i = 0; i < path.length; i++) {
    if (!cur || typeof cur !== 'object') return fallback;
    cur = cur[path[i]];
  }
  return (cur === undefined || cur === null) ? fallback : cur;
}

async function setBadgeIfSupported(count) {
  try {
    if (typeof navigator !== 'undefined' && navigator.setAppBadge) {
      await navigator.setAppBadge(count);
    }
  } catch (e) {}
}

async function clearBadgeIfSupported() {
  try {
    if (typeof navigator !== 'undefined' && navigator.clearAppBadge) {
      await navigator.clearAppBadge();
    }
  } catch (e) {}
}

self.addEventListener('push', function (event) {
  var payload = {};

  // Parse payload
  try {
    payload = event.data ? event.data.json() : {};
  } catch (e) {
    payload = event.data ? safeJsonParse(event.data.text()) : {};
  }

  // FCM sometimes wraps fields differently. We support common shapes.
  var notification =
    payload.notification ||
    pick(payload, ['data', 'notification'], null) ||
    {};

  var title =
    notification.title ||
    payload.title ||
    'Broad Oak Group';

  var body =
    notification.body ||
    payload.body ||
    '';

  // Merge "data" fields (FCM data payload usually here)
  var dataObj = payload.data && typeof payload.data === 'object' ? payload.data : {};
  // Also copy top-level payload fields if needed
  // (but keep it small and safe)
  var clickUrl = dataObj.url || payload.url || '/';

  // Badge count (string in FCM data; convert to int)
  var badgeStr = dataObj.badge || payload.badge || '';
  var badgeNum = parseInt(badgeStr, 10);

  var options = {
    body: body,
    data: {
      // put everything we might need on click
      url: clickUrl,
      jobId: dataObj.jobId || payload.jobId || null,
      raw: dataObj, // useful for debugging / future use
    },
    // If you have an icon, keep this path valid
    // icon: '/icons/icon-192.png',
  };

  event.waitUntil(
    (async function () {
      // Set badge if supported and valid
      if (!isNaN(badgeNum) && badgeNum >= 0) {
        await setBadgeIfSupported(badgeNum);
      }

      await self.registration.showNotification(title, options);
    })()
  );
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();

  var url = '/';
  try {
    if (event.notification && event.notification.data && event.notification.data.url) {
      url = event.notification.data.url;
    }
  } catch (e) {}

  event.waitUntil(
    (async function () {
      // Clear badge on click (optional but usually expected)
      await clearBadgeIfSupported();

      var clientsArr = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });

      // If any window is open, focus it and navigate (where supported)
      for (var i = 0; i < clientsArr.length; i++) {
        var client = clientsArr[i];
        if (client && 'focus' in client) {
          try {
            if ('navigate' in client) {
              await client.focus();
              return client.navigate(url);
            }
          } catch (e) {
            // If navigate fails, at least focus
            return client.focus();
          }
          return client.focus();
        }
      }

      // Otherwise open a new window/tab
      if (self.clients.openWindow) {
        return self.clients.openWindow(url);
      }
    })()
  );
});
