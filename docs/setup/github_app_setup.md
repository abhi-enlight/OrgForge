# GitHub App Setup Guide

OrgForge uses a GitHub App to write audit logs and interact with connected GitHub repositories. Follow these steps to create your GitHub App and obtain the necessary environment variables for your backend.

## 1. Create a New GitHub App

1. Go to your GitHub account or organization settings.
2. Navigate to **Developer settings** > **GitHub Apps**.
3. Click **New GitHub App**.

## 2. Configure the GitHub App

Fill out the form with the following details:

- **GitHub App name**: Give it a recognizable name (e.g., `OrgForge Audit <YourOrg>`). Note that this name must be globally unique across GitHub.
- **Homepage URL**: Your frontend URL (e.g., `https://orgforge.vercel.app`).
- **Callback URL**: Your backend's callback route, e.g., `https://<your-render-app>.onrender.com/api/v1/auth/github/callback`. (If running locally, use `http://localhost:3001/api/v1/auth/github/callback`).
- **Setup URL**: You can leave this blank, or point it to your frontend settings page.
- **Webhook**: If your application does not actively process GitHub webhook events, you can **uncheck "Active"**. Otherwise, provide your backend webhook URL.

### Permissions
Set the following permissions depending on what the app needs to do (typically for OrgForge):
- **Repository contents**: Read & write (to commit audit logs).
- **Metadata**: Read-only (mandatory for all apps).

### Where can this GitHub App be installed?
- Select **Any account** if you plan to let multiple tenants install it, or **Only on this account** if it's purely for internal use.

Click **Create GitHub App**.

## 3. Gather Environment Variables

Once created, you will be on the app's settings page. Gather the following values for your `.env` (or Render environment):

1. **`GITHUB_APP_ID`**: Found at the top of the General settings page under "App ID".
2. **`GITHUB_CLIENT_ID`**: Found under the "Client ID" section.
3. **`GITHUB_CLIENT_SECRET`**: Click **Generate a new client secret**, copy the value immediately, and save it.
4. **`GITHUB_PRIVATE_KEY`**: Scroll down to "Private keys" and click **Generate a private key**. This will download a `.pem` file to your computer.
   - Open the `.pem` file in a text editor.
   - Copy the entire contents (including `-----BEGIN RSA PRIVATE KEY-----` and `-----END RSA PRIVATE KEY-----`).
   - If setting this in a `.env` file, ensure you quote the string to preserve newlines, or follow your hosting provider's instructions for multiline secrets.
5. **`GITHUB_APP_SLUG`**: This is the URL-friendly name of your app. You can find it in the public link to your app, or at the end of the URL when viewing its settings (e.g., `orgforge-audit-myorg`).

## 4. Update Your Deployment

Add these 5 keys to your backend environment variables (e.g., on Render). Once deployed, users will be able to connect their repositories via the OrgForge Settings page.
