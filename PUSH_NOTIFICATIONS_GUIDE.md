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

This command connects your project to your Firebase account. It will open a browser window for you to log in. Run this in the built-in terminal.

**Important:** Copy *only the text inside the box* and paste it into the terminal.

```
npx firebase login
```

## Step 2: Link Your Project to Firebase

This command links this code to your specific Firebase project. You only need to do this once.

1.  Run the following command in the built-in terminal:
    ```
    npx firebase use --add
    ```
2.  You will be shown a list of your Firebase projects. Use the arrow keys on your keyboard to select the project you are using for this application, and then press Enter.

## Step 3: Generate and Configure Your VAPID Keys

VAPID keys are a secure key pair that allows your server to send messages.

1.  **Generate Keys in the App:** Go to the `/admin` page of your running application. In the "Push Notification VAPID Keys" card, click **Generate Keys**. This will display your unique Public Key, Private Key, and a command to run. Keep this page open.

2.  **Set the Public Key:** In your project's code editor, open the file named `.env.local`. Add your **Public Key** to it like this:
    ```
    NEXT_PUBLIC_VAPID_PUBLIC_KEY="PASTE_YOUR_PUBLIC_KEY_HERE"
    ```
    **Important: How to Restart the Server**
    After you save the `.env.local` file, you **must restart** the development server. Look at the top of the panel where your running app is displayed. You should see a **circular arrow icon** (the restart button). Click it to apply the changes.

3.  **Securely Store Both Keys for the Server:** The **Private Key** is a secret and must not be saved in your code. Copy the full command provided by the key generator on the Admin page (it starts with `npx firebase functions:config:set...`) and run it in the built-in terminal.

## Step 4: Deploy Your Function

Finally, deploy the pre-built function to Firebase. This makes the server-side code live. Run this command from the **root directory** of your project in the built-in terminal.

**Important:** Copy *only the text inside the box* and paste it into the terminal.

```
npx firebase deploy --only functions
```

---

**That's it!** You're done. The "install dependencies" step from the previous guide has been automated. Your application is now fully configured to send push notifications.
