#!/usr/bin/env node

/**
 * enrich_artist_data.js
 * 
 * Script to enrich artist database with social media links, music platform links, and contact emails.
 * 
 * Sources:
 * - SoundCloud API (users/{id}/web-profiles) for social media links
 * - MusicBrainz API for music platform links and additional data
 * - Enhanced email extraction from descriptions
 * 
 * Usage:
 *   node enrich_artist_data.js [--dry-run] [--artist-id=123] [--batch-size=50]
 */

import 'dotenv/config';
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';

// Import utilities
import { delay } from './utils/delay.js';
import { getAccessToken } from './utils/token.js';
import { logMessage } from './utils/logger.js';
import { withApiRetry } from './utils/retry.js';
import { existsSync, readFileSync, writeFileSync } from 'fs';

// --- Configuration ---
const DRY_RUN = process.env.DRY_RUN === 'true' || process.argv.includes('--dry-run');
const SOUND_CLOUD_CLIENT_ID = process.env.SOUND_CLOUD_CLIENT_ID;
const SOUND_CLOUD_CLIENT_SECRET = process.env.SOUND_CLOUD_CLIENT_SECRET;
const PROGRESS_FILE = 'enrichment_progress.json';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env');
    process.exit(1);
}

if (!SOUND_CLOUD_CLIENT_ID || !SOUND_CLOUD_CLIENT_SECRET) {
    console.error('❌ Please set SOUND_CLOUD_CLIENT_ID and SOUND_CLOUD_CLIENT_SECRET in .env');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// --- Supported platforms and email types ---
const SUPPORTED_PLATFORMS = {
    // Music platforms
    'spotify': 'spotify',
    'soundcloud': 'soundcloud', 
    'youtube': 'youtube',
    'apple_music': 'apple_music',
    'deezer': 'deezer',
    'bandcamp': 'bandcamp',
    'tidal': 'tidal',
    // Social platforms
    'instagram': 'instagram',
    'tiktok': 'tiktok',
    'facebook': 'facebook',
    'twitter': 'twitter',
    'x': 'twitter', // X is the new Twitter
    // Other
    'wikipedia': 'wikipedia'
};

// Email types for reference (used in email categorization logic)
// const EMAIL_TYPES = ['contact', 'booking', 'press', 'management', 'ar', 'radio', 'distribution', 'touring', 'label', 'publisher', 'info', 'general'];

// --- Progress Management ---

/**
 * Save progress to resume later if interrupted
 */
function saveProgress(processedIds, totalCount, successCount, errorCount) {
    try {
        const progress = {
            processedIds,
            totalCount,
            successCount,
            errorCount,
            lastSaved: new Date().toISOString()
        };
        writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
        logMessage(`💾 Progress saved: ${processedIds.length}/${totalCount} processed`);
    } catch (error) {
        logMessage(`⚠️ Warning: Could not save progress: ${error.message}`);
    }
}

/**
 * Load previous progress if available
 */
function loadProgress() {
    try {
        if (existsSync(PROGRESS_FILE)) {
            const progress = JSON.parse(readFileSync(PROGRESS_FILE, 'utf8'));
            logMessage(`📂 Found previous progress: ${progress.processedIds.length}/${progress.totalCount} processed`);
            logMessage(`   Last saved: ${progress.lastSaved}`);
            return progress;
        }
    } catch (error) {
        logMessage(`⚠️ Warning: Could not load progress: ${error.message}`);
    }
    return null;
}

/**
 * Clear progress file after successful completion
 */
function clearProgress() {
    try {
        if (existsSync(PROGRESS_FILE)) {
            writeFileSync(PROGRESS_FILE, '{}');
            logMessage(`🗑️ Progress file cleared`);
        }
    } catch (error) {
        logMessage(`⚠️ Warning: Could not clear progress: ${error.message}`);
    }
}

// --- Email extraction patterns ---
const EMAIL_REGEX = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

/**
 * Extract and categorize emails from text
 */
function extractEmails(text = '') {
    if (!text) return [];
    
    const emails = [];
    let match;
    
    while ((match = EMAIL_REGEX.exec(text)) !== null) {
        const email = match[0].toLowerCase();
        const type = categorizeEmail(email, text);
        emails.push({ address: email, type });
    }
    
    return emails;
}

/**
 * Categorize email based on local part and context
 */
function categorizeEmail(email, context = '') {
    const local = email.split('@')[0].toLowerCase();
    const contextLower = context.toLowerCase();
    
    // Check local part patterns
    if (local.startsWith('booking') || local.includes('booking')) return 'booking';
    if (local.startsWith('press') || local.includes('press')) return 'press';
    if (local.startsWith('management') || local.includes('mgmt') || local.includes('manager')) return 'management';
    if (local.startsWith('contact') || local === 'info' || local === 'hello') return 'contact';
    if (local.includes('ar') || local.includes('a&r')) return 'ar';
    if (local.includes('radio')) return 'radio';
    if (local.includes('distribution') || local.includes('distro')) return 'distribution';
    if (local.includes('touring') || local.includes('tour')) return 'touring';
    if (local.includes('label')) return 'label';
    if (local.includes('publisher') || local.includes('publishing')) return 'publisher';
    
    // Check context for keywords
    if (contextLower.includes('booking') && contextLower.indexOf('booking') < contextLower.indexOf(email)) return 'booking';
    if (contextLower.includes('press') && contextLower.indexOf('press') < contextLower.indexOf(email)) return 'press';
    if (contextLower.includes('management') && contextLower.indexOf('management') < contextLower.indexOf(email)) return 'management';
    
    return 'general';
}

/**
 * Fetch SoundCloud user's web profiles (social media links)
 */
async function fetchSoundCloudWebProfiles(soundCloudId, accessToken) {
    try {
        const response = await withApiRetry(async () => {
            // Use OAuth Bearer token authentication (required since SoundCloud security updates)
            return await fetch(`https://api.soundcloud.com/users/${soundCloudId}/web-profiles`, {
                headers: {
                    'Authorization': `Bearer ${accessToken}`
                }
            });
        }, {
            maxRetries: 3,
            initialDelay: 2000, // Start with 2s delay for SoundCloud
            maxDelay: 30000
        });
        
        if (response.ok) {
            const data = await response.json();
            logMessage(`   ✅ SoundCloud web-profiles fetch successful (${data.length} profiles found)`);
            return data || [];
        } else {
            const errorText = await response.text();
            logMessage(`⚠️ SoundCloud web-profiles not accessible for user ${soundCloudId}: ${response.status} ${response.statusText}`);
            logMessage(`   Error details: ${errorText}`);
            return [];
        }
    } catch (error) {
        logMessage(`❌ Error fetching SoundCloud web profiles for ${soundCloudId}: ${error.message}`);
        return [];
    }
}

/**
 * Search MusicBrainz for artist by SoundCloud URL
 */
async function searchMusicBrainzBySoundCloud(soundCloudUrl) {
    try {
        // URL encode the SoundCloud URL for the search
        const encodedUrl = encodeURIComponent(soundCloudUrl);
        const searchUrl = `https://musicbrainz.org/ws/2/url?query=url:"${encodedUrl}"&fmt=json&inc=artist-rels`;
        
        const response = await withApiRetry(async () => {
            return await fetch(searchUrl, {
                headers: {
                    'User-Agent': 'SwayApp/1.0 (contact@sway-app.com)'
                }
            });
        }, {
            maxRetries: 3,
            initialDelay: 1500, // MusicBrainz rate limiting
            maxDelay: 15000
        });
        
        if (!response.ok) {
            logMessage(`⚠️ MusicBrainz search error ${response.status} for URL ${soundCloudUrl}`);
            return null;
        }
        
        const data = await response.json();
        
        // Find the first artist relation
        if (data.urls && data.urls.length > 0) {
            const urlEntry = data.urls[0];
            if (urlEntry.relations) {
                const artistRelation = urlEntry.relations.find(rel => rel.type === 'social network' || rel.type === 'streaming music');
                if (artistRelation && artistRelation.artist) {
                    return artistRelation.artist.id;
                }
            }
        }
        
        return null;
    } catch (error) {
        logMessage(`❌ Error searching MusicBrainz for ${soundCloudUrl}: ${error.message}`);
        return null;
    }
}

/**
 * Search MusicBrainz for artist by name (fallback)
 */
async function searchMusicBrainzByName(artistName) {
    try {
        const encodedName = encodeURIComponent(artistName);
        const searchUrl = `https://musicbrainz.org/ws/2/artist?query=artist:"${encodedName}"&fmt=json&limit=1`;
        
        const response = await withApiRetry(async () => {
            return await fetch(searchUrl, {
                headers: {
                    'User-Agent': 'SwayApp/1.0 (contact@sway-app.com)'
                }
            });
        }, {
            maxRetries: 3,
            initialDelay: 1500, // MusicBrainz rate limiting
            maxDelay: 15000
        });
        
        if (!response.ok) {
            logMessage(`⚠️ MusicBrainz name search error ${response.status} for ${artistName}`);
            return null;
        }
        
        const data = await response.json();
        
        if (data.artists && data.artists.length > 0) {
            return data.artists[0].id;
        }
        
        return null;
    } catch (error) {
        logMessage(`❌ Error searching MusicBrainz by name for ${artistName}: ${error.message}`);
        return null;
    }
}

/**
 * Fetch MusicBrainz artist external links
 */
async function fetchMusicBrainzLinks(artistId) {
    try {
        const url = `https://musicbrainz.org/ws/2/artist/${artistId}?inc=url-rels&fmt=json`;
        
        const response = await withApiRetry(async () => {
            return await fetch(url, {
                headers: {
                    'User-Agent': 'SwayApp/1.0 (contact@sway-app.com)'
                }
            });
        }, {
            maxRetries: 3,
            initialDelay: 1500, // MusicBrainz rate limiting
            maxDelay: 15000
        });
        
        if (!response.ok) {
            logMessage(`⚠️ MusicBrainz artist fetch error ${response.status} for ${artistId}`);
            return [];
        }
        
        const data = await response.json();
        return data.relations || [];
    } catch (error) {
        logMessage(`❌ Error fetching MusicBrainz links for ${artistId}: ${error.message}`);
        return [];
    }
}

/**
 * Normalize platform name and URL to standard format
 */
function normalizePlatformLink(url) {
    try {
        const urlObj = new URL(url);
        const hostname = urlObj.hostname.toLowerCase().replace('www.', '');
        
        // Map hostnames to our standard platform names
        const platformMap = {
            'open.spotify.com': 'spotify',
            'soundcloud.com': 'soundcloud',
            'youtube.com': 'youtube',
            'youtu.be': 'youtube', 
            'music.apple.com': 'apple_music',
            'deezer.com': 'deezer',
            'bandcamp.com': 'bandcamp',
            'tidal.com': 'tidal',
            'instagram.com': 'instagram',
            'tiktok.com': 'tiktok',
            'facebook.com': 'facebook',
            'twitter.com': 'twitter',
            'x.com': 'twitter',
            'wikipedia.org': 'wikipedia'
        };
        
        // Check if hostname matches or is subdomain
        const detectedPlatform = Object.keys(platformMap).find(domain => 
            hostname === domain || hostname.endsWith('.' + domain)
        );
        
        if (detectedPlatform) {
            return {
                platform: platformMap[detectedPlatform],
                link: url
            };
        }
        
        return null;
    } catch (error) {
        return null;
    }
}

/**
 * Process SoundCloud web profiles into standard format
 */
function processSoundCloudWebProfiles(webProfiles) {
    const links = [];
    
    for (const profile of webProfiles) {
        if (profile.url) {
            const normalized = normalizePlatformLink(profile.url);
            if (normalized && SUPPORTED_PLATFORMS[normalized.platform]) {
                links.push(normalized);
            }
        }
    }
    
    return links;
}

/**
 * Process MusicBrainz relationships into standard format
 */
function processMusicBrainzRelations(relations) {
    const links = [];
    
    for (const relation of relations) {
        if (relation.url && relation.url.resource) {
            const normalized = normalizePlatformLink(relation.url.resource);
            if (normalized && SUPPORTED_PLATFORMS[normalized.platform]) {
                links.push(normalized);
            }
        }
    }
    
    return links;
}

/**
 * Safely merge new external links with existing ones
 */
function mergeExternalLinks(existingLinks, newLinks, emails) {
    const merged = { ...existingLinks };
    
    // Add new platform links
    for (const link of newLinks) {
        if (link.platform && SUPPORTED_PLATFORMS[link.platform]) {
            const platformKey = SUPPORTED_PLATFORMS[link.platform];
            
            // Only add if platform doesn't already exist
            if (!merged[platformKey]) {
                merged[platformKey] = { link: link.link };
            }
        }
    }
    
    // Add emails
    if (emails.length > 0) {
        merged.email = emails;
    }
    
    return merged;
}

/**
 * Enrich a single artist with external links and emails
 */
async function enrichArtist(artist, accessToken) {
    logMessage(`🎵 Processing artist: "${artist.name}" (ID: ${artist.id})`);
    
    const allLinks = [];
    const emails = extractEmails(artist.description);
    
    // 1. Fetch SoundCloud web profiles if SoundCloud link exists
    if (artist.external_links && artist.external_links.soundcloud) {
        const soundCloudId = artist.external_links.soundcloud.id;
        if (soundCloudId) {
            logMessage(`   🔍 Fetching SoundCloud web profiles for ID: ${soundCloudId}`);
            const webProfiles = await fetchSoundCloudWebProfiles(soundCloudId, accessToken);
            const scLinks = processSoundCloudWebProfiles(webProfiles);
            allLinks.push(...scLinks);
            logMessage(`   📱 Found ${scLinks.length} social media links from SoundCloud`);
            
            // Note: Rate limiting and retry logic handled by withApiRetry in the function
        }
        
        // 2. Search MusicBrainz by SoundCloud URL
        const soundCloudUrl = artist.external_links.soundcloud.link;
        if (soundCloudUrl) {
            logMessage(`   🔍 Searching MusicBrainz for SoundCloud URL: ${soundCloudUrl}`);
            let mbArtistId = await searchMusicBrainzBySoundCloud(soundCloudUrl);
            
            // Fallback to name search
            if (!mbArtistId) {
                logMessage(`   🔍 Fallback: Searching MusicBrainz by name: "${artist.name}"`);
                mbArtistId = await searchMusicBrainzByName(artist.name);
            }
            
            if (mbArtistId) {
                logMessage(`   ✅ Found MusicBrainz artist: ${mbArtistId}`);
                const relations = await fetchMusicBrainzLinks(mbArtistId);
                const mbLinks = processMusicBrainzRelations(relations);
                allLinks.push(...mbLinks);
                logMessage(`   🎵 Found ${mbLinks.length} platform links from MusicBrainz`);
            } else {
                logMessage(`   ❌ No MusicBrainz match found for "${artist.name}"`);
            }
            
            // Note: Rate limiting and retry logic handled by withApiRetry in the functions
        }
    }
    
    // 3. Merge with existing data
    const existingLinks = artist.external_links || {};
    const mergedLinks = mergeExternalLinks(existingLinks, allLinks, emails);
    
    // 4. Update database if not dry run
    if (!DRY_RUN) {
        const { error } = await supabase
            .from('artists')
            .update({ external_links: mergedLinks })
            .eq('id', artist.id);
            
        if (error) {
            logMessage(`❌ Error updating artist ${artist.id}: ${error.message}`);
            return false;
        }
    }
    
    // 5. Log summary
    const newPlatforms = Object.keys(mergedLinks).filter(key => 
        key !== 'email' && !existingLinks[key]
    ).length;
    const emailCount = emails.length;
    
    logMessage(`   ✅ Added ${newPlatforms} new platform(s), ${emailCount} email(s) for "${artist.name}"`);
    
    if (DRY_RUN) {
        logMessage(`   [DRY_RUN] Would update external_links: ${JSON.stringify(mergedLinks, null, 2)}`);
    }
    
    return true;
}

/**
 * Parse CLI arguments
 */
function parseArgs() {
    const args = process.argv.slice(2);
    const options = {
        dryRun: DRY_RUN,
        artistId: null,
        batchSize: null // Unlimited by default - process ALL artists
    };
    
    for (const arg of args) {
        if (arg.startsWith('--artist-id=')) {
            options.artistId = parseInt(arg.split('=')[1]);
        } else if (arg.startsWith('--batch-size=')) {
            options.batchSize = parseInt(arg.split('=')[1]);
        }
    }
    
    return options;
}

/**
 * Main execution function
 */
async function main() {
    const options = parseArgs();
    
    logMessage(`=== Starting Artist Data Enrichment${options.dryRun ? ' (DRY_RUN MODE)' : ''} ===`);
    logMessage(`Batch size: ${options.batchSize ? options.batchSize : 'UNLIMITED (all artists)'}`);
    
    try {
        // Get SoundCloud access token
        const accessToken = await getAccessToken(SOUND_CLOUD_CLIENT_ID, SOUND_CLOUD_CLIENT_SECRET);
        if (!accessToken) {
            throw new Error('Failed to obtain SoundCloud access token');
        }
        
        // Handle unlimited processing with pagination (Supabase limit is 1000 per query)
        let allSoundCloudArtists = [];
        
        if (options.artistId) {
            // Single artist query
            const { data: artists, error } = await supabase
                .from('artists')
                .select('id, name, description, external_links')
                .eq('id', options.artistId)
                .not('external_links', 'is', null);
                
            if (error) {
                throw new Error(`Database error: ${error.message}`);
            }
            
            if (artists && artists.length > 0) {
                const soundCloudArtists = artists.filter(artist => 
                    artist.external_links && artist.external_links.soundcloud
                );
                allSoundCloudArtists = soundCloudArtists;
            }
            logMessage(`Targeting specific artist ID: ${options.artistId}`);
        } else if (options.batchSize) {
            // Limited batch processing
            const { data: artists, error } = await supabase
                .from('artists')
                .select('id, name, description, external_links')
                .not('external_links', 'is', null)
                .limit(options.batchSize);
                
            if (error) {
                throw new Error(`Database error: ${error.message}`);
            }
            
            if (artists && artists.length > 0) {
                const soundCloudArtists = artists.filter(artist => 
                    artist.external_links && artist.external_links.soundcloud
                );
                allSoundCloudArtists = soundCloudArtists;
            }
            logMessage(`Batch size limited to: ${options.batchSize}`);
        } else {
            // Unlimited processing with pagination to bypass Supabase 1000-row limit
            logMessage(`Processing ALL artists (unlimited batch size with automatic pagination)`);
            
            let offset = 0;
            const pageSize = 1000; // Max Supabase page size
            let hasMoreData = true;
            let totalFetched = 0;
            
            while (hasMoreData) {
                logMessage(`Fetching batch ${Math.floor(offset / pageSize) + 1} (rows ${offset + 1}-${offset + pageSize})...`);
                
                const { data: artists, error } = await supabase
                    .from('artists')
                    .select('id, name, description, external_links')
                    .not('external_links', 'is', null)
                    .range(offset, offset + pageSize - 1);
                    
                if (error) {
                    throw new Error(`Database error: ${error.message}`);
                }
                
                if (!artists || artists.length === 0) {
                    hasMoreData = false;
                    break;
                }
                
                totalFetched += artists.length;
                
                // Filter for SoundCloud artists
                const soundCloudArtists = artists.filter(artist => 
                    artist.external_links && artist.external_links.soundcloud
                );
                
                allSoundCloudArtists.push(...soundCloudArtists);
                logMessage(`Found ${soundCloudArtists.length} SoundCloud artists in this batch (${allSoundCloudArtists.length} total so far)`);
                
                // If we got less than pageSize, we've reached the end
                if (artists.length < pageSize) {
                    hasMoreData = false;
                } else {
                    offset += pageSize;
                }
            }
            
            logMessage(`Pagination complete. Fetched ${totalFetched} total artists from database`);
        }
        
        if (allSoundCloudArtists.length === 0) {
            logMessage('No artists found with SoundCloud links');
            return;
        }
        
        logMessage(`Found ${allSoundCloudArtists.length} artist(s) with SoundCloud links to process`);
        
        // Check for previous progress
        const previousProgress = loadProgress();
        let processedIds = [];
        let successCount = 0;
        let errorCount = 0;
        let startIndex = 0;
        
        if (previousProgress && !options.artistId) {
            // Resume from where we left off (unless targeting specific artist)
            processedIds = previousProgress.processedIds || [];
            successCount = previousProgress.successCount || 0;
            errorCount = previousProgress.errorCount || 0;
            
            // Find where to restart
            startIndex = allSoundCloudArtists.findIndex(artist => 
                !processedIds.includes(artist.id)
            );
            
            if (startIndex === -1) {
                logMessage('✅ All artists already processed according to progress file');
                clearProgress();
                return;
            }
            
            logMessage(`🔄 Resuming from artist ${startIndex + 1}/${allSoundCloudArtists.length}`);
            logMessage(`   Previous stats: ${successCount} successful, ${errorCount} errors`);
        }
        
        // Process each artist starting from the resume point
        for (let i = startIndex; i < allSoundCloudArtists.length; i++) {
            const artist = allSoundCloudArtists[i];
            
            logMessage(`\n--- Processing ${i + 1}/${allSoundCloudArtists.length} ---`);
            
            try {
                const success = await enrichArtist(artist, accessToken);
                if (success) {
                    successCount++;
                } else {
                    errorCount++;
                }
                processedIds.push(artist.id);
                
                // Save progress every 5 artists or on errors to enable resume
                if ((i - startIndex + 1) % 5 === 0 || errorCount > 0) {
                    saveProgress(processedIds, allSoundCloudArtists.length, successCount, errorCount);
                }
                
            } catch (error) {
                logMessage(`❌ Error processing artist ${artist.id}: ${error.message}`);
                errorCount++;
                processedIds.push(artist.id);
                saveProgress(processedIds, allSoundCloudArtists.length, successCount, errorCount);
            }
            
            // Rate limiting between artists (shorter since APIs now have their own retry)
            if (i < allSoundCloudArtists.length - 1) {
                await delay(1000); // Reduced from 1500ms
            }
        }
        
        // Final summary
        logMessage(`\n=== Enrichment Summary ===`);
        logMessage(`Total processed: ${allSoundCloudArtists.length}`);
        logMessage(`Successful: ${successCount}`);
        logMessage(`Errors: ${errorCount}`);
        logMessage(`Success rate: ${((successCount / allSoundCloudArtists.length) * 100).toFixed(1)}%`);
        
        if (options.dryRun) {
            logMessage('\n⚠️  DRY_RUN mode - no data was actually updated in the database');
        }
        
        // Clear progress file on successful completion
        if (processedIds.length === allSoundCloudArtists.length) {
            clearProgress();
            logMessage('✅ All artists processed successfully - progress file cleared');
        }
        
        logMessage('=== Enrichment Complete ===');
        
    } catch (error) {
        logMessage(`💥 Fatal error: ${error.message}`);
        process.exit(1);
    }
}

// Auto-execute if called from CLI
if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('enrich_artist_data.js')) {
    main();
}
