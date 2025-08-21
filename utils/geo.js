// utils/geo.js
// Utility functions for geocoding and distance

import fetch from 'node-fetch';
import { withApiRetry } from './retry.js';

/**
 * Calculates the distance between two GPS coordinates.
 * @param {number} lat1 - Latitude of the first point.
 * @param {number} lon1 - Longitude of the first point.
 * @param {number} lat2 - Latitude of the second point.
 * @param {number} lon2 - Longitude of the second point.
 * @returns {number} The distance in meters.
 */
function haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000; // Earth's radius in meters
    const toRad = (x) => (x * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

/**
 * Fetches address details from Nominatim (OpenStreetMap).
 * @param {number} lat - Latitude.
 * @param {number} lon - Longitude.
 * @returns {Promise<object|null>}
 */
async function fetchAddressFromNominatim(lat, lon) {
    try {
        const response = await withApiRetry(async () => {
            return await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`);
        });
        const data = await response.json();
        if (data && data.display_name) {
            return data;
        } else {
            console.error("Nominatim reverse geocoding returned no result");
        }
    } catch (err) {
        console.error("Error fetching address from Nominatim:", err);
    }
    return null;
}

export default {
    haversineDistance,
    fetchAddressFromNominatim,
};
