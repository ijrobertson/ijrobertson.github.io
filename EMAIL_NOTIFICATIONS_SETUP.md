# Email Notifications Setup Guide

This guide will walk you through setting up email notifications for Lingua Bud using Resend.

## What Was Implemented

1. **Cloud Functions**: Automatically sends emails when users receive messages
2. **Notification Settings**: Users can toggle email notifications on/off in their dashboard
3. **Email Templates**: Professional HTML emails with Lingua Bud branding
4. **Email Logging**: All sent emails are logged for tracking and debugging

## Quick Start (Step-by-Step)

### Step 1: Create Resend Account

1. Go to [resend.com](https://resend.com)
2. Click "Sign Up" and create an account
3. Verify your email address

### Step 2: Get Your API Key

1. Log in to Resend dashboard
2. Navigate to **API Keys** in the left sidebar
3. Click **Create API Key**
4. Give it a name (e.g., "Lingua Bud Production")
5. Click **Add**
6. **IMPORTANT**: Copy the API key immediately (starts with `re_`)
   - You won't be able to see it again!
   - Save it somewhere secure

### Step 3: Verify Your Domain (Recommended)

To send emails from `notifications@linguabud.com` instead of a generic address:

1. In Resend dashboard, go to **Domains**
2. Click **Add Domain**
3. Enter `linguabud.com`
4. Resend will provide DNS records:
   - SPF record
   - DKIM records
   - DMARC record
5. Add these records to your domain registrar (where you bought linguabud.com)
6. Wait 5-15 minutes for verification (can take up to 48 hours)
7. Refresh the Resend Domains page to check verification status

**Alternative for Testing**: Skip this step and use Resend's default domain (`onboarding@resend.dev`). To do this, change line 85 in `functions/index.js`:
```javascript
from: 'Lingua Bud <onboarding@resend.dev>',
```

### Step 4: Set API Key in Firebase

Open your terminal in the project directory and run:

```bash
firebase functions:config:set resend.api_key="YOUR_API_KEY_HERE"
```

**Replace `YOUR_API_KEY_HERE` with the actual API key from Step 2.**

Verify it was set correctly:

```bash
firebase functions:config:get
```

You should see:
```json
{
  "resend": {
    "api_key": "re_..."
  }
}
```

### Step 5: Deploy Cloud Functions

Deploy the function to Firebase:

```bash
firebase deploy --only functions
```

This will:
- Upload your Cloud Function code to Firebase
- Set up the trigger for new messages
- Take 1-3 minutes to complete

Watch for the success message:
```
✔  Deploy complete!
```

### Step 6: Deploy Updated Frontend

Your frontend files have been updated to include notification settings. Deploy to GitHub Pages:

```bash
git add .
git commit -m "Add email notifications with Resend integration"
git push origin main
```

GitHub Pages will automatically deploy the changes in 1-2 minutes.

### Step 7: Test the Integration

1. **Log in to Lingua Bud** with a test account
2. **Go to Student Dashboard** (student-dashboard.html)
3. **Verify the notification toggle** is visible under "Notification Settings"
4. **Ensure it's toggled ON** (should be blue)
5. **Save your profile**
6. **Send a test message** from another account to yourself
7. **Check your email inbox** for the notification

**Expected Result**: You should receive an email within 30 seconds with:
- Subject: "New message from [Sender Name]"
- Message preview
- "View Message" button
- Unsubscribe link

## Troubleshooting

### Problem: Function deployment fails

**Solution**: Check that you're logged in to Firebase:
```bash
firebase login
firebase use linguabud-9a942
firebase deploy --only functions
```

### Problem: Emails not being sent

**Check 1**: Verify API key is set
```bash
firebase functions:config:get
```

**Check 2**: View function logs for errors
```bash
firebase functions:log
```

**Check 3**: Check recipient's notification preferences
- Go to Firestore Database in Firebase Console
- Open the `users` collection
- Find the recipient's document
- Verify `emailNotifications` field is `true`

**Check 4**: Check Resend dashboard
- Go to resend.com dashboard
- Click "Logs" to see if emails are being sent
- Check for any errors or warnings

### Problem: Domain not verified

**Solution**:
- Check your domain registrar's DNS settings
- Ensure all DNS records from Resend are added correctly
- Wait 15 minutes and refresh
- Use Resend's default domain for testing in the meantime

### Problem: Emails going to spam

**Solution**:
- Ensure domain is fully verified (all DNS records added)
- Send a few test emails to yourself
- Mark them as "Not Spam" in your email client
- SPF/DKIM verification helps prevent spam filtering

## Local Development with Emulators

To test locally before deploying:

### 1. Create local config file

```bash
cd functions
echo '{"resend":{"api_key":"YOUR_RESEND_API_KEY"}}' > .runtimeconfig.json
```

**IMPORTANT**: This file is gitignored and won't be committed.

### 2. Start emulators

From project root:
```bash
npm run emulator
```

### 3. Test in local environment

1. Open http://localhost:3000
2. Log in and send messages
3. Check the emulator console for function logs
4. Real emails will be sent (uses your Resend account)

## Files Modified

The following files were created or modified:

### Created Files:
- `functions/index.js` - Cloud Function code
- `functions/package.json` - Dependencies
- `functions/.gitignore` - Excludes node_modules
- `functions/README.md` - Technical documentation
- `EMAIL_NOTIFICATIONS_SETUP.md` - This setup guide

### Modified Files:
- `firebase.json` - Added functions configuration
- `firestore.rules` - Added emailLog security rules
- `login.html` - Sets emailNotifications=true for new users
- `student-dashboard.html` - Added notification toggle UI

## User Experience

### For Users:
1. **New users**: Email notifications are ON by default
2. **Existing users**: Email notifications default to ON
3. **Toggle setting**: Users can turn off emails in their dashboard
4. **Instant emails**: Notifications sent within 30 seconds of receiving a message
5. **Professional emails**: Branded HTML emails with clear CTAs

### Email Content:
- Sender's name prominently displayed
- Message preview (first 100 characters)
- "View Message" button linking to messages.html
- Unsubscribe instructions
- Lingua Bud branding and colors

## Monitoring and Analytics

### View function logs:
```bash
firebase functions:log
```

### Check email logs in Firestore:
1. Open Firebase Console
2. Go to Firestore Database
3. Open `emailLog` collection
4. View sent emails with status and timestamps

### Monitor Resend usage:
1. Go to Resend dashboard
2. View "Analytics" for email statistics
3. Check rate limit usage
4. View delivery rates

## Cost Estimates

### Firebase Cloud Functions
- **Free Tier**: 2M invocations/month
- **Likely Cost**: $0/month (within free tier)
- Each message = 1 invocation

### Resend
- **Free Tier**: 3,000 emails/month
- **Likely Cost**: $0/month initially
- Upgrade to $20/month if you exceed 3,000 emails

**Total Estimated Monthly Cost**: $0 (while within free tiers)

## Next Steps

After successful setup, consider:

1. **Add more notification types**:
   - New friend requests
   - Booking confirmations
   - Lesson reminders

2. **Enhance email templates**:
   - Add user avatars
   - Include conversation history
   - Add social media links

3. **Add notification preferences**:
   - Daily digest option
   - Immediate vs. batched notifications
   - Notification frequency settings

4. **Analytics**:
   - Track email open rates
   - A/B test email content
   - Monitor unsubscribe rates

## Support

If you encounter any issues:

1. Check function logs: `firebase functions:log`
2. Review Resend dashboard for delivery issues
3. Check Firestore security rules are deployed
4. Verify all DNS records if using custom domain

## References

- Firebase Functions Docs: https://firebase.google.com/docs/functions
- Resend Docs: https://resend.com/docs
- Resend Node.js SDK: https://github.com/resend/resend-node
- Firebase CLI Reference: https://firebase.google.com/docs/cli

---

**Need Help?** Check the troubleshooting section above or review the technical documentation in `functions/README.md`.
