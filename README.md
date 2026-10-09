# Aether Health

A health dashboard using Firebase Authentication and Cloud Firestore.

## Firebase setup

1. Create a Firebase project and register a Web app in the Firebase console.
2. Enable Email/Password and Google providers under Authentication.
3. Create a Cloud Firestore Standard database.
4. Copy `.env.example` to `.env.local` and fill in the Web app config values. These values are public client configuration, not service-account credentials.
5. Install Firebase CLI, sign in, select your project, then deploy the included rules:

```sh
npm install
npm install --global firebase-tools
firebase login
firebase use --add
firebase deploy --only firestore:rules
```

6. Start the site with `npm run dev`.

User profiles and health records are stored in `users/{uid}` and its subcollections. Imports are parsed locally in your browser; only the parsed health records are saved to Firestore. Original files are not retained in the cloud. Firebase Cloud Storage requires the Blaze billing plan for new buckets, so this app intentionally does not use it on Spark.

## Import formats

Gadgetbridge supports ZIP exports and individual CSV tables. Huawei supports metric CSV files, ZIPs containing those CSVs, JSON containing `days` and optional `workouts` arrays, and official Health detail JSON records for dynamic and resting heart rate. Import files are read in the browser and are not retained after import. Spreadsheet exports requiring third-party AI extraction are not supported by the local importer.

This migration does not copy existing Base44 accounts or stored data. New users must register with Firebase; existing health exports can be imported through the app.
