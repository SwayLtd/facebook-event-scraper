/**
 * import_artist.js
 *
 * This script can be used in two ways:
 * 1. To import an individual artist:
 *      node import_artist.js "Taylor Swift"
 * 2. To process a CSV file containing artist names:
 *      node import_artist.js --csv "artists.csv"
 *
 * When processing CSV, the script reads the "name" column from each row,
 * triggers the import process for each artist from SoundCloud into Supabase,
 * and logs results both to the console and to a timestamped log file in the "logs" folder.
 *
 * Note: This script uses the Supabase service_role key to bypass RLS.
 * Use it only in a secure backend environment.
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import csv from 'csv-parser';
import axios from 'axios';
import { createClient } from '@supabase/supabase-js';

// Define __filename and __dirname for ESM
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// --- Configuration ---
const SOUND_CLOUD_CLIENT_ID = process.env.SOUND_CLOUD_CLIENT_ID;
const SOUND_CLOUD_CLIENT_SECRET = process.env.SOUND_CLOUD_CLIENT_SECRET;
const TOKEN_URL = 'https://api.soundcloud.com/oauth2/token';
// Fichier pour stocker temporairement le token
const TOKEN_FILE = path.join(__dirname, 'soundcloud_token.json');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// --- Logging Setup ---
// Create "logs" folder if it doesn't exist
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir);
}
// Generate a timestamped log file name (format: YYYY-MM-DD_HH-mm-ss.log)
function getTimestampedLogFilePath() {
  const now = new Date();
  const pad = (n) => n.toString().padStart(2, '0');
  const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  return path.join(logsDir, `${timestamp}.log`);
}
const logFilePath = getTimestampedLogFilePath();

/**
 * Logs a message to the console and appends it to the log file.
 * @param {string} msg
 */
function logMessage(msg) {
  const timestamp = new Date().toISOString();
  const fullMsg = `[${timestamp}] ${msg}`;
  console.log(fullMsg);
  fs.appendFileSync(logFilePath, fullMsg + "\n");
}

// --- Utility functions ---
/**
 * Returns a promise that resolves after the given delay in milliseconds.
 * @param {number} ms
 */
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Retrieves the stored access token from TOKEN_FILE if it exists and is still valid.
 * @returns {Promise<string|null>}
 */
async function getStoredToken() {
  if (fs.existsSync(TOKEN_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
      if (data.expiration && Date.now() < data.expiration) {
        logMessage("Using stored access token.");
        return data.token;
      } else {
        logMessage("Stored access token is expired.");
      }
    } catch (err) {
      logMessage("Error reading token file: " + err);
    }
  }
  return null;
}

/**
 * Stores the access token along with its expiration time.
 * @param {string} token
 * @param {number} expiresIn - Lifetime in seconds.
 */
async function storeToken(token, expiresIn) {
  const expiration = Date.now() + expiresIn * 1000;
  const data = { token, expiration };
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(data, null, 2), 'utf8');
  logMessage("Access token stored.");
}

// --- SoundCloud functions ---
/**
 * Obtains an OAuth access token from SoundCloud using client credentials.
 * First checks if a valid token is stored in TOKEN_FILE.
 * Logs errors and HTTP headers even in case of rate limiting.
 * @returns {Promise<string|null>}
 */
async function getAccessToken() {
  let token = await getStoredToken();
  if (token) return token;

  try {
    const response = await axios.post(TOKEN_URL, null, {
      params: {
        client_id: SOUND_CLOUD_CLIENT_ID,
        client_secret: SOUND_CLOUD_CLIENT_SECRET,
        grant_type: 'client_credentials'
      }
    });
    token = response.data.access_token;
    // Si l'API fournit "expires_in", on l'utilise, sinon on fixe par défaut 3600 secondes (1h)
    const expiresIn = response.data.expires_in || 3600;
    logMessage("Access token obtained: " + token);
    await storeToken(token, expiresIn);
    return token;
  } catch (error) {
    if (error.response && error.response.data) {
      logMessage("Error obtaining access token: " + JSON.stringify(error.response.data, null, 2));
      logMessage("Response headers: " + JSON.stringify(error.response.headers, null, 2));
      if (error.response.status === 429) {
        logMessage("Rate limit reached. Waiting for 60 seconds before retrying...");
        await delay(60000);
        return getAccessToken();
      }
    } else {
      logMessage("Error obtaining access token: " + error);
    }
    return null;
  }
}

/**
 * Searches for an artist on SoundCloud by name using the provided access token.
 * @param {string} artistName
 * @param {string} accessToken
 * @returns {Promise<Object|null>}
 */
async function searchArtist(artistName, accessToken) {
  try {
    const url = `https://api.soundcloud.com/users?q=${encodeURIComponent(artistName)}&limit=1`;
    const response = await axios.get(url, {
      headers: { "Authorization": `OAuth ${accessToken}` }
    });
    const users = response.data;
    if (!users || users.length === 0) {
      logMessage("No artist found for: " + artistName);
      return null;
    }
    return users[0];
  } catch (error) {
    if (error.response && error.response.data) {
      logMessage("Error searching for artist: " + JSON.stringify(error.response.data, null, 2));
    } else {
      logMessage("Error searching for artist: " + error);
    }
    return null;
  }
}

/**
 * Checks if the "-t500x500" image is available.
 * If available, returns the modified URL; otherwise, returns the original URL.
 * @param {string} avatarUrl
 * @returns {Promise<string>}
 */
async function getBestImageUrl(avatarUrl) {
  if (!avatarUrl) return avatarUrl;
  if (!avatarUrl.includes('-large')) return avatarUrl;

  const t500Url = avatarUrl.replace('-large', '-t500x500');
  try {
    const response = await axios.head(t500Url);
    if (response.status === 200) {
      return t500Url;
    } else {
      return avatarUrl;
    }
  } catch (error) {
    return avatarUrl;
  }
}

/**
 * Extracts the necessary artist information from the SoundCloud artist object.
 * Uses a high-quality image if available and retrieves country and city.
 * @param {Object} artist
 * @returns {Promise<Object>}
 */
async function extractArtistInfo(artist) {
  const bestImageUrl = await getBestImageUrl(artist.avatar_url);
  return {
    name: artist.username,
    image_url: bestImageUrl,
    description: artist.description,
    location_info: {
      country: artist.country || null,
      city: artist.city || null
    },
    external_links: {
      soundcloud: {
        link: artist.permalink_url,
        id: String(artist.id)
      }
    }
  };
}

/**
 * Imports an artist by name into Supabase.
 * If accessToken is provided, it will be used; otherwise, it will be obtained.
 * Checks first by external_links.soundcloud.id then by name.
 * @param {string} artistName
 * @param {string} [accessToken]
 */
async function importArtist(artistName, accessToken = null) {
  logMessage("Processing artist: " + artistName);

  if (!accessToken) {
    accessToken = await getAccessToken();
    if (!accessToken) {
      logMessage("Failed to obtain access token for " + artistName);
      return;
    }
  }

  const artist = await searchArtist(artistName, accessToken);
  if (!artist) {
    logMessage("Artist search failed for " + artistName);
    return;
  }

  const artistData = await extractArtistInfo(artist);
  // logMessage("Extracted data for " + artistName + ": " + JSON.stringify(artistData, null, 2));

  try {
    // Check existence by external_links.soundcloud.id
    const { data: existingByExternal, error: externalError } = await supabase
      .from('artists')
      .select('*')
      .eq('external_links->soundcloud->>id', artistData.external_links.soundcloud.id);
    if (externalError) {
      logMessage("Error checking artist by external link for " + artistName + ": " + JSON.stringify(externalError, null, 2));
      return;
    }
    if (existingByExternal && existingByExternal.length > 0) {
      logMessage("Artist already exists (matched by external link): " + artistName);
      return;
    }
    // Check existence by name
    const { data: existingByName, error: nameError } = await supabase
      .from('artists')
      .select('*')
      .eq('name', artistData.name);
    if (nameError) {
      logMessage("Error checking artist by name for " + artistName + ": " + JSON.stringify(nameError, null, 2));
      return;
    }
    if (existingByName && existingByName.length > 0) {
      logMessage("Artist already exists (matched by name): " + artistName);
      return;
    }
    // Insert new artist and return the inserted row(s)
    const { data: insertedArtist, error: insertError } = await supabase
      .from('artists')
      .insert(artistData)
      .select();
    if (insertError) {
      logMessage("Error inserting artist " + artistName + ": " + JSON.stringify(insertError, null, 2));
    } else {
      logMessage("Artist added successfully: " + JSON.stringify(insertedArtist, null, 2));
    }
  } catch (error) {
    logMessage("Error in Supabase integration for " + artistName + ": " + error);
  }
}

// --- Main execution logic ---
// Command-line arguments processing
const args = process.argv.slice(2);

if (args.length === 0) {
  console.error("Usage:");
  console.error('  node import_artist.js "Artist Name"');
  console.error('  node import_artist.js --csv "path/to/file.csv"');
  process.exit(1);
}

// If the first argument is "--csv", process the CSV file; otherwise, treat it as an artist name.
if (args[0] === "--csv") {
  const csvFilePath = args[1];
  if (!csvFilePath) {
    console.error("Please provide the path to the CSV file.");
    process.exit(1);
  }

  console.log(`Processing CSV file: ${csvFilePath}`);

  const rows = [];
  fs.createReadStream(csvFilePath)
    .pipe(csv())
    .on('data', (data) => rows.push(data))
    .on('end', async () => {
      console.log(`Found ${rows.length} rows in CSV file.`);
      // Obtain access token once for all imports
      const accessToken = await getAccessToken();
      if (!accessToken) {
        logMessage("Failed to obtain access token. Aborting.");
        process.exit(1);
      }
      // Process each row sequentially with a delay between calls
      for (const row of rows) {
        const artistName = row.name;
        if (artistName && artistName.trim() !== "") {
          logMessage(`Importing artist: ${artistName}`);
          await importArtist(artistName, accessToken);
          await delay(500);
        } else {
          logMessage("Skipping row with no artist name.");
        }
      }
      logMessage("All artists processed.");
    })
    .on('error', (err) => {
      logMessage("Error reading CSV file: " + err);
      process.exit(1);
    });
} else {
  // Otherwise, treat the first argument as an artist name for individual import
  const artistName = args[0];
  importArtist(artistName);
}
