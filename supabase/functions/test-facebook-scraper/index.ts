// Test ESM import of facebook-event-scraper in Deno
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    console.log('🧪 Testing facebook-event-scraper import...');

    // Try to import the package via ESM
    let scrapeFbEvent;
    try {
      console.log('🔄 Attempting to import from npm:facebook-event-scraper...');
      const fbScraper = await import('npm:facebook-event-scraper');
      scrapeFbEvent = fbScraper.scrapeFbEvent;
      console.log('✅ Successfully imported facebook-event-scraper');
    } catch (importError) {
      console.error('❌ Import failed:', importError.message);
      
      // Try alternative import methods
      try {
        console.log('🔄 Trying esm.sh import...');
        const fbScraper = await import('https://esm.sh/facebook-event-scraper');
        scrapeFbEvent = fbScraper.scrapeFbEvent;
        console.log('✅ Successfully imported from esm.sh');
      } catch (esmError) {
        console.error('❌ ESM.sh import failed:', esmError.message);
        throw new Error('Cannot import facebook-event-scraper package');
      }
    }

    // Test the function
    const { eventId } = await req.json();
    
    if (!eventId) {
      return new Response(
        JSON.stringify({ error: 'Event ID required for testing' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('🎯 Testing scraping for event:', eventId);

    // Test the scraper
    const eventData = await scrapeFbEvent(eventId);
    console.log('✅ Scraping successful:', eventData);

    return new Response(
      JSON.stringify({
        success: true,
        message: 'facebook-event-scraper works in Deno!',
        eventData: eventData,
        timestamp: new Date().toISOString()
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('❌ Test failed:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message,
        stack: error.stack
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
