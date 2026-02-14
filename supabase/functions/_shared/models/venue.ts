// Venue model pour Edge Functions
// Adaptation complète du modèle venue JavaScript local

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { db } from '../utils/database.ts';
import { logger } from '../utils/logger.ts';
import { withRetry } from '../utils/retry.ts';
import { FUZZY_THRESHOLD } from '../utils/constants.ts';
import { getNormalizedName } from '../utils/name.ts';
import { areAddressesSimilar, fetchAddressFromNominatim } from '../utils/geo.ts';
import { downloadAndUploadToR2 } from '../utils/r2.ts';
import { Venue, GooglePlace } from '../types/index.ts';

/**
 * Simple Dice Coefficient implementation for string similarity
 * Same algorithm as the string-similarity library
 */
function compareTwoStrings(first: string, second: string): number {
  first = first.replace(/\s+/g, '');
  second = second.replace(/\s+/g, '');

  if (first === second) return 1; // identical strings
  if (first.length < 2 || second.length < 2) return 0; // if either is a single character, bail

  const firstBigrams = new Map();
  for (let i = 0; i < first.length - 1; i++) {
    const bigram = first.substr(i, 2);
    const count = firstBigrams.has(bigram) ? firstBigrams.get(bigram)! + 1 : 1;
    firstBigrams.set(bigram, count);
  }

  let intersectionSize = 0;
  for (let i = 0; i < second.length - 1; i++) {
    const bigram = second.substr(i, 2);
    const count = firstBigrams.has(bigram) ? firstBigrams.get(bigram)! : 0;

    if (count > 0) {
      firstBigrams.set(bigram, count - 1);
      intersectionSize++;
    }
  }

  return (2.0 * intersectionSize) / (first.length + second.length - 2);
}

/**
 * Retrieves the URL of a Google Places photo for a given address
 * @param name - The name of the venue
 * @param address - The address of the venue
 * @returns Promise with Google Places photo URL
 */
export async function fetchGoogleVenuePhoto(name: string, address: string): Promise<string> {
  const googleApiKey = Deno.env.get('GOOGLE_API_KEY');
  if (!googleApiKey) {
    throw new Error('GOOGLE_API_KEY environment variable is required');
  }

  try {
    logger.debug(`Fetching Google venue photo for: ${name}, ${address}`);

    // Google Maps geocoding
    const geoResponse = await withRetry(async () => {
      const response = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${googleApiKey}`
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      return response;
    });

    const geoData = await geoResponse.json();
    if (!geoData.results?.length) {
      throw new Error('No geocoding results found');
    }

    // findPlaceFromText to get place_id
    const findResponse = await withRetry(async () => {
      const response = await fetch(
        `https://maps.googleapis.com/maps/api/place/findplacefromtext/json` +
        `?input=${encodeURIComponent(name + ' ' + address)}` +
        `&inputtype=textquery&fields=place_id&key=${googleApiKey}`
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      return response;
    });

    const findData = await findResponse.json();
    if (!findData.candidates?.length) {
      throw new Error('No place_id found');
    }
    
    const placeId = findData.candidates[0].place_id;

    // details to get photo_reference
    const detailResponse = await withRetry(async () => {
      const response = await fetch(
        `https://maps.googleapis.com/maps/api/place/details/json` +
        `?place_id=${placeId}&fields=photos&key=${googleApiKey}`
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      return response;
    });

    const detailData = await detailResponse.json();
    const photoRef = detailData.result.photos?.[0]?.photo_reference;
    if (!photoRef) {
      throw new Error('No photo reference available');
    }

    const photoUrl = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photoreference=${photoRef}&key=${googleApiKey}`;
    
    logger.info(`Found Google venue photo for "${name}"`);
    return photoUrl;

  } catch (error) {
    logger.error('Error fetching Google venue photo', error, { name, address });
    throw error;
  }
}

/**
 * Fetches address details from Google Geocoding API
 * @param venueName - The name of the venue
 * @param geocodingExceptions - A map of name corrections
 * @returns Promise with Google geocoding result or null
 */
export async function fetchAddressFromGoogle(
  venueName: string, 
  geocodingExceptions: Record<string, string> = {}
): Promise<any | null> {
  const googleApiKey = Deno.env.get('GOOGLE_API_KEY');
  if (!googleApiKey) {
    throw new Error('GOOGLE_API_KEY environment variable is required');
  }

  try {
    logger.debug(`Fetching address from Google for venue: ${venueName}`);

    // Correct name via geocodingExceptions if present
    const correctedName = geocodingExceptions[venueName] || venueName;

    const response = await withRetry(async () => {
      const response = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(correctedName)}&key=${googleApiKey}`
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      return response;
    });

    const data = await response.json();
    
    if (data.status === "OK" && data.results && data.results.length > 0) {
      logger.info(`Found address details for venue "${venueName}"`);
      return data.results[0];
    } else {
      logger.warn(`Google Geocoding API error or no results for "${venueName}"`, { status: data.status });
      return null;
    }

  } catch (error) {
    logger.error('Error fetching address from Google', error, { venueName });
    return null;
  }
}

/**
 * Creates or updates a venue with Google Places enrichment
 * @param venueData - Basic venue data
 * @param geocodingExceptions - Name corrections map
 * @param dryRun - Whether to perform actual database operations
 * @returns Promise with venue object
 */
export async function createOrUpdateVenue(
  venueData: {
    name: string;
    address?: string;
    city?: string;
    country?: string;
  },
  geocodingExceptions: Record<string, string> = {},
  dryRun = false
): Promise<Venue> {
  try {
    logger.info(`Processing venue: ${venueData.name}`);

    if (dryRun) {
      logger.info(`[DRY_RUN] Would have created/updated venue: ${venueData.name}`);
      return { 
        ...venueData, 
        id: 999999 
      } as Venue;
    }

    const normalizedVenueName = getNormalizedName(venueData.name);
    
    // Step 1: Try to match by address using ORIGINAL address first (like local system)
    if (venueData.address) {
      // Clean the address of potential whitespace/control characters
      const cleanAddress = venueData.address.trim().replace(/[\r\n\t]/g, ' ').replace(/\s+/g, ' ');
      
      logger.info(`Step 1 - Trying address match with: "${cleanAddress}"`);
      
      // Try exact match first with location field
      const { data: venuesByAddress, error: addrError } = await db.client
        .from('venues')
        .select('id, location, name, geo')
        .eq('location', cleanAddress)
        .order('id', { ascending: true }); // Take the oldest venue (smallest ID)

      if (addrError) {
        logger.error(`Location query error:`, addrError);
        throw addrError;
      }

      logger.info(`Location query returned ${venuesByAddress?.length || 0} venues`);
      
      if (venuesByAddress && venuesByAddress.length > 0) {
        logger.info(`Found existing venue by exact location match: "${cleanAddress}" (ID: ${venuesByAddress[0].id})`);
        return venuesByAddress[0] as Venue;
      }
      
      // ALSO try exact match with formatted_address from geo field
      const { data: venuesByFormattedAddr, error: formattedAddrError } = await db.client
        .from('venues')
        .select('id, location, name, geo')
        .eq('geo->>formatted_address', cleanAddress)
        .order('id', { ascending: true }); // Take the oldest venue (smallest ID)

      if (formattedAddrError) {
        logger.error(`Formatted address query error:`, formattedAddrError);
        throw formattedAddrError;
      }

      logger.info(`Formatted address query returned ${venuesByFormattedAddr?.length || 0} venues`);
      if (venuesByFormattedAddr && venuesByFormattedAddr.length > 0) {
        logger.info(`First venue found:`, { 
          id: venuesByFormattedAddr[0].id, 
          name: venuesByFormattedAddr[0].name,
          location: venuesByFormattedAddr[0].location 
        });
      }

      if (venuesByFormattedAddr && venuesByFormattedAddr.length > 0) {
        logger.info(`Found existing venue by exact formatted_address match: "${cleanAddress}" (ID: ${venuesByFormattedAddr[0].id})`);
        return venuesByFormattedAddr[0] as Venue;
      }
      
      // If exact match fails, try with LIKE to handle potential invisible character issues
      const { data: venuesByAddressLike, error: addrLikeError } = await db.client
        .from('venues')
        .select('id, location, name, geo')
        .ilike('location', cleanAddress);

      if (addrLikeError) throw addrLikeError;

      if (venuesByAddressLike && venuesByAddressLike.length > 0) {
        logger.info(`Found existing venue by LIKE address: "${cleanAddress}" (ID: ${venuesByAddressLike[0].id})`);
        logger.warn(`Note: Exact match failed but LIKE succeeded - possible invisible characters in database`);
        return venuesByAddressLike[0] as Venue;
      }
    }

    // Step 1.5: If no explicit address provided, try using the venue name as an address
    // This handles Facebook events that provide address as venue name
    if (!venueData.address && venueData.name) {
      
      // Check if the venue name looks like an address (contains street number or common address patterns)
      const nameAsAddress = venueData.name.trim().replace(/[\r\n\t]/g, ' ').replace(/\s+/g, ' ');
      const looksLikeAddress = /\d+.*[A-Za-z].*\d{4}/.test(nameAsAddress) || // Number + text + 4 digits (postal)
                               /\d+\s+[A-Za-z]/.test(nameAsAddress) || // Number + space + letters
                               /rue|street|avenue|boulevard|straat|laan/i.test(nameAsAddress); // Address keywords
      
      if (looksLikeAddress) {
        logger.info(`Step 1.5 - Trying name as address: "${nameAsAddress}"`);
        
        // Try exact match with formatted_address from geo field
        const { data: venuesByNameAsAddr, error: nameAsAddrError } = await db.client
          .from('venues')
          .select('id, location, name, geo')
          .eq('geo->>formatted_address', nameAsAddress)
          .order('id', { ascending: true }); // Take the oldest venue (smallest ID)

        if (nameAsAddrError) {
          logger.error(`Name-as-address query error:`, nameAsAddrError);
        } else {
          logger.info(`Name-as-address query returned ${venuesByNameAsAddr?.length || 0} venues`);
          
          if (venuesByNameAsAddr && venuesByNameAsAddr.length > 0) {
            logger.info(`Found existing venue using name as address: "${nameAsAddress}" (ID: ${venuesByNameAsAddr[0].id})`);
            return venuesByNameAsAddr[0] as Venue;
          }
        }
        
        // Also try with location field
        const { data: venuesByNameAsLocation, error: nameAsLocationError } = await db.client
          .from('venues')
          .select('id, location, name, geo')
          .eq('location', nameAsAddress)
          .order('id', { ascending: true }); // Take the oldest venue (smallest ID)

        if (nameAsLocationError) {
          logger.error(`Name-as-location query error:`, nameAsLocationError);
        } else {
          logger.info(`Name-as-location query returned ${venuesByNameAsLocation?.length || 0} venues`);
          
          if (venuesByNameAsLocation && venuesByNameAsLocation.length > 0) {
            logger.info(`Found existing venue using name as location: "${nameAsAddress}" (ID: ${venuesByNameAsLocation[0].id})`);
            return venuesByNameAsLocation[0] as Venue;
          }
        }
        
        // If exact matches fail, try fuzzy matching with key address components
        // Extract street number and postal code for fuzzy matching
        const streetNumberMatch = nameAsAddress.match(/(\d+)/);
        const postalCodeMatch = nameAsAddress.match(/(\d{4})/);
        
        if (streetNumberMatch && postalCodeMatch) {
          const streetNumber = streetNumberMatch[1];
          const postalCode = postalCodeMatch[1];
          
          logger.info(`Trying fuzzy address match with number ${streetNumber} and postal ${postalCode}`);
          
          const { data: fuzzyVenues, error: fuzzyError } = await db.client
            .from('venues')
            .select('id, location, name, geo')
            .or(`and(geo->>formatted_address.like.%${streetNumber}%,geo->>formatted_address.like.%${postalCode}%),and(location.like.%${streetNumber}%,location.like.%${postalCode}%)`)
            .order('id', { ascending: true }); // Take the oldest venue (smallest ID)

          if (fuzzyError) {
            logger.error(`Fuzzy address query error:`, fuzzyError);
          } else {
            logger.info(`Fuzzy address query returned ${fuzzyVenues?.length || 0} venues`);
            if (fuzzyVenues && fuzzyVenues.length > 0) {
              logger.info(`Found existing venue using fuzzy address match: "${nameAsAddress}" -> "${fuzzyVenues[0].name}" (ID: ${fuzzyVenues[0].id})`);
              return fuzzyVenues[0] as Venue;
            }
          }
        }
      }
    }

    // Step 2: Try to match by exact normalized name - EXACT like local system  
    logger.info('STEP 2: Trying exact normalized name match', { normalizedVenueName });
    const { data: venuesByName, error: nameError } = await db.client
      .from('venues')
      .select('id, name, location')
      .eq('name', normalizedVenueName);

    if (nameError) throw nameError;

    if (venuesByName && venuesByName.length > 0) {
      logger.info(`Found existing venue by exact name: ${venuesByName[0].name} (ID: ${venuesByName[0].id})`);
      return venuesByName[0] as Venue;
    } else {
      logger.info(`STEP 2: No venue found by exact name: ${normalizedVenueName}`);
    }

    // Step 3: Try fuzzy matching with all venues - EXACT like local system
    logger.info('STEP 3: Trying fuzzy matching');
    const { data: allVenues, error: allVenuesError } = await db.client
      .from('venues')
      .select('id, name, location');

    if (allVenuesError) throw allVenuesError;

    if (allVenues) {
      const match = allVenues.find(v =>
        compareTwoStrings(
          v.name.toLowerCase(),
          normalizedVenueName.toLowerCase()
        ) >= FUZZY_THRESHOLD
      );

      if (match) {
        logger.info(`Found existing venue by fuzzy matching: "${normalizedVenueName}" is similar to "${match.name}" (ID: ${match.id})`);
        return match as Venue;
      }
    }

    // Step 4: Try fuzzy matching by addresses - NEW logic to match similar addresses
    if (venueData.address && allVenues) {
      const addressMatch = allVenues.find(v => 
        v.location && areAddressesSimilar(v.location, venueData.address!)
      );

      if (addressMatch) {
        logger.info(`Found existing venue by similar address: "${addressMatch.name}" (ID: ${addressMatch.id})`);
        logger.info(`  Existing address: "${addressMatch.location}"`);
        logger.info(`  New address: "${venueData.address}"`);
        return addressMatch as Venue;
      }
    }

    // No match found, proceed to create new venue
    logger.info(`No venue found for "${normalizedVenueName}". Creating new venue...`);

    // IMPORTANT: Now we standardize the address for NEW venue creation (like local system)
    let standardizedAddress = venueData.address;
    if (venueData.address) {
      try {
        // Get coordinates from Google first
        const googleResult = await fetchAddressFromGoogle(venueData.name, {});
        if (googleResult && googleResult.geometry?.location) {
          const lat = googleResult.geometry.location.lat;
          const lng = googleResult.geometry.location.lng;
          
          // Then use OpenStreetMap to standardize the address format
          const nominatimResult = await fetchAddressFromNominatim(lat, lng);
          if (nominatimResult && nominatimResult.address) {
            const addr = nominatimResult.address;
            // Reconstruct standardized address like local system
            const newStandardizedAddress = [
              addr.house_number,
              addr.road || addr.street,
              addr.city || addr.town || addr.village,
              addr.postcode,
              addr.country === 'België / Belgique / Belgien' ? 'Belgium' : addr.country
            ].filter(Boolean).join(', ');
            
            if (newStandardizedAddress.length > 0) {
              standardizedAddress = newStandardizedAddress;
              logger.info(`Standardized address for new venue: "${venueData.address}" → "${standardizedAddress}"`);
            }
          }
        }
      } catch (error) {
        logger.warn('Failed to standardize address with OpenStreetMap for new venue', error);
      }
    }

    // Prepare venue data for database
    let enrichedVenueData: any = {
      name: venueData.name,
      location: standardizedAddress || `${venueData.city || ''}, ${venueData.country || ''}`.trim() || null,
      description: null,
      image_url: null,
      capacity: null,
      is_verified: false,
      geo: null
    };

    // Enrichir avec Google Places si on a une adresse
    if (venueData.address || venueData.name) {
      try {
        logger.info(`Enriching venue "${venueData.name}" with Google Places data...`);
        
        const googleResult = await fetchAddressFromGoogle(venueData.name, geocodingExceptions);
        
        if (googleResult) {
          // Extract location details and store in geo jsonb field
          const location = googleResult.geometry?.location;
          if (location) {
            enrichedVenueData.geo = {
              latitude: location.lat,
              longitude: location.lng,
              google_places_id: googleResult.place_id,
              formatted_address: googleResult.formatted_address,
              country: null,
              locality: null
            };

            // Extract address components
            const components = googleResult.address_components || [];
            for (const component of components) {
              const types = component.types;
              
              if (types.includes('locality')) {
                enrichedVenueData.geo.locality = component.long_name;
              } else if (types.includes('country')) {
                enrichedVenueData.geo.country = component.short_name;
              }
            }
          }

          // Update location with formatted address
          enrichedVenueData.location = googleResult.formatted_address || venueData.address;

          logger.info(`Successfully enriched venue "${venueData.name}" with Google Places data`);
          
          // Try to get venue photo and upload to R2
          try {
            if (enrichedVenueData.location) {
              const photoUrl = await fetchGoogleVenuePhoto(venueData.name, enrichedVenueData.location);
              // Upload venue photo to R2
              try {
                enrichedVenueData.image_url = await downloadAndUploadToR2(photoUrl, 'venues');
                logger.info(`Venue photo uploaded to R2 for "${venueData.name}"`);
              } catch (r2Error) {
                enrichedVenueData.image_url = photoUrl;
                logger.warn(`Failed to upload venue photo to R2, using original URL for "${venueData.name}"`, r2Error);
              }
            }
          } catch (photoError) {
            logger.warn(`Could not fetch venue photo for "${venueData.name}"`, photoError);
          }
        }
      } catch (error) {
        logger.warn('Failed to enrich venue with Google Places data', error);
      }
    }

    // Pour debug - loguer les données qu'on va insérer
    logger.info('Venue data to insert:', {
      name: enrichedVenueData.name,
      location: enrichedVenueData.location,
      hasGeo: !!enrichedVenueData.geo,
      hasImage: !!enrichedVenueData.image_url
    });

    // Create venue in database
    const createdVenue = await db.createVenue(enrichedVenueData);
    logger.info(`Created venue: ${createdVenue.name} (ID: ${createdVenue.id})`);

    return createdVenue;

  } catch (error) {
    logger.error('Error creating/updating venue', error);
    throw error;
  }
}

/**
 * Searches for venues by name with fuzzy matching
 * @param searchTerm - Search term
 * @returns Promise with array of venues
 */
export async function searchVenues(searchTerm: string): Promise<Venue[]> {
  try {
    logger.debug(`Searching venues for: ${searchTerm}`);

    const { data, error } = await db.client
      .from('venues')
      .select('*')
      .or(`name.ilike.%${searchTerm}%,location.ilike.%${searchTerm}%`)
      .limit(10);

    if (error) throw error;

    logger.debug(`Found ${data?.length || 0} venues matching "${searchTerm}"`);
    return data as Venue[] || [];

  } catch (error) {
    logger.error('Error searching venues', error);
    throw error;
  }
}

/**
 * Gets venue by ID
 * @param id - Venue ID
 * @returns Promise with venue or null
 */
export async function getVenue(id: number): Promise<Venue | null> {
  try {
    const { data, error } = await db.client
      .from('venues')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }

    return data as Venue;

  } catch (error) {
    logger.error('Error getting venue', error);
    throw error;
  }
}

export default {
  fetchGoogleVenuePhoto,
  fetchAddressFromGoogle,
  createOrUpdateVenue,
  searchVenues,
  getVenue
};
