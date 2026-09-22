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

## Phone authentication

Production bundles always use Firebase Phone Authentication. The `123456` demo
OTP exists only in Vite development mode. To test actual SMS from a development
build, set `VITE_ENABLE_PHONE_AUTH=true`.

In Firebase Console, verify all of the following:

- Authentication → Sign-in method: Phone is enabled.
- Authentication → Settings → SMS region policy includes every served country.
- The project has the billing/Identity Platform configuration required for SMS.
- Authentication → Settings → Authorized domains includes the deployed
  ZipRIGHT domain and any staging domain.
- The deployed origin is served over HTTPS. Firebase's invisible reCAPTCHA is
  created for every SMS request and discarded after failures, expiry, resend,
  and page unmount.

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
