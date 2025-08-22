import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from '@supabase/supabase-js';
import { corsHeaders } from '../_shared/cors.ts';

/**
 * Edge Function pour obtenir le status de la queue d'import
 * 
 * Usage:
 *   GET /functions/v1/queue-status
 * 
 * Réponse:
 *   - Status global de la queue
 *   - Événements récents
 *   - Statistiques de traitement
 *   - Erreurs récentes
 */

interface QueueStatusResponse {
  success: boolean;
  data: {
    status: {
      pending: number;
      processing: number;
      completed: number;
      failed: number;
      retry: number;
    };
    recent_events: Array<{
      id: number;
      facebook_url: string;
      status: string;
      created_at: string;
      priority: number;
      retry_count: number;
    }>;
    statistics: {
      total_processed_today: number;
      success_rate_today: number;
      avg_processing_time: number;
    };
    recent_failures: Array<{
      facebook_url: string;
      error_message: string;
      retry_count: number;
      updated_at: string;
    }>;
  };
}

// Obtenir le status de la queue
async function getQueueStatus(supabase: any) {
  const { data: statusData, error } = await supabase
    .from('facebook_events_imports_status')
    .select('*');
  
  if (error) throw error;
  
  const status = {
    pending: 0,
    processing: 0,
    completed: 0,
    failed: 0,
    retry: 0
  };
  
  if (statusData) {
    statusData.forEach((row: any) => {
      status[row.status as keyof typeof status] = row.count || 0;
    });
  }
  
  return status;
}

// Obtenir les événements récents
async function getRecentEvents(supabase: any, limit = 10) {
  const { data, error } = await supabase
    .from('facebook_events_imports')
    .select('id, facebook_url, status, created_at, priority, retry_count')
    .order('created_at', { ascending: false })
    .limit(limit);
  
  if (error) throw error;
  return data || [];
}

// Obtenir les statistiques du jour
async function getTodayStatistics(supabase: any) {
  const today = new Date().toISOString().split('T')[0];
  
  // Total traité aujourd'hui
  const { data: totalData, error: totalError } = await supabase
    .from('facebook_events_imports')
    .select('status')
    .gte('created_at', `${today}T00:00:00.000Z`)
    .lt('created_at', `${today}T23:59:59.999Z`);
    
  if (totalError) throw totalError;
  
  const total = totalData?.length || 0;
  const completed = totalData?.filter((row: any) => row.status === 'completed').length || 0;
  const success_rate = total > 0 ? (completed / total) * 100 : 0;
  
  // Temps de traitement moyen (simulation pour l'instant)
  const avg_processing_time = 45; // seconds - à calculer avec de vraies données
  
  return {
    total_processed_today: total,
    success_rate_today: Math.round(success_rate * 100) / 100,
    avg_processing_time
  };
}

// Obtenir les échecs récents
async function getRecentFailures(supabase: any, limit = 5) {
  const { data, error } = await supabase
    .from('facebook_events_imports')
    .select('facebook_url, error_message, retry_count, updated_at')
    .eq('status', 'failed')
    .order('updated_at', { ascending: false })
    .limit(limit);
  
  if (error) throw error;
  return data || [];
}

// Fonction principale
Deno.serve(async (req: Request) => {
  // Gestion CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  
  try {
    // Vérification de la méthode HTTP
    if (req.method !== 'GET') {
      return new Response(
        JSON.stringify({ 
          success: false, 
          message: 'Method not allowed. Use GET.' 
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
    
    // Récupération de toutes les données en parallèle
    const [status, recentEvents, statistics, recentFailures] = await Promise.all([
      getQueueStatus(supabase),
      getRecentEvents(supabase, 10),
      getTodayStatistics(supabase),
      getRecentFailures(supabase, 5)
    ]);
    
    const response: QueueStatusResponse = {
      success: true,
      data: {
        status,
        recent_events: recentEvents,
        statistics,
        recent_failures: recentFailures
      }
    };
    
    return new Response(
      JSON.stringify(response, null, 2),
      { 
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
    
  } catch (error) {
    console.error('Error in queue-status function:', error);
    
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
