/**
 * Edge Function: queue-processor
 * 
 * Remplace queue_processor.js - traite la queue automatiquement
 * Appellée périodiquement via cron job ou webhook
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const MAX_CONCURRENT_PROCESSING = 3;
const PROCESS_EVENT_FUNCTION_URL = 'https://gvuwtsdhgqefamzyfyjm.supabase.co/functions/v1/process-event';

// CORS Headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS, PUT, DELETE',
};

class EdgeLogger {
  static log(level: 'INFO' | 'WARN' | 'ERROR', message: string, data?: any) {
    const timestamp = new Date().toISOString();
    const emoji = level === 'INFO' ? 'ℹ️' : level === 'WARN' ? '⚠️' : '❌';
    console.log(`${emoji} [${timestamp}] ${message}${data ? ` - ${JSON.stringify(data)}` : ''}`);
  }

  static info(message: string, data?: any) {
    this.log('INFO', message, data);
  }

  static error(message: string, data?: any) {
    this.log('ERROR', message, data);
  }
}

/**
 * Appelle l'Edge Function process-event pour traiter un événement
 */
async function callProcessEvent(serviceKey: string): Promise<any> {
  try {
    const response = await fetch(PROCESS_EVENT_FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${serviceKey}`,
        'Content-Type': 'application/json'
      }
    });
    
    return await response.json();
  } catch (error) {
    EdgeLogger.error('Erreur appel process-event', { error: error.message });
    return { success: false, error: error.message };
  }
}

/**
 * Récupère le nombre d'événements en cours de traitement
 */
async function getProcessingCount(supabase: any): Promise<number> {
  try {
    const { data, error } = await supabase
      .from('facebook_events_imports')
      .select('id', { count: 'exact' })
      .eq('status', 'processing');
    
    if (error) {
      EdgeLogger.error('Erreur récupération count processing', { error });
      return 0;
    }
    
    return data?.length || 0;
  } catch (error) {
    EdgeLogger.error('Erreur count processing', { error: error.message });
    return 0;
  }
}

Deno.serve(async (req) => {
  // CORS
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Configuration
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    if (!supabaseUrl || !serviceKey) {
      throw new Error('Variables d\'environnement manquantes');
    }
    
    const supabase = createClient(supabaseUrl, serviceKey);
    
    EdgeLogger.info('🚀 Démarrage queue processor');
    
    // Vérifier combien d'événements sont en cours
    const processingCount = await getProcessingCount(supabase);
    EdgeLogger.info(`📊 Événements en cours de traitement: ${processingCount}`);
    
    // Calculer combien d'événements on peut traiter
    const canProcess = Math.max(0, MAX_CONCURRENT_PROCESSING - processingCount);
    
    if (canProcess === 0) {
      EdgeLogger.info('⏸️ Limite de traitement concurrent atteinte');
      return new Response(
        JSON.stringify({ 
          success: true,
          message: 'Limite concurrent atteinte',
          processing: processingCount,
          started: 0
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Traiter les événements disponibles
    const results = [];
    for (let i = 0; i < canProcess; i++) {
      const result = await callProcessEvent(serviceKey);
      results.push(result);
      
      // Si pas d'événement disponible, arrêter
      if (result.processed === 0) {
        break;
      }
    }
    
    const successful = results.filter(r => r.success && r.processed > 0);
    
    EdgeLogger.info(`✅ Traitement terminé`, { 
      attempted: results.length,
      successful: successful.length,
      processingBefore: processingCount
    });
    
    return new Response(
      JSON.stringify({ 
        success: true,
        message: `${successful.length} événements démarrés`,
        processing_before: processingCount,
        started: successful.length,
        results: results
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
    
  } catch (error) {
    EdgeLogger.error('Erreur globale queue-processor', { error: error.message });
    
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message
      }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
