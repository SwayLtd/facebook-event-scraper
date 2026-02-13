/**
 * Process Event Edge Function
 * 
 * Complete event processing system with full _shared/ architecture integration
 * Enhanced with structured logging, retry mechanisms, and comprehensive error handling
 * Replicates local JavaScript system logic with cloud-native improvements
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Declare Deno properly for Edge Functions
declare const Deno: {
  env: {
    get(key: string): string | undefined;
  };
  serve: (handler: (req: Request) => Response | Promise<Response>) => void;
};

// Supabase client import
import { createClient } from 'jsr:@supabase/supabase-js@2';

// Import de l'architecture _shared/ pour les utilitaires
import { logger } from '../_shared/utils/logger.ts';
import { withRetry } from '../_shared/utils/retry.ts';
import { BANNED_GENRES } from '../_shared/utils/constants.ts';

// Import du modèle artist pour le traitement simplifié
import { processSimpleEventArtists } from '../_shared/models/artist.ts';

// Import des modèles pour le traitement complet des venues et promoters
import { createOrUpdateVenue } from '../_shared/models/venue.ts';
import { findOrInsertPromoter, assignPromoterGenres } from '../_shared/models/promoter.ts';

// Import du modèle genre pour l'assignement
import { assignEventGenres } from '../_shared/models/genre.ts';

// Facebook scraper import
import { scrapeFbEvent } from 'npm:facebook-event-scraper';

// Constantes
const FESTIVAL_KEYWORDS = ['festival', 'fest', 'open air', 'openair', 'gathering'];
const MIN_FESTIVAL_DURATION_HOURS = 24;
const FUZZY_THRESHOLD = 0.85;

/**
 * String similarity utility (réplique de process-event)
 */
const stringSimilarity = {
  compareTwoStrings: (str1: string, str2: string): number => {
    if (str1 === str2) return 1.0;
    if (str1.length < 2 || str2.length < 2) return 0.0;
    
    const bigrams1 = new Set<string>();
    const bigrams2 = new Set<string>();
    
    for (let i = 0; i < str1.length - 1; i++) {
      bigrams1.add(str1.substring(i, i + 2));
    }
    
    for (let i = 0; i < str2.length - 1; i++) {
      bigrams2.add(str2.substring(i, i + 2));
    }
    
    const intersection = new Set([...bigrams1].filter(x => bigrams2.has(x)));
    return (2.0 * intersection.size) / (bigrams1.size + bigrams2.size);
  }
};

/**
 * Détection festival (améliorée avec logging _shared/)
 */
function detectFestival(eventData: any, options: { forceFestival?: boolean } = {}): {
  isFestival: boolean;
  confidence: number;
  reasons: string[];
  duration: { hours: number; days: number } | null;
} {
  if (options.forceFestival) {
    return {
      isFestival: true,
      confidence: 100,
      reasons: ['Force festival flag'],
      duration: null
    };
  }

  const reasons: string[] = [];
  let confidence = 0;
  let duration: { hours: number; days: number } | null = null;

  // Calcul de la durée
  if (eventData.startTimestamp && eventData.endTimestamp) {
    const startMs = eventData.startTimestamp * 1000;
    const endMs = eventData.endTimestamp * 1000;
    const durationMs = endMs - startMs;
    const hours = durationMs / (1000 * 60 * 60);
    const days = Math.ceil(hours / 24);
    
    duration = { hours, days };
    
    if (hours > MIN_FESTIVAL_DURATION_HOURS) {
      confidence += 60;
      reasons.push(`Duration > ${MIN_FESTIVAL_DURATION_HOURS}h (${hours.toFixed(1)}h)`);
    }
  }

  // Vérification des mots-clés festival
  const name = eventData.name?.toLowerCase() || '';
  for (const keyword of FESTIVAL_KEYWORDS) {
    if (name.includes(keyword.toLowerCase())) {
      confidence += 30;
      reasons.push(`Name contains "${keyword}"`);
      break;
    }
  }

  const isFestival = (duration && duration.hours > MIN_FESTIVAL_DURATION_HOURS) || confidence > 50;
  
  logger.info('Festival detection completed', {
    isFestival,
    confidence,
    reasons,
    duration
  });
  
  return { isFestival, confidence, reasons, duration };
}

/**
 * Normalize name function (réplique de process-event)
 */
function getNormalizedName(name: string): string {
  return name.trim().toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Update queue status avec logging amélioré
 */
async function updateQueueStatus(
  supabase: any,
  queueId: number | undefined,
  status: string,
  eventId?: number,
  artistsCount?: number,
  errorMessage?: string
) {
  if (!queueId) return;
  
  try {
    const { error } = await supabase.rpc('update_event_processing_status', {
      queue_id: queueId,
      new_status: status,
      event_id: eventId,
      artists_count: artistsCount || 0,
      error_message: errorMessage
    });
    
    if (error) throw error;
    
    logger.info('Queue status updated', {
      queueId,
      status,
      eventId,
      artistsCount
    });
  } catch (error) {
    logger.error('Failed to update queue status', error, { queueId, status });
  }
}

/**
 * Ensure database relation (réplique de process-event)
 */
async function ensureRelation(supabase: any, tableName: string, relationData: any, logName: string) {
  const { data: existing, error: findError } = await supabase
    .from(tableName)
    .select('*')
    .match(relationData);
    
  if (existing && existing.length > 0) {
    logger.debug(`${logName} relation already exists`, relationData);
  } else {
    const { error: insertError } = await supabase
      .from(tableName)
      .insert(relationData);
      
    if (insertError) {
      logger.error(`Failed to create ${logName} relation`, insertError);
      throw insertError;
    } else {
      logger.info(`${logName} relation created`, relationData);
    }
  }
}

/**
 * Handler principal amélioré
 */
Deno.serve(async (req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };

  const startTime = Date.now();
  let queueId: number | undefined;

  try {
    // Initialisation Supabase (comme process-event original)
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceKey);

    if (req.method === 'OPTIONS') {
      return new Response('ok', { headers: corsHeaders });
    }

    // Parse requête
    const requestBody = await req.json();
    const { 
      eventId, 
      eventUrl, 
      eventData: providedEventData,
      queueId: requestQueueId, 
      skipArtists = false, 
      forceFestival = false 
    } = requestBody;
    queueId = requestQueueId;

    // Validation URL
    let facebookEventUrl: string;
    if (eventUrl) {
      facebookEventUrl = eventUrl;
    } else if (eventId) {
      facebookEventUrl = `https://www.facebook.com/events/${eventId}`;
    } else {
      const error = 'Either eventId or eventUrl is required';
      await updateQueueStatus(supabase, queueId, 'error', undefined, 0, error);
      return new Response(
        JSON.stringify({ error }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    logger.info('Enhanced event processing started', { 
      url: facebookEventUrl, 
      queueId, 
      skipArtists, 
      forceFestival 
    });

    // Update initial status
    await updateQueueStatus(supabase, queueId, 'processing');

    // === SCRAPING avec retry amélioré ===
    let eventData;
    
    if (providedEventData) {
      logger.info('Using provided event data', { eventName: providedEventData.name });
      eventData = providedEventData;
    } else {
      logger.info('Scraping Facebook event', { url: facebookEventUrl });
      eventData = await withRetry(async () => {
        return await scrapeFbEvent(facebookEventUrl);
      });
      logger.info(`Event scraped successfully: "${eventData.name}"`, { 
        facebookId: eventData.id 
      });
    }

    // Persist scraped facebook_event_data in the queue row for future reference
    if (queueId && eventData) {
      try {
        const { error: cacheError } = await supabase
          .from('facebook_events_imports')
          .update({ facebook_event_data: eventData })
          .eq('id', queueId);
        
        if (cacheError) {
          logger.warn('Failed to cache facebook_event_data', { queueId, error: cacheError.message });
        } else {
          logger.info('Cached facebook_event_data in queue row', { queueId });
        }
      } catch (cacheErr) {
        logger.warn('Error caching facebook_event_data', { queueId, error: cacheErr.message });
      }
    }

    // === DÉTECTION FESTIVAL ===
    const festivalDetection = detectFestival(eventData, { forceFestival });

    // === TRAITEMENT ÉVÉNEMENT (logique répliquée de process-event) ===
    const eventName = eventData.name || null;
    const eventDescription = eventData.description || null;
    const eventType = festivalDetection.isFestival ? 'festival' : 
                     (eventData.categories?.[0]?.label || null);
    
    // Handle both timestamp (from scraping) and date string (from provided data)
    let startTimeISO: string | null = null;
    let endTimeISO: string | null = null;
    
    if (eventData.startTimestamp) {
      startTimeISO = new Date(eventData.startTimestamp * 1000).toISOString();
    } else if (eventData.startDate) {
      startTimeISO = new Date(eventData.startDate).toISOString();
    }
    
    if (eventData.endTimestamp) {
      endTimeISO = new Date(eventData.endTimestamp * 1000).toISOString();
    } else if (eventData.endDate) {
      endTimeISO = new Date(eventData.endDate).toISOString();
    }
    
    // Ensure at least a start date is provided
    if (!startTimeISO) {
      throw new Error('Event start date is required (provide either startTimestamp or startDate)');
    }

    // === GUARD: Reject events older than 1 year ===
    const MAX_EVENT_AGE_MS = 365 * 24 * 60 * 60 * 1000; // 1 year
    const eventStartDate = new Date(startTimeISO);
    const now = new Date();
    if (now.getTime() - eventStartDate.getTime() > MAX_EVENT_AGE_MS) {
      logger.warn('Skipping old event (older than 1 year)', {
        name: eventData.name,
        startTime: startTimeISO,
        ageInDays: Math.floor((now.getTime() - eventStartDate.getTime()) / (24 * 60 * 60 * 1000))
      });
      await updateQueueStatus(supabase, queueId, 'completed', undefined, 0);
      return new Response(
        JSON.stringify({
          success: false,
          skipped: true,
          reason: 'Event is older than 1 year',
          eventName: eventData.name,
          startTime: startTimeISO
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const fbEventUrl = eventData.url || facebookEventUrl;

    logger.info('Processing event data', {
      name: eventName,
      type: eventType,
      startTime: startTimeISO,
      endTime: endTimeISO,
      isFestival: festivalDetection.isFestival
    });

    // Recherche événement existant
    let eventDbId = null;
    const { data: eventsByUrl } = await supabase
      .from('events')
      .select('id, metadata, description, date_time, end_date_time')
      .ilike('metadata->>facebook_url', fbEventUrl);

    if (eventsByUrl && eventsByUrl.length > 0) {
      eventDbId = eventsByUrl[0].id;
      logger.info(`Event found by URL (id=${eventDbId})`);
      
      // Vérifier les mises à jour
      const existing = eventsByUrl[0];
      const updates: any = {};
      
      if (existing.description !== eventDescription) {
        updates.description = eventDescription;
      }
      if (existing.date_time !== startTimeISO) {
        updates.date_time = startTimeISO;
      }
      if (existing.end_date_time !== endTimeISO) {
        updates.end_date_time = endTimeISO;
      }

      if (Object.keys(updates).length > 0) {
        await supabase.from('events').update(updates).eq('id', eventDbId);
        logger.info(`Event updated (id=${eventDbId})`, updates);
      }
    } else {
      // Créer nouvel événement
      logger.info('Creating new event', { name: eventName, type: eventType });
      
      const metadata: any = { facebook_url: fbEventUrl };
      if (eventData.ticketUrl) {
        metadata.ticket_link = eventData.ticketUrl;
      }
      
      const eventRecord = {
        title: eventName,
        type: eventType,
        date_time: startTimeISO,
        end_date_time: endTimeISO,
        description: eventDescription,
        image_url: eventData.photo?.imageUri || null,
        metadata: metadata
      };
      
      const { data: newEvent, error: insertError } = await supabase
        .from('events')
        .insert(eventRecord)
        .select('id')
        .single();
        
      if (newEvent) {
        eventDbId = newEvent.id;
        logger.info(`Event created successfully (id=${eventDbId})`);
      } else {
        throw new Error(`Event creation failed: ${insertError?.message}`);
      }
    }

    // === TRAITEMENT ARTISTES avec _shared/ ===
    let totalArtists = 0;
    if (!skipArtists && eventDescription && eventDbId) {
      try {
        logger.info('Processing artists with _shared/ model', {
          skipArtists,
          hasDescription: !!eventDescription,
          eventDbId,
          descriptionLength: eventDescription?.length
        });
        
        // Test API key availability
        const hasOpenAiKey = !!Deno.env.get('OPENAI_API_KEY');
        logger.info('API Key availability check', { hasOpenAiKey });
        
        const artistIds = await processSimpleEventArtists(eventDbId, eventDescription, false);
        totalArtists = artistIds.length;
        logger.info(`Artists processed successfully: ${totalArtists} artists`, { artistIds });
      } catch (artistError) {
        logger.error('Artist processing failed', {
          error: artistError,
          message: artistError?.message,
          stack: artistError?.stack
        });
      }
    } else {
      logger.warn('Skipping artist processing', {
        skipArtists,
        hasDescription: !!eventDescription,
        eventDbId
      });
    }

    // === TRAITEMENT PROMOTERS ET VENUES ===
    let venueId: number | null = null;
    let promoterIds: number[] = [];

    try {
      // Traitement des promoters (hosts Facebook)
      if (eventData.hosts && eventData.hosts.length > 0) {
        logger.info(`Processing ${eventData.hosts.length} promoters/hosts`);
        
        for (const host of eventData.hosts) {
          try {
            const promoter = await findOrInsertPromoter(
              host.name,
              { hosts: eventData.hosts },
              false // pas de dry run
            );
            
            if (promoter && promoter.id) {
              promoterIds.push(promoter.id);
              
              // Créer la relation event-promoter si elle n'existe pas
              const { error: relationError } = await supabase
                .from('event_promoter')
                .upsert({ 
                  event_id: eventDbId, 
                  promoter_id: promoter.id 
                }, { 
                  onConflict: 'event_id,promoter_id' 
                });
                
              if (!relationError) {
                logger.info(`Promoter relation created: event ${eventDbId} <-> promoter ${promoter.id}`);
              }
            }
          } catch (promoterError) {
            logger.error(`Failed to process promoter ${host.name}`, promoterError);
          }
        }
      }

      // Traitement du venue
      if (eventData.location && eventDbId) {
        logger.info('Processing venue from event location', {
          locationName: eventData.location.name,
          hasAddress: !!eventData.location.address,
          city: eventData.location.city,
          country: eventData.location.country
        });
        
        // DEBUG: Log exact venue data being passed
        // Facebook returns city/country as objects {id, name}, extract .name
        const cityStr = typeof eventData.location.city === 'object' 
          ? eventData.location.city?.name 
          : eventData.location.city;
        const countryStr = typeof eventData.location.country === 'object'
          ? eventData.location.country?.name
          : eventData.location.country;
          
        const venueDataToProcess = {
          name: eventData.location.name || 'Unknown Venue',
          address: eventData.location.address || undefined,
          city: cityStr || undefined,
          country: countryStr || undefined
        };
        logger.info('VENUE DEBUG: Exact data passed to createOrUpdateVenue:', venueDataToProcess);
        
        try {
          const venue = await createOrUpdateVenue(venueDataToProcess, {}, false); // pas de dry run

          if (venue && venue.id) {
            venueId = venue.id;
            logger.info(`Venue processed successfully: ${venue.id} (${venue.name})`);
            logger.info('VENUE DEBUG: Final venue result:', { id: venue.id, name: venue.name });
            
            // Créer la relation event-venue dans la table event_venue
            const { error: relationError } = await supabase
              .from('event_venue')
              .upsert({ 
                event_id: eventDbId, 
                venue_id: venueId 
              }, { 
                onConflict: 'event_id,venue_id' 
              });
              
            if (!relationError) {
              logger.info(`Event ${eventDbId} linked to venue ${venueId} via event_venue table`);
            } else {
              logger.error('Failed to create event-venue relation', relationError);
            }

            // === VENUE IMAGE PRIORITY: Use promoter image when venue name matches a promoter ===
            try {
              const venueName = (venueDataToProcess.name || '').toLowerCase().trim();
              if (venueName && promoterIds.length > 0) {
                // Get promoter data to compare names
                const { data: matchedPromoters } = await supabase
                  .from('promoters')
                  .select('id, name, image_url')
                  .in('id', promoterIds)
                  .not('image_url', 'is', null);

                if (matchedPromoters) {
                  const matchingPromoter = matchedPromoters.find(
                    (p: any) => p.name && p.name.toLowerCase().trim() === venueName
                  );

                  if (matchingPromoter && matchingPromoter.image_url) {
                    // Check if venue has no image or only a Google Maps image
                    const { data: venueData } = await supabase
                      .from('venues')
                      .select('image_url')
                      .eq('id', venueId)
                      .single();

                    const currentImage = venueData?.image_url || '';
                    const isGoogleImage = currentImage.includes('maps.googleapis.com');
                    const hasNoImage = !currentImage;

                    if (hasNoImage || isGoogleImage) {
                      await supabase
                        .from('venues')
                        .update({ image_url: matchingPromoter.image_url })
                        .eq('id', venueId);
                      logger.info(`Venue ${venueId} image updated from matching promoter ${matchingPromoter.id} (${matchingPromoter.name})`);
                    }
                  }
                }
              }
            } catch (imgErr) {
              logger.warn('Failed to check/update venue image from promoter', imgErr);
            }
          } else {
            logger.warn('No venue returned from createOrUpdateVenue');
          }
        } catch (venueError) {
          logger.error('Failed to process venue', {
            error: venueError,
            message: venueError?.message,
            stack: venueError?.stack
          });
        }
      } else {
        logger.warn('No location data found in event for venue processing', {
          hasLocation: !!eventData.location,
          eventDbId
        });
      }

      // Créer les relations venue-promoter UNIQUEMENT quand le nom du promoteur correspond au nom du venue
      // (comme dans le script local — un venue est lié à un promoteur seulement si c'est le même établissement)
      if (venueId && promoterIds.length > 0 && eventData.location?.name) {
        const venueName = (eventData.location.name || '').toLowerCase().trim();
        logger.info(`Checking venue-promoter relations: venue "${venueName}" vs ${promoterIds.length} promoters`);
        
        // Get promoter names to compare with venue name
        const { data: promoterData } = await supabase
          .from('promoters')
          .select('id, name')
          .in('id', promoterIds);
        
        if (promoterData) {
          for (const promoter of promoterData) {
            const promoterName = (promoter.name || '').toLowerCase().trim();
            if (promoterName === venueName) {
              try {
                const { error: vpRelationError } = await supabase
                  .from('venue_promoter')
                  .upsert({ 
                    venue_id: venueId, 
                    promoter_id: promoter.id 
                  }, { 
                    onConflict: 'venue_id,promoter_id' 
                  });
                  
                if (!vpRelationError) {
                  logger.info(`Venue-promoter relation created (name match): venue ${venueId} <-> promoter ${promoter.id} ("${promoter.name}")`);
                } else {
                  logger.error(`Failed to create venue-promoter relation: ${vpRelationError.message}`);
                }
              } catch (vpError) {
                logger.error(`Error creating venue-promoter relation for promoter ${promoter.id}`, vpError);
              }
            }
          }
        }
      }
    } catch (error) {
      logger.error('Failed to process promoters/venues', error);
    }

    // === ASSIGNEMENT DES GENRES ===
    if (eventDbId) {
      try {
        logger.info('Assigning genres to event');
        const genreResult = await assignEventGenres(eventDbId, festivalDetection.isFestival);
        logger.info(`Genres assigned successfully`, {
          genreCount: genreResult.genres.length,
          source: genreResult.source,
          confidence: genreResult.confidence
        });
      } catch (genreError) {
        logger.error('Failed to assign event genres', genreError);
      }

      // Assignement des genres aux promoters
      if (promoterIds.length > 0) {
        logger.info(`Assigning genres to ${promoterIds.length} promoters`);
        
        for (const promoterId of promoterIds) {
          try {
            await assignPromoterGenres(promoterId, [], festivalDetection.isFestival);
            logger.info(`Genres assigned to promoter ${promoterId}`);
          } catch (promoterGenreError) {
            logger.error(`Failed to assign genres to promoter ${promoterId}`, promoterGenreError);
          }
        }
      }
    }

    // === RÉSULTAT ===
    const processingTime = Date.now() - startTime;
    const result = {
      success: true,
      eventId: eventDbId,
      eventName: eventName,
      importStrategy: festivalDetection.isFestival ? 'festival' : 'simple',
      isFestival: festivalDetection.isFestival,
      artistsProcessed: totalArtists,
      promotersProcessed: promoterIds.length,
      venueId: venueId,
      processingTimeMs: processingTime
    };

    await updateQueueStatus(supabase, queueId, 'completed', eventDbId || undefined, totalArtists);

    logger.info('Enhanced event processing completed successfully', result);

    return new Response(
      JSON.stringify(result),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    logger.error('Enhanced event processing failed', error);
    
    const errorMessage = error.message || 'Enhanced processing error';
    await updateQueueStatus(
      createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!), 
      queueId, 
      'error', 
      undefined, 
      0, 
      errorMessage
    );
    
    return new Response(
      JSON.stringify({ 
        error: 'Enhanced processing failed', 
        details: errorMessage,
        queueId 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
