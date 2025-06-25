
'use server';

import { functions } from '@/lib/firebase';
import { httpsCallable } from 'firebase/functions';

// This function will only ever run on the server.
export async function generateVapidKeysAction(): Promise<{ publicKey: string; privateKey: string }> {
  const webPush = require('web-push');
  return webPush.generateVAPIDKeys();
}

export async function sendTestShiftNotificationAction(userId: string): Promise<{ success: boolean; error?: string }> {
  if (!functions) {
    return { success: false, error: 'Firebase Functions are not initialized. Check your Firebase config.' };
  }
  if (!userId) {
    return { success: false, error: 'User ID is required.' };
  }

  try {
    // The string 'sendTestNotification' must match the exported function name in /functions/src/index.ts
    const sendTest = httpsCallable(functions, 'sendTestNotification');
    const result = await sendTest({ userId: userId });
    
    const data = result.data as { success: boolean; error?: string; message?: string };
    
    if (data.success) {
      return { success: true };
    } else {
      // Pass back any error or message from the cloud function
      return { success: false, error: data.error || data.message || 'The function returned a failure status.' };
    }

  } catch (error: any) {
    console.error('Error calling sendTestNotification function:', error);
    // HttpsError objects from Firebase have a 'code' and 'message' property
    const errorMessage = error.message || 'An unknown error occurred while calling the function.';
    return { success: false, error: errorMessage };
  }
}
