import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from '@supabase/supabase-js';
import { corsHeaders } from '../_shared/cors.ts';

/**
 * Edge Function pour ajouter des événements Facebook à la queue d'import
 * 
 * Usage:
 *   POST /functions/v1/add-event
 *   Body: {
 *     "facebook_url": "https://www.facebook.com/events/123456789",
 *     "priority": 5
 *   }
 * 
 * Fonctionnalités:
 *   - Validation de l'URL Facebook
 *   - Déduplication automatique
 *   - Gestion des priorités
 *   - Status de la queue en temps réel
 */

interface AddEventRequest {
  facebook_url: string;
  priority?: number;
}

interface AddEventResponse {
  success: boolean;
  message: string;
  data?: {
    id: number;
    status: string;
    queue_position?: number;
  };
  queue_status?: {
    pending: number;
    processing: number;
    completed: number;
    failed: number;
  };
}

// Validation de l'URL Facebook
function validateFacebookUrl(url: string): boolean {
  const fbEventRegex = /^https:\/\/(www\.)?facebook\.com\/events\/\d+/i;
  return fbEventRegex.test(url);
}

// Obtenir le status de la queue
async function getQueueStatus(supabase: any): Promise<any> {
  const { data: statusData, error } = await supabase
    .from('facebook_events_imports_status')
    .select('*');
  
  if (error) throw error;
  
  const status = {
    pending: 0,
    processing: 0,
    completed: 0,
    failed: 0
  };
  
  if (statusData) {
    statusData.forEach((row: any) => {
      status[row.status as keyof typeof status] = row.count || 0;
    });
  }
  
  return status;
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
    const body: AddEventRequest = await req.json();
    
    // Validation des données
    if (!body.facebook_url) {
      return new Response(
        JSON.stringify({
          success: false,
          message: 'facebook_url is required'
        }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }
    
    // Validation de l'URL Facebook
    if (!validateFacebookUrl(body.facebook_url)) {
      return new Response(
        JSON.stringify({
          success: false,
          message: 'Invalid Facebook event URL format. Expected: https://www.facebook.com/events/123456789'
        }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }
    
    const priority = Math.max(1, Math.min(10, body.priority || 5)); // Entre 1 et 10
    
    // Vérifier si l'événement existe déjà
    const { data: existing, error: checkError } = await supabase
      .from('facebook_events_imports')
      .select('id, status, retry_count, priority')
      .eq('facebook_url', body.facebook_url)
      .single();
    
    if (checkError && checkError.code !== 'PGRST116') { // PGRST116 = no rows found
      throw checkError;
    }
    
    let result;
    
    if (existing) {
      // L'événement existe déjà
      result = {
        success: true,
        message: `Event already exists in queue with status: ${existing.status}`,
        data: {
          id: existing.id,
          status: existing.status,
          queue_position: existing.status === 'pending' ? 
            await getQueuePosition(supabase, existing.id, existing.priority) : undefined
        }
      };
    } else {
      // Ajouter le nouvel événement
      const { data: inserted, error: insertError } = await supabase
        .from('facebook_events_imports')
        .insert({
          facebook_url: body.facebook_url,
          priority: priority,
          status: 'pending'
        })
        .select('id')
        .single();
      
      if (insertError) throw insertError;
      
      const queuePosition = await getQueuePosition(supabase, inserted.id, priority);
      
      result = {
        success: true,
        message: 'Event added to import queue successfully',
        data: {
          id: inserted.id,
          status: 'pending',
          queue_position: queuePosition
        }
      };
    }
    
    // Ajouter le status de la queue
    result.queue_status = await getQueueStatus(supabase);
    
    return new Response(
      JSON.stringify(result),
      { 
        status: existing ? 200 : 201,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
    
  } catch (error) {
    console.error('Error in add-event function:', error);
    
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

// Fonction helper pour calculer la position dans la queue
async function getQueuePosition(supabase: any, eventId: number, priority: number): Promise<number> {
  const { data, error } = await supabase
    .from('facebook_events_imports')
    .select('id')
    .eq('status', 'pending')
    .or(`priority.lt.${priority},and(priority.eq.${priority},id.lt.${eventId})`)
    .order('priority', { ascending: true })
    .order('created_at', { ascending: true });
  
  if (error) {
    console.warn('Could not calculate queue position:', error);
    return 0;
  }
  
  return (data?.length || 0) + 1;
}
