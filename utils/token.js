// utils/token.js
// Utility functions for managing SoundCloud tokens

import { existsSync, readFileSync, writeFileSync } from 'fs';
import fetch from 'node-fetch';
const TOKEN_FILE = 'soundcloud_token.json';

/**
 * Retrieves the stored access token from TOKEN_FILE if it exists and is still valid.
 */
async function getStoredToken() {
    if (existsSync(TOKEN_FILE)) {
        const data = JSON.parse(readFileSync(TOKEN_FILE, 'utf8'));
        if (data.token && data.expiration > Date.now()) {
            return data.token;
        }
    }
    return null;
}

/**
 * Stores the access token and its expiration time in TOKEN_FILE.
 * @param {string} token - The access token.
 * @param {number} expiresIn - The token's validity duration in seconds.
 */
async function storeToken(token, expiresIn) {
    const expiration = Date.now() + expiresIn * 1000;
    const data = { token, expiration };
    writeFileSync(TOKEN_FILE, JSON.stringify(data, null, 2), 'utf8');
    console.log("[SoundCloud] Access token stored.");
}

/**
 * Gets a valid SoundCloud access token, either from storage or by fetching a new one.
 * @param {string} clientId - SoundCloud client ID.
 * @param {string} clientSecret - SoundCloud client secret.
 * @returns {Promise<string|null>} The access token.
 */
async function getAccessToken(clientId, clientSecret) {
    let token = await getStoredToken();
    if (token) return token;
    try {
        const TOKEN_URL = 'https://api.soundcloud.com/oauth2/token';
        const response = await fetch(`${TOKEN_URL}?client_id=${clientId}&client_secret=${clientSecret}&grant_type=client_credentials`, {
            method: 'POST'
        });
        const data = await response.json();
        token = data.access_token;
        const expiresIn = data.expires_in || 3600;
        console.log("[SoundCloud] Access token obtained:", token);
        await storeToken(token, expiresIn);
        return token;
    } catch (error) {
        console.error("[SoundCloud] Error obtaining access token:", error);
        return null;
    }
}

export default {
    getStoredToken,
    storeToken,
    getAccessToken,
};
