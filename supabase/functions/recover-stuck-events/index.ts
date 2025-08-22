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
    // Create Supabase client
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    console.log('🔄 Démarrage de la récupération des événements bloqués...');

    // Appeler la fonction de récupération
    const { data, error } = await supabase.rpc('recover_stuck_events');

    if (error) {
      console.error('❌ Erreur lors de la récupération:', error);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: error.message 
        }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const result = data?.[0] || { recovered_count: 0, event_ids: [] };
    
    if (result.recovered_count > 0) {
      console.log(`✅ ${result.recovered_count} événements récupérés:`, result.event_ids);
    } else {
      console.log('✅ Aucun événement bloqué trouvé');
    }

    return new Response(
      JSON.stringify({
        success: true,
        recovered_count: result.recovered_count,
        recovered_events: result.event_ids,
        timestamp: new Date().toISOString()
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    console.error('❌ Erreur inattendue:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message 
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
