/* global self */
self.addEventListener("push", (event) => {
  let payload;
  try {
    payload = event.data?.json();
  } catch {
    payload = null;
  }
  event.waitUntil(self.registration.showNotification(
    typeof payload?.title === "string" ? payload.title : "Deltatime",
    { body: typeof payload?.body === "string" ? payload.body : "You have a reminder." },
  ));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const destination = new URL("/calendar", self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const calendar = windows.find((client) => new URL(client.url).pathname === "/calendar");
    if (calendar) await calendar.focus();
    else await self.clients.openWindow(destination);
  })());
});
