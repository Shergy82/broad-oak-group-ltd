
'use client';

// NOTE: This entire hook is temporarily disabled to ensure application stability.
// The full functionality will be restored once build issues are resolved.

export function usePushNotifications() {
  return { 
    isSupported: false, 
    isSubscribed: false, 
    isSubscribing: false, 
    subscribe: () => Promise.resolve(), 
    unsubscribe: () => Promise.resolve() 
  };
}
