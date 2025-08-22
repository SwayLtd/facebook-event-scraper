import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from '@supabase/supabase-js';
import { corsHeaders } from '../_shared/cors.ts';

/**
 * Edge Function pour réinitialiser un événement en échec pour retry
 * 
 * Usage:
 *   POST /functions/v1/retry-event
 *   Body: {
 *     "event_id": 123
 *   }
 *   
 *   ou
 *   
 *   POST /functions/v1/retry-event
 *   Body: {
 *     "facebook_url": "https://www.facebook.com/events/123456789"
 *   }
 */

interface RetryEventRequest {
  event_id?: number;
  facebook_url?: string;
}

interface RetryEventResponse {
  success: boolean;
  message: string;
  data?: {
    id: number;
    status: string;
    retry_count: number;
  };
}

// Fonction principale
Deno.serve(async (req: Request) => {
  // Gestion CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  
  try {
    // Vérification de la méthode HTTP
    if (req.method !== 'POST') {
      return new Response(
        JSON.stringify({ 
          success: false, 
          message: 'Method not allowed. Use POST.' 
        }),
        { 
          status: 405, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }
    
    // Initialisation du client Supabase
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );
    
    // Parsing du body
    const body: RetryEventRequest = await req.json();
    
    // Validation des données
    if (!body.event_id && !body.facebook_url) {
      return new Response(
        JSON.stringify({
          success: false,
          message: 'Either event_id or facebook_url is required'
        }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }
    
    // Trouver l'événement
    let query = supabase
      .from('facebook_events_imports')
      .select('id, status, retry_count, max_retries, facebook_url');
    
    if (body.event_id) {
      query = query.eq('id', body.event_id);
    } else {
      query = query.eq('facebook_url', body.facebook_url);
    }
    
    const { data: eventData, error: findError } = await query.single();
    
    if (findError) {
      if (findError.code === 'PGRST116') {
        return new Response(
          JSON.stringify({
            success: false,
            message: 'Event not found'
          }),
          { 
            status: 404, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          }
        );
      }
      throw findError;
    }
    
    // Vérifier si l'événement peut être réinitialisé
    if (eventData.status === 'pending' || eventData.status === 'processing') {
      return new Response(
        JSON.stringify({
          success: false,
          message: `Event is already ${eventData.status}. No retry needed.`
        }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }
    
    if (eventData.status === 'completed') {
      return new Response(
        JSON.stringify({
          success: false,
          message: 'Event is already completed. Cannot retry completed events.'
        }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }
    
    // Réinitialiser l'événement
    const { data: updated, error: updateError } = await supabase
      .from('facebook_events_imports')
      .update({
        status: 'pending',
        error_message: null,
        error_details: null,
        started_processing_at: null,
        completed_at: null,
        updated_at: new Date().toISOString()
      })
      .eq('id', eventData.id)
      .select('id, status, retry_count')
      .single();
    
    if (updateError) throw updateError;
    
    const response: RetryEventResponse = {
      success: true,
      message: 'Event reset for retry successfully',
      data: {
        id: updated.id,
        status: updated.status,
        retry_count: updated.retry_count
      }
    };
    
    return new Response(
      JSON.stringify(response),
      { 
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
    
  } catch (error) {
    console.error('Error in retry-event function:', error);
    
    return new Response(
      JSON.stringify({
        success: false,
        message: 'Internal server error',
        error: error instanceof Error ? error.message : 'Unknown error'
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
