#!/usr/bin/env node

// Script pour standardiser toutes les adresses des venues avec OpenStreetMap
// Utilise la même logique que le système local import_event.js

import { createClient } from '@supabase/supabase-js';
import NodeGeocoder from 'node-geocoder';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
    console.error('❌ Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your environment variables.');
    process.exit(1);
}

// Initialize Supabase client
const supabase = createClient(supabaseUrl, serviceKey);

// Initialize Geocoder (same as local system)
const geocoder = NodeGeocoder({
    provider: 'openstreetmap',
    httpAdapter: 'https',
    formatter: null
});

const DRY_RUN = process.argv.includes('--dry-run');

async function standardizeVenueAddresses() {
    try {
        console.log('🔄 Fetching all venues from database...');
        
        // Get all venues that have location data
        const { data: venues, error } = await supabase
            .from('venues')
            .select('id, name, location')
            .not('location', 'is', null);
            
        if (error) throw error;
        
        console.log(`📍 Found ${venues.length} venues with location data`);
        
        let processedCount = 0;
        let updatedCount = 0;
        let errorCount = 0;
        
        for (const venue of venues) {
            processedCount++;
            console.log(`\n[${processedCount}/${venues.length}] Processing: ${venue.name} (ID: ${venue.id})`);
            console.log(`  Current address: "${venue.location}"`);
            
            try {
                // Use NodeGeocoder with OpenStreetMap (same as local system)
                const geoResults = await geocoder.geocode(venue.location);
                
                if (geoResults && geoResults.length > 0) {
                    const g = geoResults[0];
                    
                    // Handle special case for Belgium (same logic as local system)
                    let country = g.country;
                    if (country === 'België / Belgique / Belgien') {
                        country = 'Belgium';
                    }
                    
                    // Build standardized address (same logic as local system)
                    const standardizedAddress = [
                        g.streetNumber,
                        g.streetName, 
                        g.city,
                        g.zipcode,
                        country
                    ].filter(Boolean).join(', ');
                    
                    console.log(`  Standardized: "${standardizedAddress}"`);
                    
                    // Check if address actually changed
                    if (standardizedAddress !== venue.location && standardizedAddress.length > 0) {
                        console.log(`  ✅ Address will be updated`);
                        
                        if (!DRY_RUN) {
                            const { error: updateError } = await supabase
                                .from('venues')
                                .update({ location: standardizedAddress })
                                .eq('id', venue.id);
                                
                            if (updateError) throw updateError;
                            
                            console.log(`  💾 Address updated in database`);
                        } else {
                            console.log(`  [DRY_RUN] Would update address`);
                        }
                        
                        updatedCount++;
                    } else {
                        console.log(`  ⏭️ Address already standardized or empty result`);
                    }
                } else {
                    console.log(`  ⚠️ No geocoding results found`);
                }
                
                // Small delay to avoid overwhelming the API
                await new Promise(resolve => setTimeout(resolve, 1000));
                
            } catch (err) {
                console.error(`  ❌ Error processing venue ${venue.id}:`, err.message);
                errorCount++;
            }
        }
        
        console.log('\n🎉 ============================================');
        console.log('🎉 ADDRESS STANDARDIZATION COMPLETED');
        console.log('🎉 ============================================');
        console.log(`📊 Total venues processed: ${processedCount}`);
        console.log(`✅ Addresses updated: ${updatedCount}`);
        console.log(`❌ Errors encountered: ${errorCount}`);
        console.log(`🏃 Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE UPDATE'}`);
        console.log('🎉 ============================================\n');
        
    } catch (error) {
        console.error('❌ Script failed:', error);
        process.exit(1);
    }
}

// Run the script
console.log('🚀 Starting venue address standardization...');
console.log(`🏃 Mode: ${DRY_RUN ? 'DRY RUN (no database changes)' : 'LIVE UPDATE'}`);
console.log('📝 Using OpenStreetMap geocoding (same as local import_event.js)');

if (DRY_RUN) {
    console.log('ℹ️  To apply changes, run without --dry-run flag');
}

// Use async IIFE
(async () => {
    try {
        await standardizeVenueAddresses();
    } catch (error) {
        console.error('❌ Script execution failed:', error);
        process.exit(1);
    }
})();
