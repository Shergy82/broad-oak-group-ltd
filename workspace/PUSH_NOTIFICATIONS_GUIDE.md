
# Push Notifications Setup Guide

This guide will walk you through the one-time setup required to get push notifications working in your application. Follow these steps carefully.

## Step 1: Generate & Configure Security Keys

Push notifications require a set of security keys called "VAPID keys". Your server uses these to send notifications securely.

1.  **Navigate to the Admin Page**: In your running application, go to the `/admin` page.
2.  **Generate Keys**: Find the card titled **Push Notification VAPID Keys** and click the **Generate Keys** button. This will reveal two setup steps.
3.  **Step 1: Configure the Server**:
    *   Click the **Copy** button to copy the entire `npx firebase ...` command.
    *   Paste this command into your terminal and press Enter. This securely saves your keys on the Firebase server where your function can access them.
4.  **Step 2: Configure the Client App**:
    *   In the root directory of your project, create a new file named `.env.local` if it doesn't already exist.
    *   Click the **Copy** button for the environment variable (`NEXT_PUBLIC_VAPID_PUBLIC_KEY=...`).
    *   Paste this line into your `.env.local` file.
    *   **Crucially, you must now restart your Next.js development server** for this change to take effect. Use `Ctrl+C` in the terminal where the server is running, and then run `npm run dev` again.

## Step 2: Deploy Your Cloud Function

The code that sends notifications runs on a server as a "Cloud Function". If it hasn't been deployed, nothing can be sent.

1.  Open your terminal.
2.  Run the following command:
    ```bash
    npx firebase deploy --only functions
    ```
3.  Wait for the command to complete. It may take a minute or two. Once it says "Deploy complete!", your function is live.

## Step 3: Subscribe to Notifications in Your Browser

You must give the website permission to send you notifications.

1.  After completing the steps above and restarting your server, refresh the application in your browser.
2.  In the header of the app, find the **bell icon**.
3.  Click the bell icon. Your browser will pop up a dialog asking for permission to show notifications.
4.  Click **Allow**.
5.  The icon should change to a **ringing bell**, which confirms you are subscribed.

## Troubleshooting

If you are still not receiving notifications after following all the steps:

*   **Check the Function Logs**: Go to the [Firebase Console](https://console.firebase.google.com/), select your project, navigate to **Functions** in the "Build" menu, and click the **Logs** tab. Send a test notification from the Admin page and look for any new error messages in the logs.
*   **Check Browser Permissions**: In your browser's address bar, click the lock icon to see site settings and ensure that "Notifications" are set to "Allow".
*   **Check `.env.local`**: Ensure you correctly copied the public key into `.env.local` and that you restarted your development server afterward.
