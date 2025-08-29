// utils/geo.ts
// Utility functions for geocoding and distance calculation (Edge Functions version)

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withRetry } from './retry.ts';
import { logger } from './logger.ts';

/**
 * Calculates the distance between two GPS coordinates using Haversine formula
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
 * @returns Promise with reverse geocoding result or null
 */
export async function fetchAddressFromNominatim(lat: number, lon: number): Promise<any | null> {
  try {
    logger.debug(`Fetching address from Nominatim for coordinates: ${lat}, ${lon}`);

    const response = await withRetry(async () => {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      return response;
    });

    const data = await response.json();
    
    if (data && data.display_name) {
      logger.info(`Found address from Nominatim: ${data.display_name}`);
      return data;
    } else {
      logger.warn("Nominatim reverse geocoding returned no result");
      return null;
    }

  } catch (error) {
    logger.error("Error fetching address from Nominatim", error, { lat, lon });
    return null;
  }
}

/**
 * Normalizes an address string for better matching
 * @param address - The address to normalize
 * @returns Normalized address
 */
export function normalizeAddress(address: string): string {
  if (!address) return '';
  
  return address
    .toLowerCase()
    .replace(/\s+/g, ' ') // Multiple spaces to single space
    .replace(/[-–—]/g, ' ') // Remove dashes
    .replace(/\s*,\s*/g, ', ') // Normalize comma spacing
    .replace(/\bstraat\b/g, 'street') // Dutch to English
    .replace(/\brue\b/g, 'street') // French to English  
    .replace(/\bstrasse\b/g, 'street') // German to English
    .replace(/\bbruxelles\b/g, 'brussels') // Normalize city names
    .replace(/\bbrussel\b/g, 'brussels')
    .trim();
}

/**
 * Checks if two addresses are similar by normalizing and comparing
 * @param addr1 - First address
 * @param addr2 - Second address
 * @returns True if addresses seem to be the same location
 */
export function areAddressesSimilar(addr1: string, addr2: string): boolean {
  if (!addr1 || !addr2) return false;
  
  const norm1 = normalizeAddress(addr1);
  const norm2 = normalizeAddress(addr2);
  
  // Extract street numbers and names
  const extractStreetInfo = (addr: string) => {
    const normalized = addr.toLowerCase().trim();
    const numberMatch = normalized.match(/\b(\d{1,5})\b/); // Street number
    const streetMatch = normalized.match(/\b([a-z]+\s+[a-z]*street|[a-z]+street|rue\s+[a-z]+|[a-z]+\s*rue)\b/); // Street name patterns
    
    return {
      number: numberMatch ? numberMatch[1] : null,
      street: streetMatch ? streetMatch[0] : null,
      city: normalized.includes('brussels') || normalized.includes('bruxelles') ? 'brussels' : null,
      postal: normalized.match(/\b(1000|1\d{3})\b/) ? 'brussels_area' : null
    };
  };
  
  const info1 = extractStreetInfo(norm1);
  const info2 = extractStreetInfo(norm2);
  
  // Check if they share the same street number and are in the same city area
  if (info1.number && info2.number && info1.number === info2.number) {
    // Same number, check if same city area
    if ((info1.city === 'brussels' || info1.postal === 'brussels_area') && 
        (info2.city === 'brussels' || info2.postal === 'brussels_area')) {
      
      // Additional check: both contain similar street terms
      if ((norm1.includes('blaes') && norm2.includes('blaes')) ||
          (norm1.includes('rue') && norm2.includes('rue')) ||
          (norm1.includes('street') && norm2.includes('street'))) {
        logger.debug(`Address similarity match: "${addr1}" ~ "${addr2}"`);
        logger.debug(`  Extracted info1: ${JSON.stringify(info1)}`);
        logger.debug(`  Extracted info2: ${JSON.stringify(info2)}`);
        return true;
      }
    }
  }
  
  return false;
}

export default {
  haversineDistance,
  fetchAddressFromNominatim,
  normalizeAddress,
  areAddressesSimilar
};
