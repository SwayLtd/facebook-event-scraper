import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import artistModule from './models/artist.js';
import { getStoredToken } from './utils/token.js';

// Load environment variables
config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

/**
 * Repair missing external_links for artists in the database
 * Searches SoundCloud for artists that don't have external_links and updates them
 */
async function repairMissingExternalLinks(isDryRun = false, limit = null) {
    const startTime = Date.now();
    console.log('🔧 REPAIR MISSING EXTERNAL LINKS - Started');
    console.log('==========================================\n');

    if (isDryRun) {
        console.log('🧪 DRY RUN MODE: No database changes will be made\n');
    }

    try {
        // Get SoundCloud access token using stored token
        console.log('🎵 Getting SoundCloud access token...');
        const accessToken = await getStoredToken('soundcloud');

        if (!accessToken) {
            throw new Error('No SoundCloud access token available');
        }
        console.log('✅ SoundCloud access token obtained\n');

        // Get all artists without external_links
        console.log('📊 Fetching artists without external_links...');
        let query = supabase
            .from('artists')
            .select('id, name, created_at')
            .is('external_links', null)
            .order('created_at', { ascending: false });

        if (limit) {
            query = query.limit(limit);
            console.log(`📋 Limiting to ${limit} artists for testing`);
        }

        const { data: artistsWithoutLinks, error: fetchError } = await query;

        if (fetchError) {
            throw new Error(`Failed to fetch artists: ${fetchError.message}`);
        }

        console.log(`📋 Found ${artistsWithoutLinks.length} artists without external_links\n`);

        if (artistsWithoutLinks.length === 0) {
            console.log('✅ No artists need repair - all have external_links!');
            return;
        }

        // Process artists in batches
        const batchSize = 10;
        let processedCount = 0;
        let foundCount = 0;
        let updatedCount = 0;
        let errorCount = 0;

        console.log(`🔄 Processing artists in batches of ${batchSize}...\n`);

        for (let i = 0; i < artistsWithoutLinks.length; i += batchSize) {
            const batch = artistsWithoutLinks.slice(i, i + batchSize);
            const batchNumber = Math.ceil((i + 1) / batchSize);
            const totalBatches = Math.ceil(artistsWithoutLinks.length / batchSize);

            console.log(`📦 Batch ${batchNumber}/${totalBatches} (${batch.length} artists)`);

            for (const artist of batch) {
                try {
                    processedCount++;
                    console.log(`  🔍 [${processedCount}/${artistsWithoutLinks.length}] Searching: ${artist.name}`);

                    // Search SoundCloud for this artist
                    const scArtist = await artistModule.searchArtist(artist.name, accessToken);

                    if (scArtist) {
                        // Extract SoundCloud info
                        const soundCloudData = await artistModule.extractArtistInfo(scArtist);
                        foundCount++;

                        if (soundCloudData && soundCloudData.external_links) {
                            if (isDryRun) {
                                console.log(`    🧪 DRY RUN: Would update with SoundCloud link: ${soundCloudData.external_links.soundcloud?.link || 'N/A'}`);
                                updatedCount++;
                            } else {
                                // Update the artist with external_links
                                const { error: updateError } = await supabase
                                    .from('artists')
                                    .update({ external_links: soundCloudData.external_links })
                                    .eq('id', artist.id);

                                if (updateError) {
                                    console.log(`    ❌ Failed to update: ${updateError.message}`);
                                    errorCount++;
                                } else {
                                    console.log(`    ✅ Updated with SoundCloud link: ${soundCloudData.external_links.soundcloud?.link || 'N/A'}`);
                                    updatedCount++;
                                }
                            }
                        } else {
                            console.log(`    ⚠️  Found on SoundCloud but no external_links data extracted`);
                        }
                    } else {
                        console.log(`    ❌ Not found on SoundCloud`);
                    }

                    // Rate limiting - wait between requests
                    // await new Promise(resolve => setTimeout(resolve, 1000));

                } catch (error) {
                    console.log(`    💥 Error processing ${artist.name}: ${error.message}`);
                    errorCount++;
                }
            }

            // Longer delay between batches
            if (i + batchSize < artistsWithoutLinks.length) {
                console.log(`    ⏳ Waiting 1 seconds before next batch...\n`);
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }

        // Final statistics
        const endTime = Date.now();
        const duration = ((endTime - startTime) / 1000).toFixed(1);

        console.log('\n🎯 REPAIR COMPLETED');
        console.log('==================');
        console.log(`⏱️  Duration: ${duration}s`);
        console.log(`📊 Artists processed: ${processedCount}`);
        console.log(`🎵 Found on SoundCloud: ${foundCount} (${((foundCount / processedCount) * 100).toFixed(1)}%)`);
        console.log(`✅ Successfully updated: ${updatedCount}`);
        console.log(`❌ Errors: ${errorCount}`);
        console.log(`📈 Success rate: ${((updatedCount / foundCount) * 100).toFixed(1)}%`);

        // Verify the repair by checking updated statistics
        console.log('\n🔍 Verifying repair results...');
        const { data: stats } = await supabase
            .from('artists')
            .select('id, external_links')
            .is('external_links', null);

        const remainingWithoutLinks = stats ? stats.length : 0;
        const totalArtists = artistsWithoutLinks.length + (1875); // Previous with links
        const newCoverage = ((totalArtists - remainingWithoutLinks) / totalArtists * 100).toFixed(2);

        console.log(`📊 Remaining without external_links: ${remainingWithoutLinks}`);
        console.log(`📈 New coverage: ${newCoverage}% (was 76.25%)`);

        if (updatedCount > 0) {
            console.log(`\n🎉 Successfully repaired ${updatedCount} artists with missing external_links!`);
        } else {
            console.log(`\n⚠️  No artists were updated. This might indicate SoundCloud API issues or very uncommon artist names.`);
        }

    } catch (error) {
        console.error('💥 Critical error during repair:', error);
        process.exit(1);
    }
}

// Parse command line arguments
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const limitArg = args.find(arg => arg.startsWith('--limit='));
const limit = limitArg ? parseInt(limitArg.split('=')[1]) : null;

// Run the repair if this script is executed directly
const scriptUrl = new URL(import.meta.url);
const scriptPath = scriptUrl.pathname;
const currentScript = process.argv[1];

console.log('Script detection:', { scriptPath, currentScript, match: scriptPath.endsWith(currentScript.replace(/\\/g, '/')) });

repairMissingExternalLinks(isDryRun, limit)
    .then(() => {
        console.log('\n✅ Repair script completed successfully');
        process.exit(0);
    })
    .catch((error) => {
        console.error('💥 Repair script failed:', error);
        process.exit(1);
    });

export default repairMissingExternalLinks;
