# Step-by-Step Guide: Setting Up Push Notifications

This guide has been simplified to make it as easy as possible to get push notifications running. I've automated most of the setup.

All you need to do is run a few commands from the terminal inside this IDE. Using the built-in terminal is important because it's already configured correctly. You can usually open it by selecting `Terminal > New Terminal` from the menu at the top of the screen.

## Step 1: Log In to Firebase

This command connects your project to your Firebase account. It will open a browser window for you to log in. Run this in the terminal:

```bash
npx firebase login
```

## Step 2: Generate and Configure Your VAPID Keys

VAPID keys are a secure key pair that allows your server to send messages.

1.  **Generate Keys in the App:** Go to the `/admin` page of your running application. In the "Push Notification VAPID Keys" card, click **Generate Keys**. This will display your unique Public Key, Private Key, and a command to run. Keep this page open.

2.  **Set the Public Key:** In your project's code editor, open the file named `.env.local`. Add your **Public Key** to it like this:
    ```bash
    NEXT_PUBLIC_VAPID_PUBLIC_KEY="PASTE_YOUR_PUBLIC_KEY_HERE"
    ```
    **Important:** You must restart your Next.js development server after saving this file.

3.  **Securely Store Both Keys for the Server:** The **Private Key** is a secret and must not be saved in your code. Copy the full command provided by the key generator on the Admin page (it starts with `npx firebase functions:config:set...`) and run it in your terminal. This securely stores both keys for your Firebase Function.

## Step 3: Deploy Your Function

Finally, deploy the pre-built function to Firebase. This makes the server-side code live. Run this command from the **root directory** of your project in the terminal:

```bash
npx firebase deploy --only functions
```

---

**That's it!** You're done. The "install dependencies" step from the previous guide has been automated. Your application is now fully configured to send push notifications.
