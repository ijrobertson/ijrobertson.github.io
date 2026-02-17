# Agora Video Call Setup Guide

## Overview
Video calling has been integrated into Lingua Bud using Agora Web SDK. The implementation allows users to have one-on-one or group video calls for language practice.

## Files Added
- **video-call.html**: Main video calling interface

## Current Features
✅ Join/Leave video calls
✅ Real-time audio and video streaming
✅ Multiple participants support
✅ Firebase authentication integration
✅ Responsive design matching your site's theme
✅ Camera and microphone access
✅ Automatic cleanup on page close
✅ **Integrated with Messages page** - Video call button next to send button
✅ **Direct calling** - Automatic channel creation based on user pairs

## How It Works

### For Development (Current Setup)
The video call page is ready to use immediately for testing:

1. **Navigate to the page**: Go to `http://localhost:3000/video-call.html` (or your deployed site)
2. **Enter a channel name**: Users who enter the same channel name will join the same video room
3. **Click "Join Call"**: Browser will ask for camera/microphone permissions
4. **Video call begins**: You'll see your own video and any other participants who join the same channel

### User Flow

#### Option 1: Direct Call from Messages (Recommended)
1. User opens messages.html and selects a conversation
2. User clicks the green video camera icon next to the "Send" button
3. User is redirected to video-call.html with a pre-filled channel name
4. User clicks "Join Call"
5. Browser requests camera/microphone permission
6. User's video appears on screen
7. When the other person clicks the video icon from their messages, they join the same room
8. Users can click "Leave Call" to exit

#### Option 2: Manual Channel Entry
1. User visits video-call.html directly
2. If logged in, their email is shown; if not, they appear as "Guest"
3. User enters a channel name (like "spanish-practice-room-1")
4. User clicks "Join Call"
5. Browser requests camera/microphone permission
6. User's video appears on screen
7. When another user joins the same channel, their video appears too
8. Users can click "Leave Call" to exit

## Testing Instructions

### Test the Messages Integration (Recommended)
1. Start your local server:
   ```bash
   cd ijrobertson.github.io
   npm run serve
   ```

2. **Setup two test accounts:**
   - Window 1 (normal browser): Log in as User A
   - Window 2 (incognito mode): Log in as User B

3. **Send a message between users:**
   - User A sends a message to User B (or vice versa)
   - This creates a conversation

4. **Start video call:**
   - In one window, click the green video camera icon next to the "Send" button
   - This opens video-call.html with a unique channel name
   - Click "Join Call" and allow camera/microphone

5. **Join from other user:**
   - In the other window, click the same video camera icon
   - Both users will join the same channel automatically
   - You should see both video feeds

### Test Manually (Alternative)
1. Start your local server:
   ```bash
   cd ijrobertson.github.io
   npm run serve
   ```

2. Open two browser windows:
   - Window 1: http://localhost:3000/video-call.html
   - Window 2: http://localhost:3000/video-call.html (incognito mode or different browser)

3. In both windows:
   - Enter the same channel name (e.g., "test-room")
   - Click "Join Call"
   - Allow camera/microphone access

4. You should see both video feeds appear in both windows

### Test After Deployment
Once deployed to GitHub Pages:
1. Visit https://linguabud.com/video-call.html
2. Share the channel name with a friend
3. Both enter the same channel name and join

## Important: Production Requirements

### ⚠️ Token Authentication (CRITICAL for Production)
Currently, the app uses `null` for the token parameter, which works only in Agora's testing mode. **For production, you MUST implement a token server.**

#### Why Tokens Are Needed
- Prevent unauthorized access to your Agora project
- Control who can join which channels
- Prevent abuse and unexpected costs
- Required by Agora for apps in production

#### Setting Up Token Server
You'll need to create a serverless function (using Firebase Functions) to generate Agora tokens:

1. **Get your Agora App Certificate**:
   - Go to Agora Console: https://console.agora.io
   - Select your project
   - Click "Config" → Enable "Primary Certificate"
   - Copy the certificate (keep it SECRET)

2. **Create a token generation function**:
   - Add to `functions/index.js` (you already have Firebase Functions setup)
   - Example implementation:

```javascript
const functions = require('firebase-functions');
const { RtcTokenBuilder, RtcRole } = require('agora-access-token');

exports.generateAgoraToken = functions.https.onCall((data, context) => {
  // Optional: Require authentication
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be logged in');
  }

  const appId = 'dfd628e44de640e3b7717f422d1dc3e7';
  const appCertificate = 'YOUR_APP_CERTIFICATE'; // From Agora Console
  const channelName = data.channelName;
  const uid = data.uid || 0;
  const role = RtcRole.PUBLISHER;

  // Token expires in 24 hours
  const expirationTimeInSeconds = 3600 * 24;
  const currentTimestamp = Math.floor(Date.now() / 1000);
  const privilegeExpiredTs = currentTimestamp + expirationTimeInSeconds;

  const token = RtcTokenBuilder.buildTokenWithUid(
    appId,
    appCertificate,
    channelName,
    uid,
    role,
    privilegeExpiredTs
  );

  return { token, uid };
});
```

3. **Install Agora token package in functions**:
```bash
cd functions
npm install agora-access-token
```

4. **Update video-call.html to request token**:
   - Instead of `null`, call your Firebase Function to get a token
   - Example modification needed in the `joinChannel()` function

#### Token Implementation Example (for video-call.html)
Replace this line:
```javascript
const uid = await client.join(APP_ID, channelName, null, currentUser.uid);
```

With:
```javascript
// Get token from your server
const tokenFunction = httpsCallable(functions, 'generateAgoraToken');
const result = await tokenFunction({ channelName, uid: currentUser.uid });
const token = result.data.token;

// Join with the token
const uid = await client.join(APP_ID, channelName, token, currentUser.uid);
```

## Agora Free Tier
- **10,000 free minutes per month** (resets monthly)
- After that: ~$0.99 per 1,000 minutes
- Monitor usage at: https://console.agora.io

## Integration with Existing Pages

### ✅ Already Integrated: Messages Page
The video calling feature is now fully integrated with messages.html!

**What was added:**
- Green video camera icon next to the "Send" button
- Automatic channel name generation based on user pairs
- Direct navigation to video call with pre-filled channel

**How it works:**
```javascript
// When user clicks video button, create unique channel name
const otherUserId = conversationId.split('_').find(id => id !== currentUser.uid);
const channelName = [currentUser.uid, otherUserId].sort().join('-');
window.location.href = `video-call.html?channel=${channelName}`;
```

The video-call.html page automatically reads the channel parameter and pre-fills it, so users just click "Join Call".

### Future Integrations (Optional)

1. **From student-dashboard.html**: Add a "Start Video Call" button
2. **From connect.html**: Add "Video Chat" buttons on user cards (before messaging)
3. **From instructors.html**: Add "Schedule Video Lesson" option

## Future Features Roadmap

### 1. **Recording**
- Use Agora Cloud Recording API
- Store recordings in Firebase Storage
- Cost: ~$3.99 per 1,000 minutes of recording

### 2. **Real-Time Translation**
- Integrate Google Cloud Translation API or Microsoft Translator
- Transcribe audio → Translate → Display as subtitles
- Can use Agora RTM (Real-Time Messaging) to send translated text

### 3. **Whiteboard/Flashcard Feature**
- Use Agora RTM to sync data between users
- Create shared canvas for drawing/writing
- Save flashcards to Firestore for later review
- Show vocabulary in real-time during calls

### 4. **Audio-Only Mode**
- Add toggle to disable video (keep only audio)
- Useful for low bandwidth situations
- Simple modification to existing code

### 5. **Screen Sharing**
- For sharing documents, presentations
- Use `AgoraRTC.createScreenVideoTrack()`

## Troubleshooting

### "Failed to join" error
- Check browser console for specific error
- Ensure camera/microphone permissions are granted
- Try different browser (Chrome/Firefox work best)
- Check if Agora service is down: https://status.agora.io

### No video appearing
- Check camera is not in use by another app
- Verify browser permissions (click lock icon in address bar)
- Try reloading the page

### Remote user not appearing
- Ensure both users entered exact same channel name (case-sensitive)
- Check network/firewall settings
- Verify both users clicked "Join Call"

### Poor video quality
- Check internet connection speed
- Agora automatically adjusts quality based on bandwidth
- Can manually set video profile in code if needed

## Security Best Practices

1. **Always use token authentication in production** (see above)
2. **Validate user permissions** before allowing channel access
3. **Store App Certificate securely** (never commit to GitHub)
4. **Rate limit** token generation to prevent abuse
5. **Log all video sessions** for moderation/safety

## Next Steps

1. **Test the video call page locally** ✓
2. **Deploy to GitHub Pages** when ready
3. **Set up token server** before going live with users
4. **Add links** from other pages (connect.html, dashboard.html)
5. **Monitor usage** in Agora Console
6. **Implement recording/translation** as needed

## Resources

- Agora Web SDK Docs: https://docs.agora.io/en/video-calling/get-started/get-started-sdk
- Agora Console: https://console.agora.io
- Token Generator: https://docs.agora.io/en/video-calling/develop/authentication-workflow
- Sample Code: https://github.com/AgoraIO/API-Examples-Web

## Questions?

If you encounter any issues or want to add the advanced features (recording, translation, whiteboard), let me know and I can help implement them!
