// utils/token.js

// Utility functions for managing SoundCloud tokens
const fs = require('fs');
const TOKEN_FILE = 'soundcloud_token.json';

/**
 * Retrieves the stored access token from TOKEN_FILE if it exists and is still valid.
 */
async function getStoredToken() {
    if (fs.existsSync(TOKEN_FILE)) {
        const data = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
        if (data.token && data.expiration > Date.now()) {
            return data.token;
        }
    }
    return null;
}

async function storeToken(token, expiresIn) {
    const expiration = Date.now() + expiresIn * 1000;
    const data = { token, expiration };
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(data, null, 2), 'utf8');
    console.log("[SoundCloud] Access token stored.");
}

export default { getStoredToken, storeToken };
