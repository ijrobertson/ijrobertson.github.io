# Lingua Bud Email Notifications - Cloud Functions

This directory contains Firebase Cloud Functions that send email notifications via Resend when users receive messages.

## How It Works

1. **Trigger**: When a new message is added to Firestore (`conversations/{conversationId}/messages/{messageId}`)
2. **Processing**: The function identifies the recipient and checks their notification preferences
3. **Email Send**: If notifications are enabled, an email is sent via Resend API
4. **Logging**: All email sends (successful or failed) are logged to the `emailLog` collection

## Files

- `index.js` - Main Cloud Function code
- `package.json` - Dependencies and scripts
- `.gitignore` - Excludes node_modules from git

## Setup Instructions

### 1. Get Your Resend API Key

1. Sign up at [resend.com](https://resend.com)
2. Navigate to API Keys in the dashboard
3. Create a new API key
4. Copy the key (starts with `re_`)

### 2. Verify Your Domain (Recommended)

To send emails from `notifications@linguabud.com`:

1. Go to Domains in Resend dashboard
2. Add `linguabud.com`
3. Add the provided DNS records to your domain registrar
4. Wait for verification (usually 5-15 minutes)

**Note**: You can skip this initially and use Resend's default domain (`onboarding@resend.dev`) for testing.

### 3. Set the API Key as Environment Variable

In your project root directory:

```bash
firebase functions:config:set resend.api_key="YOUR_RESEND_API_KEY_HERE"
```

**Important**: Replace `YOUR_RESEND_API_KEY_HERE` with your actual API key from Resend.

To verify it was set correctly:

```bash
firebase functions:config:get
```

### 4. Deploy the Functions

```bash
firebase deploy --only functions
```

This will deploy the `sendMessageNotification` function to Firebase Cloud Functions.

## Testing

### Local Testing with Emulators

1. Set up local config for emulators:
   ```bash
   cd functions
   echo '{"resend":{"api_key":"YOUR_RESEND_API_KEY"}}' > .runtimeconfig.json
   ```

2. Start Firebase emulators (from project root):
   ```bash
   npm run emulator
   ```

3. The function will trigger automatically when you send messages through the app at http://localhost:3000

4. Check the emulator logs to see function execution

### Production Testing

1. Deploy the function (see step 4 above)
2. Send a test message between two users on your live site
3. Check the recipient's email inbox
4. Verify the email was received and looks correct

## Email Template

The email includes:
- Sender's name
- Message preview (truncated to 100 characters)
- "View Message" button linking to messages.html
- Unsubscribe instructions linking to dashboard settings

## Monitoring

### View Function Logs

```bash
firebase functions:log
```

Or in the Firebase Console:
1. Go to Functions section
2. Click on `sendMessageNotification`
3. View the Logs tab

### Check Email Log Collection

All sent emails are logged in Firestore:
- Collection: `emailLog`
- Fields: recipientId, recipientEmail, senderId, conversationId, messageId, emailId, sentAt, status

You can query this in the Firebase Console under Firestore Database.

## Troubleshooting

### Function not triggering

- Check that the function deployed successfully: `firebase functions:list`
- Verify the function name matches: `sendMessageNotification`
- Check function logs for errors: `firebase functions:log`

### Emails not sending

- Verify API key is set: `firebase functions:config:get`
- Check that recipient has `emailNotifications: true` in their user document
- Check that recipient has an `email` field in their user document
- View function logs for error messages
- Check Resend dashboard for failed sends

### Domain verification issues

- DNS changes can take up to 48 hours (usually 5-15 minutes)
- Verify you added all required DNS records (SPF, DKIM, DMARC)
- Use Resend's default domain for testing while waiting

### Rate limiting

- Resend has rate limits based on your plan
- Check your Resend dashboard for usage
- Upgrade plan if needed for higher volume

## Cost Considerations

### Firebase Cloud Functions
- **Free Tier**: 2M invocations/month, 400K GB-seconds, 200K CPU-seconds
- **Paid Plan**: $0.40 per million invocations after free tier
- Estimated cost for Lingua Bud: Minimal (likely stays within free tier)

### Resend
- **Free Tier**: 3,000 emails/month, 100 emails/day
- **Paid Plan**: Starting at $20/month for 50,000 emails
- Estimated cost for Lingua Bud: Free tier should be sufficient initially

## Security

- API keys are stored as environment variables (not in code)
- Cloud Functions run with Admin SDK (bypasses Firestore security rules)
- Email log collection is write-protected from clients (only functions can write)
- User emails are treated as PII and not exposed to other users

## Maintenance

### Update dependencies

```bash
cd functions
npm update
```

### Redeploy after changes

```bash
firebase deploy --only functions
```

### Update API key

```bash
firebase functions:config:set resend.api_key="NEW_API_KEY"
firebase deploy --only functions
```

## Support

- Firebase Functions docs: https://firebase.google.com/docs/functions
- Resend docs: https://resend.com/docs
- Resend Node.js SDK: https://github.com/resend/resend-node
