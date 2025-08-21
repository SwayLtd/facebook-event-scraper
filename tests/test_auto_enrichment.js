#!/usr/bin/env node

/**
 * test_auto_enrichment.js
 * 
 * Simple test script to verify that automatic artist enrichment works
 * during the import process.
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import artistModel from '../models/artist.js';
import { getAccessToken } from '../utils/token.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SOUND_CLOUD_CLIENT_ID = process.env.SOUND_CLOUD_CLIENT_ID;
const SOUND_CLOUD_CLIENT_SECRET = process.env.SOUND_CLOUD_CLIENT_SECRET;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function testAutoEnrichment() {
    console.log('🧪 Testing automatic artist enrichment...\n');
    
    try {
        // Get SoundCloud access token
        const accessToken = await getAccessToken(SOUND_CLOUD_CLIENT_ID, SOUND_CLOUD_CLIENT_SECRET);
        
        // Test with a real artist
        const testArtistName = "Solomun";
        
        console.log(`🔍 Searching SoundCloud for: "${testArtistName}"`);
        
        // Search on SoundCloud
        const scArtist = await artistModel.searchArtist(testArtistName, accessToken);
        
        if (scArtist) {
            console.log(`✅ Found SoundCloud artist: ${scArtist.username}`);
            console.log(`   Profile: ${scArtist.permalink_url}`);
            console.log(`   Followers: ${scArtist.followers_count}`);
            
            // Extract artist info (this should trigger auto-enrichment)
            console.log('\n🎵 Extracting artist info with auto-enrichment...');
            const artistInfo = await artistModel.extractArtistInfo(scArtist);
            
            console.log(`\n📊 Extracted data for "${artistInfo.name}":`);
            console.log(`   Image: ${artistInfo.image_url || 'None'}`);
            console.log(`   Description length: ${artistInfo.description?.length || 0} chars`);
            
            console.log(`\n🔗 External links found:`);
            const links = artistInfo.external_links;
            for (const [platform, data] of Object.entries(links)) {
                if (platform === 'email') {
                    console.log(`   📧 ${platform}: ${data.length} email(s)`);
                    data.forEach((email, i) => {
                        console.log(`      ${i + 1}. ${email.address} (${email.type})`);
                    });
                } else {
                    console.log(`   🎵 ${platform}: ${data.link || data}`);
                }
            }
            
            console.log('\n✅ Auto-enrichment test completed successfully!');
            
        } else {
            console.log(`❌ No SoundCloud match found for "${testArtistName}"`);
        }
        
    } catch (error) {
        console.error(`❌ Test failed: ${error.message}`);
        throw error;
    }
}

// Run the test
testAutoEnrichment().catch(console.error);
