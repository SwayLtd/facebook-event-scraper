import { createSupabaseClient } from '../supabase/functions/_shared/utils/database.ts';
import { createOrUpdateVenue } from '../supabase/functions/_shared/models/venue.ts';
import { logger } from '../supabase/functions/_shared/utils/logger.ts';

const db = createSupabaseClient();

async function testVenueMatching() {
  console.log('Testing venue matching directly...');
  
  // Test data that mimics what Facebook would provide
  const venueData = {
    name: 'Fuse',
    address: 'Rue Blaes 208 Blaestraat, 1000 Brussels, Belgium',
    city: 'Brussels',
    country: 'Belgium'
  };
  
  console.log('Testing with venue data:', venueData);
  
  try {
    const result = await createOrUpdateVenue(venueData, {}, false);
    console.log('Result:', result);
    console.log('Venue ID:', result?.id);
    console.log('Venue Name:', result?.name);
    
  } catch (error) {
    console.error('Error:', error);
  }
}

testVenueMatching();
