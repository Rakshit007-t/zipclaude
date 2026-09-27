# Production authentication checklist

## Fit Profile persistence

The production client sends Fit Profile updates to `PUT /profiles/me` with the
current Firebase ID token. The backend validates the payload and writes it with
the Firebase Admin SDK to the configured named Firestore database. This is the
same database configured in `firebase.ts` and `zipfin-backend/firebase_config.py`.

Deploy the client rules to that named database before release:

```bash
cd zipfend
firebase use zipright-staging
firebase deploy --only firestore:rules
```

The rules in `firestore.rules` permit only an authenticated user to read or
write their own `/users/{uid}` document. The backend uses Admin credentials;
its caller is still authenticated by a verified Firebase ID token.

## Phone / SMS Authentication (Launch Policy: ₹0 Cost — Paused)

SMS/DLT registration is explicitly NOT a launch blocker. No funds are committed to SmartPing, DLT, MSG91, or Twilio for launch.
Appwrite Phone/SMS authentication is kept strictly disabled (`authPhone: False`).
The launch authentication pillars are:
1. **Google OAuth 2.0**: Primary social 1-click login, ₹0 additional cost, active and verified.
2. **Email + Password**: Fully operational, ₹0 additional cost, independent of external SMS routes.

Phone authentication is cleanly marked as unavailable in the frontend (`PHONE_AUTH_ENABLED = false`). When post-launch DLT registration is scheduled, SMS providers can be re-enabled without altering core application schemas.

## Password-reset email

The app supplies Firebase `ActionCodeSettings` on every reset request. It uses
`VITE_PASSWORD_RESET_CONTINUE_URL` when set; otherwise it returns to the
current deployed origin at `/#/login?passwordReset=complete`. The chosen domain
must appear in Firebase Authentication's Authorized domains list.

Firebase controls delivery and the reset action itself; application code cannot
change the sender or reliably prevent spam placement. Before production:

- In Firebase Console → Authentication → Templates, edit the **Password reset**
  subject and body to ZipRIGHT copy, and set the template language as needed.
- Configure a custom sender/domain through the Firebase/Google Cloud option
  available to the project, then publish the required SPF, DKIM, and DMARC DNS
  records. Do not claim a custom sender in the product until it is verified.
- Send seed-account resets to Gmail, Outlook, and a corporate inbox and inspect
  both the rendered template and spam placement.
