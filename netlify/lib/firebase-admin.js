const admin = require("firebase-admin");

let cachedApp = null;

function readFirstEnvValue(...names) {
  for (const name of names) {
    const value = String(process.env[name] || "").trim();
    if (value) return value;
  }
  return "";
}

function parseServiceAccountJson(rawValue) {
  const raw = String(rawValue || "").trim();
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      if (typeof parsed.private_key === "string") {
        parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
      }
      return parsed;
    }
  } catch (error) {}

  return null;
}

function resolveFirebaseOptions() {
  const databaseURL = readFirstEnvValue(
    "BNI_FIREBASE_DATABASE_URL",
    "FIREBASE_DATABASE_URL"
  );
  const projectId = readFirstEnvValue(
    "BNI_FIREBASE_PROJECT_ID",
    "FIREBASE_PROJECT_ID",
    "GCLOUD_PROJECT",
    "GOOGLE_CLOUD_PROJECT"
  );
  const serviceAccount = parseServiceAccountJson(
    readFirstEnvValue(
      "BNI_FIREBASE_SERVICE_ACCOUNT_JSON",
      "FIREBASE_SERVICE_ACCOUNT_JSON"
    )
  );

  return {
    databaseURL,
    projectId,
    serviceAccount,
  };
}

function describeFirebaseConfig() {
  const options = resolveFirebaseOptions();
  return {
    provider: "firebase",
    databaseURLPresent: Boolean(options.databaseURL),
    projectIdPresent: Boolean(options.projectId),
    serviceAccountPresent: Boolean(options.serviceAccount),
    applicationDefault: !options.serviceAccount,
  };
}

function createCredential(options) {
  if (options.serviceAccount) {
    return admin.credential.cert(options.serviceAccount);
  }
  return admin.credential.applicationDefault();
}

function getFirebaseApp() {
  if (cachedApp) return cachedApp;

  const options = resolveFirebaseOptions();
  if (!options.databaseURL) {
    throw new Error("Firebase Database URL manquante. Configure FIREBASE_DATABASE_URL.");
  }

  cachedApp = admin.apps.length
    ? admin.app()
    : admin.initializeApp({
        credential: createCredential(options),
        databaseURL: options.databaseURL,
        ...(options.projectId ? { projectId: options.projectId } : {}),
      });

  return cachedApp;
}

function getFirebaseDatabase() {
  return getFirebaseApp().database();
}

module.exports = {
  getFirebaseApp,
  getFirebaseDatabase,
  describeFirebaseConfig,
  __test: {
    resolveFirebaseOptions,
    describeFirebaseConfig,
    parseServiceAccountJson,
  },
};
