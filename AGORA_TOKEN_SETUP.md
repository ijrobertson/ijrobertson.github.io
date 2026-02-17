# Agora Token Setup Instructions

Your Agora project requires token authentication. I've set up a Firebase Function to generate tokens securely. Follow these steps:

## Step 1: Copy Your Primary Certificate

1. Go to **Agora Console**: https://console.agora.io
2. Go to **Project Management**
3. Find your project (App ID: `dfd628e44de640e3b7717f422d1dc3e7`)
4. Click the **pencil/edit icon** next to your project
5. Under **"Primary Certificate"**, click the **copy icon** to copy it
6. **Save this somewhere temporarily** - you'll need it in the next step

⚠️ **Important**: Keep this certificate secret! Never commit it to GitHub or share it publicly.

## Step 2: Set the Certificate as a Firebase Environment Variable

Run this command in your terminal (replace `YOUR_CERTIFICATE_HERE` with the actual certificate you copied):

```bash
cd /home/ianjack/ijrobertson.github.io
firebase functions:config:set agora.app_certificate="YOUR_CERTIFICATE_HERE"
```

**Example:**
```bash
firebase functions:config:set agora.app_certificate="a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"
```

You should see a success message like:
```
✔  Functions config updated.
```

## Step 3: Deploy the Firebase Function

Deploy the new token generation function:

```bash
firebase deploy --only functions
```

This will deploy the `generateAgoraToken` function to Firebase.

**Expected output:**
```
✔  Deploy complete!

Functions:
  generateAgoraToken(us-central1)
```

## Step 4: Test the Video Call!

1. Go to https://linguabud.com/video-call.html
2. Enter a channel name
3. Click "Join Call"
4. The app will now:
   - Request a token from your Firebase Function
   - Use the token to join the Agora channel
   - Start the video call!

## Troubleshooting

### "Failed to generate token from server"
- Make sure you deployed the function: `firebase deploy --only functions`
- Check Firebase Console for function errors: https://console.firebase.google.com/

### "AGORA_APP_CERTIFICATE not configured"
- You need to set the environment variable (Step 2)
- Make sure you used the correct command
- Check if it's set: `firebase functions:config:get`

### Function deployment fails
- Make sure you're in the right directory: `/home/ianjack/ijrobertson.github.io`
- Try: `firebase login` to ensure you're logged in
- Check your Firebase project is set: `firebase use --list`

## Verify Environment Variable

To check if the certificate is set correctly:

```bash
firebase functions:config:get
```

You should see:
```json
{
  "agora": {
    "app_certificate": "your-certificate-here"
  }
}
```

## How It Works

1. **Client** (video-call.html) requests a token from Firebase Function
2. **Server** (Firebase Function) generates a secure token using:
   - Your App ID
   - Your App Certificate (from environment variable)
   - Channel name
   - User ID
3. **Token** is sent back to client
4. **Client** uses token to join Agora video channel

This is the secure, production-ready way to handle Agora authentication!

## Next Steps

Once this is working, you can:
- Add recording features
- Implement real-time translation
- Add whiteboard/flashcard features
- Set up screen sharing

All of these are documented in `AGORA_VIDEO_SETUP.md`.
