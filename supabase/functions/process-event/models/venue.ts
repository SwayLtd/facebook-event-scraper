/**
 * models/venue.ts
 * 
 * Venue model with geocoding and address management
 * Ported from original Node.js models/venue.js to Deno/TypeScript
 */

// Edge Functions runtime globals  
declare const Deno: {
    env: {
        get(key: string): string | undefined;
    };
};

import { geocodeAddress, extractCoordinates, extractAddressComponents, areCoordinatesValid } from '../utils/geo.ts';
import { normalizeVenueName } from '../utils/name.ts';
import { withDatabaseRetry } from '../utils/retry.ts';

/**
 * Venue interface
 */
export interface Venue {
    id?: number;
    name: string;
    address?: string;
    city?: string;
    state?: string;
    country?: string;
    postal_code?: string;
    latitude?: number;
    longitude?: number;
    formatted_address?: string;
    google_place_id?: string;
    created_at?: string;
    updated_at?: string;
}

/**
 * Venue creation data from Facebook
 */
export interface FacebookVenueData {
    name?: string;
    location?: {
        city?: string;
        country?: string;
        latitude?: number;
        longitude?: number;
        state?: string;
        street?: string;
        zip?: string;
    };
}

/**
 * Create or update venue in database with geocoding
 */
export async function createOrUpdateVenue(
    supabase: any,
    venueData: FacebookVenueData
): Promise<Venue | null> {
    if (!venueData.name) {
        console.warn('Venue name is required');
        return null;
    }

    const venueName = normalizeVenueName(venueData.name);
    
    try {
        // Check if venue already exists
        const existingVenue = await findVenueByName(supabase, venueName);
        if (existingVenue) {
            console.log(`Venue "${venueName}" already exists with ID ${existingVenue.id}`);
            return existingVenue;
        }

        // Create new venue with geocoding
        const newVenue = await createVenueWithGeocoding(supabase, venueData);
        return newVenue;
        
    } catch (error) {
        console.error('Error creating/updating venue:', error);
        return null;
    }
}

/**
 * Find venue by name in database
 */
async function findVenueByName(supabase: any, name: string): Promise<Venue | null> {
    try {
        const { data, error } = await withDatabaseRetry(async () => {
            return await supabase
                .from('venues')
                .select('*')
                .eq('name', name)
                .single();
        });

        if (error && error.code !== 'PGRST116') { // PGRST116 = not found
            throw error;
        }

        return data;
    } catch (error) {
        console.error(`Error finding venue "${name}":`, error);
        return null;
    }
}

/**
 * Create new venue with geocoding enrichment
 */
async function createVenueWithGeocoding(
    supabase: any,
    venueData: FacebookVenueData
): Promise<Venue | null> {
    const venueName = normalizeVenueName(venueData.name!);
    
    // Start with basic venue data
    const venue: Partial<Venue> = {
        name: venueName,
    };

    // Add Facebook location data if available
    if (venueData.location) {
        const loc = venueData.location;
        venue.city = loc.city;
        venue.state = loc.state;
        venue.country = loc.country;
        venue.postal_code = loc.zip;
        
        // Use Facebook coordinates if valid
        if (loc.latitude && loc.longitude && areCoordinatesValid(loc.latitude, loc.longitude)) {
            venue.latitude = loc.latitude;
            venue.longitude = loc.longitude;
        }

        // Build address string for geocoding
        const addressParts = [loc.street, loc.city, loc.state, loc.country].filter(Boolean);
        if (addressParts.length > 0) {
            venue.address = addressParts.join(', ');
        }
    }

    // Attempt geocoding if we don't have coordinates or need more complete address
    if (!venue.latitude || !venue.longitude || !venue.formatted_address) {
        await enrichVenueWithGeocoding(venue);
    }

    // Insert into database
    try {
        const { data, error } = await withDatabaseRetry(async () => {
            return await supabase
                .from('venues')
                .insert([venue])
                .select()
                .single();
        });

        if (error) {
            throw error;
        }

        console.log(`Created venue "${venueName}" with ID ${data.id}`);
        return data;
        
    } catch (error) {
        console.error(`Error inserting venue "${venueName}":`, error);
        return null;
    }
}

/**
 * Enrich venue data with geocoding
 */
async function enrichVenueWithGeocoding(venue: Partial<Venue>): Promise<void> {
    // Build search query for geocoding
    let searchQuery = venue.name || '';
    
    if (venue.address) {
        searchQuery = venue.address;
    } else {
        // Build address from components
        const parts = [venue.name, venue.city, venue.state, venue.country].filter(Boolean);
        searchQuery = parts.join(', ');
    }

    if (!searchQuery) {
        console.warn('No geocoding query could be built for venue');
        return;
    }

    try {
        console.log(`Geocoding venue: "${searchQuery}"`);
        const geocodingResult = await geocodeAddress(searchQuery);
        
        if (geocodingResult) {
            // Extract coordinates
            const coordinates = extractCoordinates(geocodingResult);
            if (coordinates) {
                venue.latitude = coordinates.lat;
                venue.longitude = coordinates.lng;
            }

            // Extract address components
            const addressComponents = extractAddressComponents(geocodingResult);
            
            // Update venue with geocoding results (if not already set)
            if (!venue.address && addressComponents.street) {
                venue.address = addressComponents.street;
            }
            if (!venue.city && addressComponents.city) {
                venue.city = addressComponents.city;
            }
            if (!venue.state && addressComponents.state) {
                venue.state = addressComponents.state;
            }
            if (!venue.country && addressComponents.country) {
                venue.country = addressComponents.country;
            }
            if (!venue.postal_code && addressComponents.postal_code) {
                venue.postal_code = addressComponents.postal_code;
            }

            // Store formatted address and place ID
            venue.formatted_address = geocodingResult.formatted_address;
            venue.google_place_id = geocodingResult.place_id;

            console.log(`Geocoding successful for "${venue.name}": ${coordinates?.lat}, ${coordinates?.lng}`);
        } else {
            console.warn(`Geocoding failed for venue "${venue.name}"`);
        }
    } catch (error) {
        console.error(`Error geocoding venue "${venue.name}":`, error);
    }
}

/**
 * Find venues within a radius of given coordinates
 */
export async function findVenuesNearby(
    supabase: any,
    latitude: number,
    longitude: number,
    radiusKm: number = 10
): Promise<Venue[]> {
    try {
        // Use PostGIS earth_distance function if available, otherwise use simple bounding box
        const { data, error } = await supabase.rpc('find_venues_nearby', {
            lat: latitude,
            lng: longitude,
            radius_km: radiusKm
        });

        if (error) {
            // Fallback to simple query if RPC function doesn't exist
            console.warn('Nearby venues RPC failed, using simple query:', error);
            
            // Simple bounding box calculation (approximate)
            const latDelta = radiusKm / 111; // 1 degree lat ≈ 111 km
            const lngDelta = radiusKm / (111 * Math.cos(latitude * Math.PI / 180));
            
            const { data: fallbackData, error: fallbackError } = await supabase
                .from('venues')
                .select('*')
                .gte('latitude', latitude - latDelta)
                .lte('latitude', latitude + latDelta)
                .gte('longitude', longitude - lngDelta)
                .lte('longitude', longitude + lngDelta)
                .not('latitude', 'is', null)
                .not('longitude', 'is', null);
                
            if (fallbackError) throw fallbackError;
            return fallbackData || [];
        }

        return data || [];
    } catch (error) {
        console.error('Error finding nearby venues:', error);
        return [];
    }
}

/**
 * Update venue geocoding data
 */
export async function updateVenueGeocoding(
    supabase: any,
    venueId: number
): Promise<boolean> {
    try {
        // Get current venue data
        const { data: venue, error: fetchError } = await supabase
            .from('venues')
            .select('*')
            .eq('id', venueId)
            .single();

        if (fetchError || !venue) {
            throw fetchError || new Error('Venue not found');
        }

        // Perform geocoding enrichment
        const venueData = { ...venue };
        await enrichVenueWithGeocoding(venueData);

        // Update database with new geocoding data
        const { error: updateError } = await withDatabaseRetry(async () => {
            return await supabase
                .from('venues')
                .update({
                    latitude: venueData.latitude,
                    longitude: venueData.longitude,
                    address: venueData.address,
                    city: venueData.city,
                    state: venueData.state,
                    country: venueData.country,
                    postal_code: venueData.postal_code,
                    formatted_address: venueData.formatted_address,
                    google_place_id: venueData.google_place_id,
                    updated_at: new Date().toISOString()
                })
                .eq('id', venueId);
        });

        if (updateError) {
            throw updateError;
        }

        console.log(`Updated geocoding for venue ID ${venueId}`);
        return true;
        
    } catch (error) {
        console.error(`Error updating geocoding for venue ID ${venueId}:`, error);
        return false;
    }
}
