#!/usr/bin/env node
/**
 * add_event.js
 * 
 * Utility script to add Facebook events to the import queue
 * 
 * Usage:
 *   node add_event.js <facebook_event_url> [--priority=<number>]
 *   
 * Examples:
 *   node add_event.js https://www.facebook.com/events/123456789
 *   node add_event.js https://www.facebook.com/events/123456789 --priority=10
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { logMessage } from './utils/logger.js';

// Environment validation
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables');
    process.exit(1);
}

// Initialize Supabase client
const supabase = createClient(
    process.env.SUPABASE_URL, 
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Parses command line arguments
 */
function parseArgs() {
    const args = process.argv.slice(2);
    if (args.length === 0) {
        console.error('❌ No Facebook event URL provided');
        console.log('Usage: node add_event.js <facebook_event_url> [--priority=<number>]');
        console.log('Examples:');
        console.log('  node add_event.js https://www.facebook.com/events/123456789');
        console.log('  node add_event.js https://www.facebook.com/events/123456789 --priority=10');
        process.exit(1);
    }
    
    const facebookUrl = args[0];
    let priority = 0;
    
    // Parse optional priority argument
    const priorityArg = args.find(arg => arg.startsWith('--priority='));
    if (priorityArg) {
        priority = parseInt(priorityArg.split('=')[1]) || 0;
    }
    
    return { facebookUrl, priority };
}

/**
 * Validates Facebook event URL
 */
function validateFacebookUrl(url) {
    const fbEventRegex = /^https:\/\/(www\.)?facebook\.com\/events\/\d+/i;
    return fbEventRegex.test(url);
}

/**
 * Adds event to the import queue
 */
async function addEventToQueue(facebookUrl, priority = 0) {
    try {
        console.log('🔄 Adding event to import queue...');
        console.log(`📍 URL: ${facebookUrl}`);
        console.log(`⭐ Priority: ${priority}`);
        
        // Check if event already exists in queue
        const { data: existing, error: checkError } = await supabase
            .from('facebook_events_imports')
            .select('id, status, retry_count')
            .eq('facebook_url', facebookUrl)
            .single();
        
        if (checkError && checkError.code !== 'PGRST116') { // PGRST116 = no rows found
            throw checkError;
        }
        
        if (existing) {
            console.log('⚠️ Event already exists in queue:');
            console.log(`   ID: ${existing.id}`);
            console.log(`   Status: ${existing.status}`);
            console.log(`   Retry count: ${existing.retry_count}`);
            
            // Ask if user wants to reset for retry
            const readline = await import('readline');
            const rl = readline.createInterface({
                input: process.stdin,
                output: process.stdout
            });
            
            const answer = await new Promise(resolve => {
                rl.question('Do you want to reset this event for retry? (y/N): ', resolve);
            });
            rl.close();
            
            if (answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes') {
                const { error: resetError } = await supabase.rpc('reset_event_for_retry', {
                    event_id: existing.id
                });
                
                if (resetError) throw resetError;
                
                console.log('✅ Event reset for retry');
                logMessage(`Event ${existing.id} reset for retry: ${facebookUrl}`);
            } else {
                console.log('ℹ️ Event left unchanged');
            }
            
            return existing.id;
        }
        
        // Insert new event into queue
        const { data: inserted, error: insertError } = await supabase
            .from('facebook_events_imports')
            .insert({
                facebook_url: facebookUrl,
                priority: priority,
                status: 'pending'
            })
            .select('id')
            .single();
        
        if (insertError) throw insertError;
        
        console.log('✅ Event successfully added to import queue');
        console.log(`📝 Queue ID: ${inserted.id}`);
        
        logMessage(`New event added to queue (ID: ${inserted.id}): ${facebookUrl} (priority: ${priority})`);
        
        return inserted.id;
        
    } catch (error) {
        console.error('❌ Error adding event to queue:', error.message);
        logMessage(`Error adding event to queue: ${error.message} - URL: ${facebookUrl}`);
        throw error;
    }
}

/**
 * Shows queue status
 */
async function showQueueStatus() {
    try {
        console.log('\n📊 Current queue status:');
        
        const { data: statusData, error } = await supabase
            .from('facebook_events_imports_status')
            .select('*');
        
        if (error) throw error;
        
        if (statusData && statusData.length > 0) {
            statusData.forEach(row => {
                console.log(`   ${row.status.toUpperCase()}: ${row.count} events`);
                if (row.avg_processing_time) {
                    console.log(`     └─ Avg processing time: ${row.avg_processing_time}s`);
                }
                if (row.avg_artists_imported) {
                    console.log(`     └─ Avg artists imported: ${row.avg_artists_imported.toFixed(1)}`);
                }
            });
        } else {
            console.log('   No events in queue');
        }
        
        // Show recent failures
        const { data: failures, error: failError } = await supabase
            .from('facebook_events_imports_failures')
            .select('facebook_url, last_error_message, retry_count, updated_at')
            .limit(5);
        
        if (failError) throw failError;
        
        if (failures && failures.length > 0) {
            console.log('\n🚨 Recent failures:');
            failures.forEach(failure => {
                console.log(`   • ${failure.facebook_url}`);
                console.log(`     Error: ${failure.last_error_message}`);
                console.log(`     Retries: ${failure.retry_count}`);
                console.log(`     Last attempt: ${new Date(failure.updated_at).toLocaleString()}`);
            });
        }
        
    } catch (error) {
        console.error('❌ Error getting queue status:', error.message);
    }
}

/**
 * Main function
 */
async function main() {
    try {
        const { facebookUrl, priority } = parseArgs();
        
        // Validate Facebook URL
        if (!validateFacebookUrl(facebookUrl)) {
            console.error('❌ Invalid Facebook event URL format');
            console.log('Expected format: https://www.facebook.com/events/123456789');
            process.exit(1);
        }
        
        // Add event to queue
        await addEventToQueue(facebookUrl, priority);
        
        // Show queue status
        await showQueueStatus();
        
        console.log('\n🎉 Done! The server will process this event automatically.');
        
    } catch (error) {
        console.error('❌ Fatal error:', error.message);
        process.exit(1);
    }
}

// Run main function
main();
