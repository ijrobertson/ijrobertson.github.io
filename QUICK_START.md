# Email Notifications - Quick Start

## Essential Commands (Copy & Paste)

### 1. Set Your Resend API Key
```bash
firebase functions:config:set resend.api_key="YOUR_RESEND_API_KEY"
```
👉 Replace `YOUR_RESEND_API_KEY` with your actual key from resend.com

### 2. Verify API Key Was Set
```bash
firebase functions:config:get
```
✅ Should show your API key

### 3. Deploy Cloud Functions
```bash
firebase deploy --only functions
```
⏱️ Takes 1-3 minutes

### 4. View Function Logs (for debugging)
```bash
firebase functions:log
```

### 5. Deploy Frontend Changes
```bash
git add .
git commit -m "Add email notifications"
git push origin main
```

## Testing Checklist

- [ ] Get Resend API key from resend.com
- [ ] Set API key with command #1 above
- [ ] Verify with command #2 above
- [ ] Deploy functions with command #3 above
- [ ] Deploy frontend with command #5 above
- [ ] Send test message between two accounts
- [ ] Check email inbox for notification
- [ ] Test notification toggle in dashboard

## Where Things Are

- **Cloud Function Code**: `functions/index.js`
- **Function Dependencies**: `functions/package.json`
- **Notification UI**: `student-dashboard.html` (lines 472-483)
- **Full Setup Guide**: `EMAIL_NOTIFICATIONS_SETUP.md`
- **Technical Docs**: `functions/README.md`

## Quick Troubleshooting

**Emails not sending?**
1. Check logs: `firebase functions:log`
2. Check Resend dashboard at resend.com
3. Verify user has `emailNotifications: true` in Firestore

**Function not deploying?**
1. Login: `firebase login`
2. Select project: `firebase use linguabud-9a942`
3. Try again: `firebase deploy --only functions`

**Need more help?** Read `EMAIL_NOTIFICATIONS_SETUP.md`
