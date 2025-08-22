/**
 * utils/geo.ts
 * 
 * Geocoding and distance calculation utilities
 * Ported from original Node.js utils/geo.js to Deno/TypeScript
 * Uses Deno's built-in fetch instead of node-fetch
 */

// Edge Functions runtime globals
declare const Deno: {
    env: {
        get(key: string): string | undefined;
    };
};

import { GEOCODING_EXCEPTIONS } from './constants.ts';
import { withApiRetry } from './retry.ts';

/**
 * Calculates the distance between two GPS coordinates using the Haversine formula
 * @param lat1 - Latitude of the first point
 * @param lon1 - Longitude of the first point  
 * @param lat2 - Latitude of the second point
 * @param lon2 - Longitude of the second point
 * @returns The distance in meters
 */
export function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371000; // Earth's radius in meters
    const toRad = (x: number) => (x * Math.PI) / 180;
    
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
 * Fetches address details from Nominatim (OpenStreetMap)
 * @param lat - Latitude
 * @param lon - Longitude  
 * @returns Address data or null if failed
 */
export async function fetchAddressFromNominatim(lat: number, lon: number): Promise<any | null> {
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

/**
 * Geocode an address using Google Maps Geocoding API
 * @param address - Address to geocode
 * @returns Geocoding result or null if failed
 */
export async function geocodeAddress(address: string): Promise<any | null> {
    const googleApiKey = Deno.env.get('GOOGLE_API_KEY');
    if (!googleApiKey) {
        console.error('Google API key not found in environment variables');
        return null;
    }
    
    try {
        // Check for geocoding exceptions first
        const normalizedAddress = GEOCODING_EXCEPTIONS[address] || address;
        
        const encodedAddress = encodeURIComponent(normalizedAddress);
        const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodedAddress}&key=${googleApiKey}`;
        
        const response = await withApiRetry(async () => {
            return await fetch(url);
        });
        
        const data = await response.json();
        
        if (data.status === 'OK' && data.results.length > 0) {
            return data.results[0];
        } else {
            console.error(`Geocoding failed for "${address}": ${data.status}`);
            return null;
        }
    } catch (err) {
        console.error("Error geocoding address:", err);
        return null;
    }
}

/**
 * Get coordinates from geocoding result
 * @param geocodingResult - Result from geocoding API
 * @returns Latitude and longitude or null
 */
export function extractCoordinates(geocodingResult: any): { lat: number; lng: number } | null {
    if (!geocodingResult?.geometry?.location) {
        return null;
    }
    
    const location = geocodingResult.geometry.location;
    return {
        lat: location.lat,
        lng: location.lng
    };
}

/**
 * Format address components from geocoding result
 * @param geocodingResult - Result from geocoding API
 * @returns Formatted address components
 */
export function extractAddressComponents(geocodingResult: any): {
    street?: string;
    city?: string;
    state?: string;
    country?: string;
    postal_code?: string;
} {
    const components = geocodingResult?.address_components || [];
    const result: any = {};
    
    for (const component of components) {
        const types = component.types;
        
        if (types.includes('street_number') || types.includes('route')) {
            if (!result.street) result.street = '';
            result.street += component.long_name + ' ';
        } else if (types.includes('locality') || types.includes('administrative_area_level_2')) {
            result.city = component.long_name;
        } else if (types.includes('administrative_area_level_1')) {
            result.state = component.long_name;
        } else if (types.includes('country')) {
            result.country = component.long_name;
        } else if (types.includes('postal_code')) {
            result.postal_code = component.long_name;
        }
    }
    
    if (result.street) {
        result.street = result.street.trim();
    }
    
    return result;
}

/**
 * Check if coordinates are valid
 */
export function areCoordinatesValid(lat: number, lng: number): boolean {
    return (
        typeof lat === 'number' && 
        typeof lng === 'number' &&
        lat >= -90 && lat <= 90 &&
        lng >= -180 && lng <= 180 &&
        !isNaN(lat) && !isNaN(lng)
    );
}

/**
 * Convert coordinates to a geo-hash for approximate location matching
 * Simple implementation for basic geo-proximity
 */
export function coordinatesToGeoHash(lat: number, lng: number, precision: number = 5): string {
    if (!areCoordinatesValid(lat, lng)) {
        throw new Error('Invalid coordinates');
    }
    
    // Simple geohash implementation (can be enhanced with proper geohash library)
    const latNormalized = Math.floor((lat + 90) * Math.pow(10, precision));
    const lngNormalized = Math.floor((lng + 180) * Math.pow(10, precision));
    
    return `${latNormalized}_${lngNormalized}`;
}

/**
 * Batch geocode multiple addresses with rate limiting
 * @param addresses - Array of addresses to geocode
 * @param batchSize - Number of concurrent requests (default: 5)
 * @param delay - Delay between batches in ms (default: 200)
 */
export async function batchGeocode(
    addresses: string[], 
    batchSize: number = 5, 
    delay: number = 200
): Promise<Array<{ address: string; result: any | null }>> {
    const results: Array<{ address: string; result: any | null }> = [];
    
    for (let i = 0; i < addresses.length; i += batchSize) {
        const batch = addresses.slice(i, i + batchSize);
        
        const batchPromises = batch.map(async (address) => ({
            address,
            result: await geocodeAddress(address)
        }));
        
        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);
        
        // Delay between batches to avoid rate limiting
        if (i + batchSize < addresses.length) {
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    
    return results;
}
