/**
 * utils/enrichment.js
 * 
 * Artist enrichment utilities for automatic enhancement of artist data
 * with social media links, music platform links, and contact emails.
 */

import { delay } from './delay.js';
import { logMessage } from './logger.js';

// --- Supported platforms ---
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

// --- Email extraction ---
const EMAIL_REGEX = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

/**
 * Extract and categorize emails from text
 */
export function extractEmails(text = '') {
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
 * Search MusicBrainz for artist by SoundCloud URL
 */
async function searchMusicBrainzBySoundCloud(soundCloudUrl) {
    try {
        const encodedUrl = encodeURIComponent(soundCloudUrl);
        const searchUrl = `https://musicbrainz.org/ws/2/url?query=url:"${encodedUrl}"&fmt=json&inc=artist-rels`;
        
        const response = await fetch(searchUrl, {
            headers: { 'User-Agent': 'SwayApp/1.0 (contact@sway-app.com)' }
        });
        
        if (!response.ok) return null;
        const data = await response.json();
        
        if (data.urls && data.urls.length > 0) {
            const urlEntry = data.urls[0];
            if (urlEntry.relations) {
                const artistRelation = urlEntry.relations.find(rel => 
                    rel.type === 'social network' || rel.type === 'streaming music'
                );
                if (artistRelation && artistRelation.artist) {
                    return artistRelation.artist.id;
                }
            }
        }
        
        return null;
    } catch (error) {
        logMessage(`⚠️ Error searching MusicBrainz for ${soundCloudUrl}: ${error.message}`);
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
        
        const response = await fetch(searchUrl, {
            headers: { 'User-Agent': 'SwayApp/1.0 (contact@sway-app.com)' }
        });
        
        if (!response.ok) return null;
        const data = await response.json();
        
        if (data.artists && data.artists.length > 0) {
            return data.artists[0].id;
        }
        
        return null;
    } catch (error) {
        logMessage(`⚠️ Error searching MusicBrainz by name for ${artistName}: ${error.message}`);
        return null;
    }
}

/**
 * Fetch MusicBrainz artist external links
 */
async function fetchMusicBrainzLinks(artistId) {
    try {
        const url = `https://musicbrainz.org/ws/2/artist/${artistId}?inc=url-rels&fmt=json`;
        
        const response = await fetch(url, {
            headers: { 'User-Agent': 'SwayApp/1.0 (contact@sway-app.com)' }
        });
        
        if (!response.ok) return [];
        const data = await response.json();
        return data.relations || [];
    } catch (error) {
        logMessage(`⚠️ Error fetching MusicBrainz links for ${artistId}: ${error.message}`);
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
export function mergeExternalLinks(existingLinks, newLinks, emails) {
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
 * Enrich artist data with MusicBrainz platforms and email extraction
 * @param {object} artistData - Artist data with name, description, external_links
 * @param {boolean} enableMusicBrainz - Whether to enable MusicBrainz enrichment
 * @param {boolean} enableEmails - Whether to enable email extraction
 * @returns {Promise<object>} Enriched artist data
 */
export async function enrichArtistData(artistData, enableMusicBrainz = true, enableEmails = true) {
    try {
        logMessage(`   🔍 Auto-enriching artist: "${artistData.name}"`);
        
        const allLinks = [];
        const emails = enableEmails ? extractEmails(artistData.description) : [];
        
        // MusicBrainz enrichment if artist has SoundCloud link
        if (enableMusicBrainz && artistData.external_links?.soundcloud?.link) {
            const soundCloudUrl = artistData.external_links.soundcloud.link;
            
            // Search MusicBrainz by SoundCloud URL
            let mbArtistId = await searchMusicBrainzBySoundCloud(soundCloudUrl);
            
            // Fallback to name search
            if (!mbArtistId) {
                mbArtistId = await searchMusicBrainzByName(artistData.name);
            }
            
            if (mbArtistId) {
                logMessage(`   ✅ Found MusicBrainz artist: ${mbArtistId}`);
                const relations = await fetchMusicBrainzLinks(mbArtistId);
                const mbLinks = processMusicBrainzRelations(relations);
                allLinks.push(...mbLinks);
                logMessage(`   🎵 Found ${mbLinks.length} platform links from MusicBrainz`);
            }
            
            // Rate limiting for MusicBrainz
            await delay(1000);
        }
        
        // Merge with existing data
        const existingLinks = artistData.external_links || {};
        const enrichedLinks = mergeExternalLinks(existingLinks, allLinks, emails);
        
        // Count new additions
        const newPlatforms = Object.keys(enrichedLinks).filter(key => 
            key !== 'email' && !existingLinks[key]
        ).length;
        const emailCount = emails.length;
        
        if (newPlatforms > 0 || emailCount > 0) {
            logMessage(`   ✅ Auto-enrichment: +${newPlatforms} platforms, +${emailCount} emails`);
        } else {
            logMessage(`   📝 Auto-enrichment: no new data found`);
        }
        
        return {
            ...artistData,
            external_links: enrichedLinks
        };
        
    } catch (error) {
        logMessage(`   ⚠️ Auto-enrichment failed for "${artistData.name}": ${error.message}`);
        return artistData; // Return original data if enrichment fails
    }
}

export default {
    extractEmails,
    mergeExternalLinks,
    enrichArtistData
};
