// Single source of truth for legal links + contact in the mobile app.
// The canonical policy text lives on the web (classpulse.pages.dev); the app
// links out to it so we only maintain one copy. Keep CONTACT_EMAIL in sync
// with web/src/pages/legal/legalConstants.ts.
export const CONTACT_EMAIL = 'classpulseorgs@gmail.com';

export const WEB_BASE_URL = 'https://classpulse.pages.dev';
export const PRIVACY_URL = `${WEB_BASE_URL}/privacy`;
export const TERMS_URL = `${WEB_BASE_URL}/terms`;
export const DELETE_ACCOUNT_URL = `${WEB_BASE_URL}/delete-account`;
