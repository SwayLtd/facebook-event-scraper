#!/usr/bin/env node
/**
 * server.js
 * 
 * Main server script that runs continuously to process Facebook events from the queue.
 * 
 * Features:
 * - Polls the facebook_events_imports table for new events
 * - Processes events with priority and retry logic
 * - Comprehensive error handling and logging
 * - Festival detection and timetable import
 * - Manual retry mechanisms
 * 
 * Usage:
 *   node server.js
 *   
 * Environment Variables:
 *   POLL_INTERVAL_MS - Polling interval in milliseconds (default: 30000)
 *   MAX_CONCURRENT_JOBS - Maximum concurrent processing jobs (default: 1)
 *   DRY_RUN - Set to 'true' for dry run mode (default: false)
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { logMessage } from './utils/logger.js';
import { delay } from './utils/delay.js';

// Configuration
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS) || 30000; // 30 seconds
const MAX_CONCURRENT_JOBS = parseInt(process.env.MAX_CONCURRENT_JOBS) || 1;
const DRY_RUN = process.env.DRY_RUN === 'true';

// Environment validation
const requiredEnvVars = [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'LONG_LIVED_TOKEN',
    'SOUND_CLOUD_CLIENT_ID',
    'SOUND_CLOUD_CLIENT_SECRET',
    'OPENAI_API_KEY'
];

for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
        console.error(`❌ Missing required environment variable: ${envVar}`);
        process.exit(1);
    }
}

// Initialize Supabase client
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Global state
let processingCount = 0;
let totalProcessed = 0;
let totalSuccess = 0;
let totalFailed = 0;
let serverRunning = true;

/**
 * Main processing loop
 */
async function mainLoop() {
    console.log(`🚀 Facebook Events Import Server started`);
    console.log(`📊 Configuration:`);
    console.log(`   - Poll interval: ${POLL_INTERVAL_MS}ms`);
    console.log(`   - Max concurrent jobs: ${MAX_CONCURRENT_JOBS}`);
    console.log(`   - Dry run mode: ${DRY_RUN ? 'ON' : 'OFF'}`);

    logMessage('Facebook Events Import Server started');

    // Main processing loop
    while (serverRunning) {
        try {
            if (processingCount < MAX_CONCURRENT_JOBS) {
                const nextEvent = await getNextEventForProcessing();

                if (nextEvent) {
                    // Process event asynchronously
                    processEventAsync(nextEvent);
                } else {
                    // No events to process, wait before checking again
                    await delay(POLL_INTERVAL_MS);
                }
            } else {
                // Wait if at max concurrent jobs
                await delay(1000);
            }
        } catch (error) {
            console.error(`❌ Error in main loop: ${error.message}`);
            logMessage(`Main loop error: ${error.message}`);
            await delay(5000); // Wait before retrying
        }
    }
}

/**
 * Gets the next event for processing from the database
 */
async function getNextEventForProcessing() {
    try {
        const { data, error } = await supabase.rpc('get_next_event_for_processing');

        if (error) throw error;

        if (data && data.length > 0) {
            return data[0];
        }

        return null;
    } catch (error) {
        console.error(`❌ Error getting next event: ${error.message}`);
        logMessage(`Error getting next event: ${error.message}`);
        return null;
    }
}

/**
 * Processes an event asynchronously
 */
async function processEventAsync(event) {
    processingCount++;
    const startTime = Date.now();

    console.log(`\n🔄 Processing event ${event.id}: ${event.facebook_url}`);
    logMessage(`Starting processing of event ${event.id}: ${event.facebook_url}`);

    try {
        // Mark event as processing
        const { error: markError } = await supabase.rpc('mark_event_processing', {
            event_id: event.id
        });

        if (markError) throw markError;

        // Add processing log
        await addProcessingLog(event.id, 'info', 'Started processing', {
            retry_count: event.retry_count,
            detected_as_festival: event.detected_as_festival
        });

        // Process the event
        const result = await processEvent(event);

        // Calculate processing time
        const processingTimeSeconds = Math.floor((Date.now() - startTime) / 1000);

        // Mark as completed
        const { error: completeError } = await supabase.rpc('mark_event_completed', {
            event_id: event.id,
            result_event_id: result.eventId,
            artists_count: result.artistsCount || 0,
            processing_seconds: processingTimeSeconds
        });

        if (completeError) throw completeError;

        await addProcessingLog(event.id, 'info', 'Processing completed successfully', {
            event_id: result.eventId,
            artists_count: result.artistsCount,
            processing_time_seconds: processingTimeSeconds,
            import_strategy: result.strategy
        });

        totalProcessed++;
        totalSuccess++;

        console.log(`✅ Event ${event.id} processed successfully in ${processingTimeSeconds}s`);
        console.log(`📊 Stats: ${totalSuccess}/${totalProcessed} successful (${((totalSuccess / totalProcessed) * 100).toFixed(1)}%)`);

        logMessage(`Event ${event.id} completed successfully: ${result.artistsCount} artists imported`);

    } catch (error) {
        const processingTimeSeconds = Math.floor((Date.now() - startTime) / 1000);

        console.error(`❌ Error processing event ${event.id}: ${error.message}`);

        // Mark as failed
        const { error: failError } = await supabase.rpc('mark_event_failed', {
            event_id: event.id,
            error_message: error.message,
            error_details_json: {
                error_type: error.constructor.name,
                stack: error.stack,
                processing_time_seconds: processingTimeSeconds,
                retry_count: event.retry_count + 1
            }
        });

        if (failError) {
            console.error(`❌ Error marking event as failed: ${failError.message}`);
        }

        await addProcessingLog(event.id, 'error', 'Processing failed', {
            error: error.message,
            processing_time_seconds: processingTimeSeconds
        });

        totalFailed++;

        console.log(`📊 Stats: ${totalSuccess}/${totalProcessed} successful (${((totalSuccess / totalProcessed) * 100).toFixed(1)}%)`);

        logMessage(`Event ${event.id} failed: ${error.message}`);
    } finally {
        processingCount--;
    }
}

/**
 * Processes a single event (similar to import_event.js logic)
 */
async function processEvent(event) {
    const { facebook_url, detected_as_festival, festival_name, clashfinder_id } = event;

    // Import the main processing logic from import_event.js
    // For now, we'll use dynamic import to reuse the logic
    const { processEventImport } = await import('./import_event_core.js');

    const result = await processEventImport({
        eventUrl: facebook_url,
        detectedAsFestival: detected_as_festival,
        festivalName: festival_name,
        clashfinderId: clashfinder_id,
        dryRun: DRY_RUN
    });

    return result;
}

/**
 * Adds a processing log entry to an event
 */
async function addProcessingLog(eventId, level, message, details = null) {
    try {
        await supabase.rpc('add_processing_log', {
            event_id: eventId,
            log_level: level,
            message: message,
            details: details
        });
    } catch (error) {
        console.error(`❌ Error adding processing log: ${error.message}`);
    }
}

/**
 * Graceful shutdown handler
 */
function setupGracefulShutdown() {
    const shutdown = async (signal) => {
        console.log(`\n🛑 Received ${signal}. Shutting down gracefully...`);
        logMessage(`Received ${signal}. Shutting down gracefully...`);

        serverRunning = false; // Stop the main loop

        // Wait for current processing to complete
        let waitTime = 0;
        while (processingCount > 0 && waitTime < 30000) { // Max 30 seconds wait
            console.log(`⏳ Waiting for ${processingCount} jobs to complete...`);
            await delay(1000);
            waitTime += 1000;
        }

        if (processingCount > 0) {
            console.log(`⚠️ Force shutdown - ${processingCount} jobs still running`);
            logMessage(`Force shutdown - ${processingCount} jobs still running`);
        }

        console.log(`📊 Final stats: ${totalSuccess}/${totalProcessed} successful`);
        logMessage(`Server shutdown complete. Final stats: ${totalSuccess}/${totalProcessed} successful`);

        process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
}

/**
 * Health check endpoint (for monitoring)
 */
function setupHealthCheck() {
    // Simple HTTP server for health checks
    import('http').then(http => {
        const server = http.createServer((req, res) => {
            if (req.url === '/health') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    status: 'healthy',
                    processing_count: processingCount,
                    total_processed: totalProcessed,
                    success_rate: totalProcessed > 0 ? ((totalSuccess / totalProcessed) * 100).toFixed(1) : 0,
                    uptime: process.uptime()
                }));
            } else {
                res.writeHead(404);
                res.end('Not Found');
            }
        });

        const port = process.env.HEALTH_CHECK_PORT || 3001;
        server.listen(port, () => {
            console.log(`🩺 Health check endpoint available at http://localhost:${port}/health`);
        });
    });
}

// Error handling for unhandled rejections
process.on('unhandledRejection', (error) => {
    console.error('❌ Unhandled Promise Rejection:', error);
    logMessage(`Unhandled Promise Rejection: ${error.message}`);
});

process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
    logMessage(`Uncaught Exception: ${error.message}`);
    process.exit(1);
});

// Start the server
(async () => {
    try {
        setupGracefulShutdown();
        setupHealthCheck();
        await mainLoop();
    } catch (error) {
        console.error('❌ Fatal error starting server:', error);
        logMessage(`Fatal error starting server: ${error.message}`);
        process.exit(1);
    }
})();
