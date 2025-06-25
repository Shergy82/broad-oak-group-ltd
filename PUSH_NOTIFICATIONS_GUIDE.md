# Step-by-Step Guide: Setting Up Push Notifications

This guide will walk you through the final steps to enable push notifications for your application. This process involves generating special keys from within the app and then setting up a server-side component using Firebase Functions.

## Step 1: Generate Your VAPID Keys

VAPID keys are a secure key pair that allows your server to send messages to your users. You can generate them directly from the admin page of your running application.

1.  **Navigate to the Admin Page:** Open your app in the browser and go to the `/admin` page.
2.  **Find the Generator:** Look for the card titled **"Push Notification VAPID Keys"**.
3.  **Click to Generate:** Click the **"Generate Keys"** button. The page will display your unique Public Key and Private Key.

Keep this page open so you can copy the keys in the next steps.

## Step 2: Configure the App with the Public Key

The Public Key needs to be added to your app's environment variables so it can ask users to subscribe to notifications.

1.  In your project's code editor, find or create a file named `.env.local` in the root directory (the same level as `package.json`).
2.  Open the `.env.local` file and add the following line, pasting your **Public Key** where indicated:

    ```bash
    NEXT_PUBLIC_VAPID_PUBLIC_KEY="PASTE_YOUR_PUBLIC_KEY_HERE"
    ```

3.  **Crucial:** After saving this file, you must **restart your Next.js development server** for the new environment variable to be loaded.

## Step 3: Set Up the Firebase Function (Server-Side)

The Private Key is a secret used by your server to actually send the notifications. This requires a **Firebase Function**, which is a piece of code that runs on Google's servers, not in the browser.

### 3.1: Set up a Firebase Functions Environment

If you haven't already, you need to initialize Firebase Functions in your project. You can follow the official [Firebase Functions "Get Started" guide](https://firebase.google.com/docs/functions/get-started).

### 3.2: Add the Function Code

Once you have a functions environment, you'll have a file (commonly `functions/index.js` or `functions/src/index.ts`). Replace its contents with the code below. This code creates a function that automatically triggers whenever a shift is created or updated in your Firestore database.

```javascript
// This is the full code for your Firebase Function
const functions = require('firebase-functions');
const admin = require('firebase-admin');
const webpush = require('web-push');

// Initialize the Firebase Admin SDK
admin.initializeApp();

// You will set these in the next step
const vapidPublicKey = functions.config().webpush.public_key;
const vapidPrivateKey = functions.config().webpush.private_key;

// Configure the web-push library with your VAPID keys
webpush.setVapidDetails(
  'mailto:your-email@example.com', // IMPORTANT: Replace with your contact email
  vapidPublicKey,
  vapidPrivateKey
);

/**
 * This function triggers whenever a document in the 'shifts' collection is written (created or updated).
 * It sends a push notification to the user associated with that shift.
 */
exports.sendShiftNotification = functions.firestore
  .document('shifts/{shiftId}')
  .onWrite(async (change, context) => {
    // Exit if the shift was deleted
    if (!change.after.exists) {
      return null;
    }

    const shiftData = change.after.data();
    const userId = shiftData.userId;

    // Get all the saved push subscriptions for the affected user
    const subscriptionsSnapshot = await admin.firestore()
      .collection('users').doc(userId).collection('pushSubscriptions').get();

    if (subscriptionsSnapshot.empty) {
      console.log('No push subscriptions found for user:', userId);
      return null;
    }

    // Create the notification content
    const payload = JSON.stringify({
      title: 'Shift Update!',
      body: `Your shift for '${shiftData.task}' at ${shiftData.address} has been updated.`
    });

    // Send a notification to each of the user's registered devices
    const promises = [];
    subscriptionsSnapshot.forEach(subDoc => {
      const subscription = subDoc.data();
      promises.push(
        webpush.sendNotification(subscription, payload)
          .catch(error => {
             // If a subscription is expired or invalid (e.g., user cleared browser data), delete it
            if (error.statusCode === 404 || error.statusCode === 410) {
              console.log('Subscription has expired or is no longer valid. Deleting it.', error);
              return subDoc.ref.delete();
            } else {
              console.error('Error sending notification, subscription not deleted.', error);
            }
          })
      );
    });

    return Promise.all(promises);
  });
```

### 3.3: Securely Store Your Keys and Deploy

Your **Private Key** is a secret and must not be saved directly in your code. You'll use Firebase's configuration system to store it securely.

1.  Open a terminal in your project's root directory.
2.  Run the following command, which was also provided by the in-app generator. This command securely stores your keys as environment variables for your Firebase Function.

    ```bash
    firebase functions:config:set webpush.public_key="PASTE_PUBLIC_KEY_HERE" webpush.private_key="PASTE_PRIVATE_KEY_HERE"
    ```

3.  Finally, deploy your function to Firebase:

    ```bash
    firebase deploy --only functions
    ```

---

**That's it!** Once the function is deployed, your application will be fully configured to send push notifications to users whenever their shifts are updated.
