const ensureCorrectServiceWorker = useCallback(async (): Promise<ServiceWorkerRegistration> => {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    throw new Error('Service workers not supported in this environment.');
  }

  // 1) Check existing registrations first (fast path)
  const regs = await navigator.serviceWorker.getRegistrations();
  const existing = regs.find((reg) => {
    const activeUrl =
      (reg as any)?.active?.scriptURL ||
      (reg as any)?.waiting?.scriptURL ||
      (reg as any)?.installing?.scriptURL ||
      '';
    return isFcmSwUrl(activeUrl);
  });

  if (existing) {
    // Ensure it's ready/active
    await navigator.serviceWorker.ready;
    return existing;
  }

  // 2) If not found, WAIT for the app-level ServiceWorkerRegistrar to register it
  //    (This avoids double-registration from inside the hook)
  const readyReg = await navigator.serviceWorker.ready;

  const readyUrl =
    (readyReg as any)?.active?.scriptURL ||
    (readyReg as any)?.waiting?.scriptURL ||
    (readyReg as any)?.installing?.scriptURL ||
    '';

  if (isFcmSwUrl(readyUrl)) {
    return readyReg;
  }

  // 3) One last re-check (sometimes ready reg isn't the FCM one)
  const regs2 = await navigator.serviceWorker.getRegistrations();
  const found2 = regs2.find((reg) => {
    const activeUrl =
      (reg as any)?.active?.scriptURL ||
      (reg as any)?.waiting?.scriptURL ||
      (reg as any)?.installing?.scriptURL ||
      '';
    return isFcmSwUrl(activeUrl);
  });

  if (found2) return found2;

  // If we get here, the registrar didn't register the FCM SW (or old SW still present)
  throw new Error(
    'FCM service worker not found. Ensure /firebase-messaging-sw.js is registered by ServiceWorkerRegistrar, then reload the page.'
  );
}, []);
