# Step-by-Step Guide: Setting Up Push Notifications

This guide will walk you through the entire process of enabling push notifications for your application. This involves three main stages: generating secure keys, configuring your Next.js app, and deploying a server-side Firebase Function to send the notifications.

## Step 1: Generate Your VAPID Keys

VAPID keys are a secure key pair that allows your server to send messages to your users. The easiest way to get these is from the admin page of your running application.

1.  **Navigate to the Admin Page:** Open your app in the browser and go to the `/admin` page.
2.  **Find the Generator:** Look for the card titled **"Push Notification VAPID Keys"**.
3.  **Click to Generate:** Click the **"Generate Keys"** button. The page will display your unique Public Key, Private Key, and a command to run later.

Keep this page open. You will need to copy these values in the next steps.

## Step 2: Configure the App with the Public Key

The Public Key needs to be added to your app's environment variables so it can ask users to subscribe to notifications.

1.  In your project's code editor, find or create a file named `.env.local` in the root directory (the same level as `package.json`).
2.  Open the `.env.local` file and add the following line, pasting your **Public Key** where indicated:

    ```bash
    NEXT_PUBLIC_VAPID_PUBLIC_KEY="PASTE_YOUR_PUBLIC_KEY_HERE"
    ```

3.  **Crucial:** After saving this file, you must **restart your Next.js development server** for the new environment variable to be loaded.

## Step 3: Set Up the Firebase Functions Environment

Now, we'll set up the server-side component. This requires a **Firebase Function**, which is code that runs on Google's servers, not in the user's browser. You'll need to use your terminal for these steps.

### 3.1: Install Firebase Tools

If you don't have it installed already, you need the Firebase command-line interface (CLI).

```bash
npm install -g firebase-tools
```

### 3.2: Log In to Firebase

Connect the CLI to your Firebase account. This will open a new browser window to authenticate you.

```bash
firebase login
```

### 3.3: Initialize Firebase Functions

Now, we'll create the necessary files for your function. Run this command from the **root directory** of your project.

```bash
firebase init functions
```

The command will ask you a series of questions. Use these answers:
- **What language would you like to use to write Cloud Functions?** `TypeScript` (Use the arrow keys to select, then press Enter)
- **Do you want to use ESLint to catch probable bugs and enforce style?** `Yes`
- **File functions/package.json already exists. Overwrite?** `No`
- **File functions/tsconfig.json already exists. Overwrite?** `No`
- **File functions/.eslintrc.js already exists. Overwrite?** `No`
- **File functions/src/index.ts already exists. Overwrite?** `No` (Note: If this is a fresh setup, you might not see all these "overwrite" questions.)
- **Do you want to install dependencies with npm now?** `Yes`

This will create a new `functions` directory in your project.

## Step 4: Add the Function Code and Dependencies

### 4.1: Add the `web-push` Library

Your function needs a library to help send notifications. Navigate into the new `functions` directory and add it.

```bash
cd functions
npm install web-push
cd ..
```

### 4.2: Add the Function Code

Replace the entire content of the file at `functions/src/index.ts` with the code below. This code creates a function that automatically triggers whenever a shift is created or updated in your Firestore database.

```typescript
import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import * as webpush from "web-push";

// Initialize the Firebase Admin SDK
admin.initializeApp();

// You will set these in the next step using the Firebase CLI
const vapidPublicKey = functions.config().webpush.public_key;
const vapidPrivateKey = functions.config().webpush.private_key;

// Configure the web-push library with your VAPID keys
webpush.setVapidDetails(
  "mailto:your-email@example.com", // IMPORTANT: Replace with your contact email
  vapidPublicKey,
  vapidPrivateKey,
);

/**
 * Interface for the data stored for a push subscription.
 */
interface PushSubscription {
  endpoint: string;
  expirationTime?: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
}

/**
 * This function triggers whenever a document in the 'shifts' collection is written (created or updated).
 * It sends a push notification to the user associated with that shift.
 */
export const sendShiftNotification = functions.firestore
  .document("shifts/{shiftId}")
  .onWrite(async (change) => {
    // Exit if the shift was deleted (no "after" data)
    if (!change.after.exists) {
      functions.logger.log(`Shift ${change.before.id} was deleted. No notification sent.`);
      return null;
    }

    const shiftData = change.after.data();
    const userId = shiftData.userId;

    if (!userId) {
        functions.logger.log(`Shift ${change.after.id} has no userId. No notification sent.`);
        return null;
    }

    // Get all the saved push subscriptions for the affected user
    const subscriptionsSnapshot = await admin.firestore()
      .collection("users").doc(userId).collection("pushSubscriptions").get();

    if (subscriptionsSnapshot.empty) {
      functions.logger.log("No push subscriptions found for user:", userId);
      return null;
    }

    // Create the notification content
    const payload = JSON.stringify({
      title: "Shift Update!",
      body: `Your shift for '${shiftData.task}' at ${shiftData.address} has been updated.`,
      icon: "/icons/icon-192x192.png" // Optional: icon for the notification
    });

    const notificationPromises = subscriptionsSnapshot.docs.map(async (subDoc) => {
        const subscription = subDoc.data() as PushSubscription;
        try {
            await webpush.sendNotification(subscription, payload);
        } catch (error: any) {
            // If a subscription is expired or invalid (e.g., user cleared browser data), delete it
            if (error.statusCode === 404 || error.statusCode === 410) {
                functions.logger.log(`Subscription ${subDoc.id} has expired or is no longer valid. Deleting it.`);
                await subDoc.ref.delete();
            } else {
                functions.logger.error(`Error sending notification to ${subDoc.id}, subscription not deleted.`, error);
            }
        }
    });

    await Promise.all(notificationPromises);
    return null;
  });
```

## Step 5: Securely Store Your Keys and Deploy

Your **Private Key** is a secret and must not be saved directly in your code. You'll use Firebase's configuration system to store it securely.

1.  Open a terminal in your project's **root directory**.
2.  Run the following command, which was also provided by the in-app generator on the Admin page. This command securely stores your keys as environment variables for your Firebase Function.

    ```bash
    firebase functions:config:set webpush.public_key="PASTE_PUBLIC_KEY_HERE" webpush.private_key="PASTE_PRIVATE_KEY_HERE"
    ```

3.  Finally, deploy your function to Firebase:

    ```bash
    firebase deploy --only functions
    ```

---

**That's it!** Once the function is deployed, your application will be fully configured to send push notifications to users whenever their shifts are created or updated.
