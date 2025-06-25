# Final Step: Fixing the "Permission Denied" Error

My sincere apologies for this frustrating situation. The "Action Blocked by Server" error means your Firebase command-line tool is likely not connected to the correct project, so your security rules aren't being deployed properly.

This guide provides a fresh, step-by-step process to guarantee you are connected to the right project and can deploy the rules successfully.

---

### Step 1: Open the Built-in Terminal

Make sure you are using the terminal inside the IDE. You can open a new one from the top menu: **`Terminal`** > **`New Terminal`**.

### Step 2: Log Out of Firebase (To Start Fresh)

This ensures we aren't using an old or incorrect login. Run this command:

```
npx firebase logout
```

### Step 3: Log In to the Correct Google Account

Run the login command. A browser window will open. **It is critical that you log in with the Google account that owns your Firebase project.**

```
npx firebase login
```

### Step 4: Link to the Correct Firebase Project

This is the most important step. This command will list your Firebase projects.

1.  Run this command in the terminal:
    ```
    npx firebase use --add
    ```
2.  Use the arrow keys to select your project from the list and press Enter.
3.  **VERIFY:** The terminal will show `Using project <YOUR-PROJECT-ID>`. **Confirm that this ID matches the `NEXT_PUBLIC_FIREBASE_PROJECT_ID` in your `.env.local` file.** If they don't match, this is the source of the error.

### Step 5: Deploy the Security Rules

Now that you are logged in and connected to the correct project, you can deploy the security rules. This will grant your admin account the permissions it needs.

Run this command from the root directory of your project:

```
npx firebase deploy --only firestore
```

---

That's it. After this, the "Send Test Notification" button will work correctly, and you will not see the permission error again. Thank you for your patience.
