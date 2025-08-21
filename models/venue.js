import fetch from 'node-fetch';
import { withApiRetry } from '../utils/retry.js';

/**
 * Retrieves the URL of a Google Places photo for a given address.
 * @param {string} name - The name of the venue.
 * @param {string} address - The address of the venue.
 * @returns {Promise<string>}
 */
async function fetchGoogleVenuePhoto(name, address) {
    // Google Maps geocoding
    const geoRes = await withApiRetry(async () => {
        return await fetch(
            `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${process.env.GOOGLE_API_KEY}`
        );
    });
    const geoJson = await geoRes.json();
    if (!geoJson.results?.length) throw new Error('No geocoding results');
    // lat, lng are not used elsewhere

    // findPlaceFromText to get place_id
    const findRes = await withApiRetry(async () => {
        return await fetch(
            `https://maps.googleapis.com/maps/api/place/findplacefromtext/json` +
            `?input=${encodeURIComponent(name + ' ' + address)}` +
            `&inputtype=textquery&fields=place_id&key=${process.env.GOOGLE_API_KEY}`
        );
    });
    const findJson = await findRes.json();
    if (!findJson.candidates?.length) throw new Error('No place_id found');
    const placeId = findJson.candidates[0].place_id;

    // details to get photo_reference
    const detailRes = await withApiRetry(async () => {
        return await fetch(
            `https://maps.googleapis.com/maps/api/place/details/json` +
            `?place_id=${placeId}&fields=photos&key=${process.env.GOOGLE_API_KEY}`
        );
    });
    const detailJson = await detailRes.json();
    const photoRef = detailJson.result.photos?.[0]?.photo_reference;
    if (!photoRef) throw new Error('No photo available');

    return `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photoreference=${photoRef}&key=${process.env.GOOGLE_API_KEY}`;
}

/**
 * Fetches address details from Google Geocoding API.
 * @param {string} venueName - The name of the venue.
 * @param {string} googleApiKey - The Google API key.
 * @param {object} geocodingExceptions - A map of name corrections.
 * @returns {Promise<object|null>}
 */
async function fetchAddressFromGoogle(venueName, googleApiKey, geocodingExceptions) {
    try {
        // Correct name via geocodingExceptions if present
        const correctedName = geocodingExceptions[venueName] || venueName;
        const response = await withApiRetry(async () => {
            return await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(correctedName)}&key=${googleApiKey}`);
        });
        const data = await response.json();
        if (data.status === "OK" && data.results && data.results.length > 0) {
            return data.results[0];
        } else {
            console.error("Google Geocoding API error or no results:", data.status);
        }
    } catch (err) {
        console.error("Error fetching address from Google:", err);
    }
    return null;
}

export default {
    fetchGoogleVenuePhoto,
    fetchAddressFromGoogle,
};
