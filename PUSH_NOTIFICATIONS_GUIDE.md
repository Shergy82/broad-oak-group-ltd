# Step-by-Step Guide: Setting Up Push Notifications

This guide has been simplified to make it as easy as possible to get push notifications running. I've automated most of the setup.

All you need to do is run a few commands from the **built-in terminal** inside this IDE. It's very important to use the correct terminal because it's already configured for you.

### How to Open the Built-in Terminal

1.  Look at the menu bar at the very top of the entire application window. You will see words like `File`, `Edit`, `View`, etc.
2.  Click on the word **`Terminal`** in that top menu.
3.  From the dropdown menu that appears, click on **`New Terminal`**.

A new panel will open at the bottom of the screen. **This is the correct terminal to use for all the commands below.**

---

## Step 1: Log In to Firebase

This command connects your project to your Firebase account. It will open a browser window for you to log in. Run this in the built-in terminal:

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

3.  **Securely Store Both Keys for the Server:** The **Private Key** is a secret and must not be saved in your code. Copy the full command provided by the key generator on the Admin page (it starts with `npx firebase functions:config:set...`) and run it in the built-in terminal. This securely stores both keys for your Firebase Function.

## Step 3: Deploy Your Function

Finally, deploy the pre-built function to Firebase. This makes the server-side code live. Run this command from the **root directory** of your project in the built-in terminal:

```bash
npx firebase deploy --only functions
```

---

**That's it!** You're done. The "install dependencies" step from the previous guide has been automated. Your application is now fully configured to send push notifications.
