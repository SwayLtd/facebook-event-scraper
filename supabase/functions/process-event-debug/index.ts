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
    console.log('🚀 Starting process-event-debug...');

    // Test basic env variables
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const fbToken = Deno.env.get('FACEBOOK_LONG_LIVED_TOKEN');
    
    console.log('📊 Basic variables check:', {
      SUPABASE_URL: !!supabaseUrl,
      SUPABASE_SERVICE_ROLE_KEY: !!serviceKey,
      FACEBOOK_LONG_LIVED_TOKEN: !!fbToken
    });

    if (!supabaseUrl || !serviceKey || !fbToken) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Variables d\'environnement manquantes',
          details: {
            SUPABASE_URL: !!supabaseUrl,
            SUPABASE_SERVICE_ROLE_KEY: !!serviceKey,
            FACEBOOK_LONG_LIVED_TOKEN: !!fbToken
          }
        }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    console.log('✅ All basic variables found, creating client...');

    const supabase = createClient(supabaseUrl, serviceKey);
    
    console.log('✅ Supabase client created');

    // Parse request body
    const body = await req.json();
    console.log('📝 Request body:', body);

    const { eventId } = body;

    if (!eventId) {
      return new Response(
        JSON.stringify({ error: 'Event ID is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('🎯 Processing event:', eventId);

    // Simple Facebook API test
    const fbUrl = `https://graph.facebook.com/v19.0/${eventId}?fields=id,name&access_token=${fbToken}`;
    console.log('🔗 Facebook API URL ready');
    
    const response = await fetch(fbUrl);
    console.log('📡 Facebook API response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      return new Response(
        JSON.stringify({ error: 'Facebook API error', details: errorText }),
        { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const facebookData = await response.json();
    console.log('📊 Facebook data retrieved:', facebookData);

    return new Response(
      JSON.stringify({
        success: true,
        eventId,
        facebookData,
        message: 'Debug version working!'
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('❌ Debug error:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message,
        stack: error.stack 
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
