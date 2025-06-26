
# Push Notifications Setup Guide

This guide will walk you through the one-time setup required to get push notifications working in your application. Follow these steps carefully.

## Step 1: Deploy Your Cloud Function

Before you can configure keys, you must have successfully deployed your backend function code.

1.  Open your terminal in the project's root directory.
2.  Run the following command:
    ```bash
    npx firebase deploy --only functions
    ```
3.  Wait for the command to complete. If it fails, you must resolve the deployment errors before continuing.

## Step 2: Generate & Configure Security Keys

Once your function is deployed, you need to generate VAPID keys so your server can send notifications securely.

1.  **Navigate to the Admin Page**: In your running application, go to the `/admin` page.
2.  **Generate Keys**: Find the card titled **Push Notification VAPID Keys** and click the **Generate Keys** button. This will reveal two setup steps.
3.  **Step 2a: Configure the Server**:
    *   In the "Step 1" box on the admin page, click the **Copy** button to copy the entire `npx firebase functions:config:set ...` command.
    *   Paste this command into your terminal and press Enter. This securely saves your keys on the Firebase server where your cloud function can access them.
4.  **Step 2b: Configure the Client App**:
    *   In the "Step 2" box, click the **Copy** button for the environment variable (`NEXT_PUBLIC_VAPID_PUBLIC_KEY=...`).
    *   In the root directory of your project, create a new file named `.env.local` if it doesn't already exist.
    *   Paste the copied line into your `.env.local` file.
    *   **Crucially, you must now restart your Next.js development server** for this change to take effect. Use `Ctrl+C` in the terminal where the server is running, and then run `npm run dev` again.

## Step 3: Subscribe to Notifications in Your Browser

You must give the website permission to send you notifications.

1.  After completing the steps above and restarting your server, refresh the application in your browser.
2.  In the header of the app, find the **bell icon**.
3.  Click the bell icon. Your browser will pop up a dialog asking for permission to show notifications.
4.  Click **Allow**.
5.  The icon should change to a **ringing bell**, which confirms you are subscribed.

## Step 4: Test!

Use the "Send a Test Notification" card on the admin page to send a test message. If you receive it, the setup is complete!

## Troubleshooting

If you are still not receiving notifications after following all the steps:

*   **Check the Function Logs**: Go to the [Firebase Console](https://console.firebase.google.com/), select your project, navigate to **Functions** in the "Build" menu, and click the **Logs** tab. Send a test notification from the Admin page and look for any new error messages in the logs. An error saying "VAPID keys are not configured" means you missed or had an error with Step 2a.
*   **Check Browser Permissions**: In your browser's address bar, click the lock icon to see site settings and ensure that "Notifications" are set to "Allow".
*   **Check `.env.local`**: Ensure you correctly copied the public key into `.env.local` and that you restarted your development server afterward.
