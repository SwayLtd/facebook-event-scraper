/**
 * Artist processing utilities for Edge Function
 * Simplified version of the local artist model
 */

/**
 * Simple artist name extraction from event description
 * Fallback when OpenAI is not available
 */
export function extractArtistsFromDescription(description: string): string[] {
  if (!description) return [];
  
  const artists: string[] = [];
  const text = description.toLowerCase();
  
  // Common patterns for artists in event descriptions
  const patterns = [
    /(?:featuring|ft\.?|with|lineup[:\s]+)(.*?)(?:\n|$|presented|tickets)/gi,
    /(?:artists?|djs?|performers?)[:\s]+(.*?)(?:\n|$|presented|tickets)/gi,
    /(?:headliners?)[:\s]+(.*?)(?:\n|$|presented|tickets)/gi
  ];
  
  patterns.forEach(pattern => {
    const matches = text.match(pattern);
    if (matches) {
      matches.forEach(match => {
        // Extract artist names from the matched text
        const artistsText = match.replace(/^(?:featuring|ft\.?|with|lineup[:\s]+|artists?[:\s]+|djs?[:\s]+|performers?[:\s]+|headliners?[:\s]+)/i, '').trim();
        
        // Split by common separators
        const splitArtists = artistsText
          .split(/[,&+\|\n]|(?:\s+(?:vs|b2b|and|with)\s+)/i)
          .map(name => name.trim())
          .filter(name => 
            name.length > 1 && 
            name.length < 50 &&
            !name.match(/^(?:presents?|tickets?|doors?|info|more|www\.|http)/i)
          );
          
        artists.push(...splitArtists);
      });
    }
  });
  
  // Remove duplicates and clean up
  const uniqueArtists = Array.from(new Set(artists))
    .map(name => name.trim())
    .filter(name => name.length > 1)
    .slice(0, 20); // Limit to first 20 artists
    
  return uniqueArtists;
}

/**
 * Normalize artist name for database insertion
 */
export function normalizeArtistName(name: string): string {
  return name
    .trim()
    .replace(/[^\w\s&-]/g, '') // Keep alphanumeric, spaces, &, and -
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Simple artist insertion without full enrichment
 * Simplified version for Edge Function
 */
export async function insertSimpleArtist(supabase: any, artistName: string): Promise<number | null> {
  const normalizedName = normalizeArtistName(artistName);
  if (!normalizedName || normalizedName.length < 2) return null;
  
  try {
    // Check if artist already exists
    const { data: existing, error: findError } = await supabase
      .from('artists')
      .select('id')
      .eq('name', normalizedName)
      .single();
      
    if (existing) {
      console.log(`➡️ Artist "${normalizedName}" already exists (id=${existing.id})`);
      return existing.id;
    }
    
    // Insert new artist
    const { data: newArtist, error: insertError } = await supabase
      .from('artists')
      .insert({
        name: normalizedName,
        image_url: null, // Will be enriched later
        description: null,
        is_verified: false,
        external_links: {},
        location_info: {}
      })
      .select('id')
      .single();
      
    if (newArtist) {
      console.log(`✅ New artist inserted: "${normalizedName}" (id=${newArtist.id})`);
      return newArtist.id;
    } else {
      console.error(`❌ Failed to insert artist "${normalizedName}":`, insertError);
      return null;
    }
  } catch (error) {
    console.error(`❌ Error processing artist "${normalizedName}":`, error);
    return null;
  }
}

/**
 * Process simple event artists (simplified version)
 */
export async function processSimpleEventArtists(
  supabase: any, 
  eventId: number, 
  eventDescription: string
): Promise<number> {
  if (!eventDescription) {
    console.log('⚠️ No event description available for artist extraction');
    return 0;
  }
  
  console.log('🎭 Extracting artists from event description...');
  const extractedArtists = extractArtistsFromDescription(eventDescription);
  
  if (extractedArtists.length === 0) {
    console.log('ℹ️ No artists found in event description');
    return 0;
  }
  
  console.log(`🎯 Found ${extractedArtists.length} potential artists:`, extractedArtists);
  
  let processedCount = 0;
  
  for (const artistName of extractedArtists) {
    try {
      const artistId = await insertSimpleArtist(supabase, artistName);
      
      if (artistId) {
        // Create event_artist relation
        const { error: relationError } = await supabase
          .from('event_artist')
          .insert({
            event_id: eventId,
            artist_id: [artistId], // Note: artist_id is an array in your schema
            status: 'confirmed'
          });
          
        if (relationError) {
          console.error(`❌ Failed to create event_artist relation for "${artistName}":`, relationError);
        } else {
          console.log(`✅ Event_artist relation created for "${artistName}" (id=${artistId})`);
          processedCount++;
        }
      }
    } catch (error) {
      console.error(`❌ Error processing artist "${artistName}":`, error);
    }
  }
  
  console.log(`🎉 Processed ${processedCount} artists for event ${eventId}`);
  return processedCount;
}
