# Firebase backend

The application uses Firebase Authentication and Cloud Firestore. Setup instructions and Firebase CLI deployment steps are in [README.md](README.md); Firestore access is controlled by `firestore.rules`.

Health export files are parsed in the browser and are not kept in Firebase Storage. Creating a new Firebase Storage bucket requires the Blaze billing plan.

There is no automatic copy of existing Base44 accounts or records. Existing users need to create Firebase accounts, and health data should be re-imported from source exports.