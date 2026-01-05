
# Push Notifications Guide

This application uses Web Push Notifications to send real-time updates about shifts to users. This feature relies on a combination of frontend browser capabilities and backend Cloud Functions.

## How it Works

1.  **Subscription**: When a user clicks the "bell" icon in the header, the browser asks for permission to show notifications. If granted, the browser's unique push subscription details are saved to your Firestore database.
2.  **Trigger**: When a shift is created, updated, or deleted in Firestore, it triggers the `sendShiftNotification` Cloud Function.
3.  **Sending**: The Cloud Function looks up the assigned user's push subscription(s) and uses the `web-push` library to send a notification payload.
4.  **Receiving**: A Service Worker running in the user's browser receives the push event (even if the app is not open) and displays the notification.

## Setup: VAPID Keys

To send push notifications, your application needs a set of VAPID (Voluntary Application Server Identification) keys. This is a public/private key pair that identifies your application server.

**The keys must be configured as environment parameters for your Cloud Functions.**

### Instructions for Setup

You can configure the keys from the **Admin** page in the application itself.

1.  Navigate to the `/admin` page.
2.  Locate the **VAPID Key Status** card. It will tell you if keys are already configured.
3.  If keys are not configured, follow the step-by-step instructions in the card:
    *   **Step 1:** Install `web-push` globally using `npm`.
    *   **Step 2:** Run `web-push generate-vapid-keys` in your terminal to create a new key pair. Keep them safe.
    *   **Step 3:** Copy the provided Firebase CLI command from the admin panel. It will look like this: `firebase functions:params:set webpush_public_key='YOUR_PUBLIC_KEY' webpush_private_key='YOUR_PRIVATE_KEY'`. Paste your generated keys into this command.
    *   **Step 4:** Run the command in your project's root directory.
    *   **Step 5:** Redeploy your functions by running `firebase deploy --only functions`.

After redeploying, the Admin panel should show a "Configuration Complete" message, and the notification system will be active.

## Testing

Use the **Send a Test Notification** card in the Admin panel to send a test notification to any registered user who has subscribed in their browser. This is the best way to verify that your entire setup is working correctly.
