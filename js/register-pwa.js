if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register(new URL('../sw.js', import.meta.url)).catch((error) => {
    console.warn('KAELION service worker registration failed', error);
  });
}
