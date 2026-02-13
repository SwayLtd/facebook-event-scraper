/**
 * Test script: Scrape og:image from Facebook promoter pages
 * and output SQL updates for Supabase
 * 
 * Usage: node scripts/update-promoter-images.js
 */

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Cache-Control': 'max-age=0',
};

// Promoters to update (id → facebook page URL from DB)
const PROMOTERS = [
    { id: 23, name: 'Acidelics', fbUrl: 'https://www.facebook.com/acidelics' },
    { id: 60, name: 'Alliance Club', fbUrl: 'https://www.facebook.com/allianceclub.party' },
    { id: 4, name: 'Club Vaag', fbUrl: 'https://www.facebook.com/clubvaag' },
    { id: 79, name: "COMPLEXE CAP'TAIN", fbUrl: 'https://www.facebook.com/complexecaptain' },
    { id: 59, name: 'Fuse', fbUrl: 'https://www.facebook.com/fusebrussels' },
    { id: 3, name: 'Kompass Klub', fbUrl: 'https://www.facebook.com/kompassklub' },
    { id: 1, name: 'Rave Rebels', fbUrl: 'https://www.facebook.com/raverebelsfestival' },
    { id: 76, name: 'Verknipt', fbUrl: 'https://www.facebook.com/VerkniptEvents' },
];

/**
 * Scrape og:image from a Facebook page (same logic as Edge Function)
 */
async function scrapePromoterImage(facebookUrl) {
    const pagePath = facebookUrl.replace('https://www.facebook.com/', '');
    const urlVariants = [
        facebookUrl,
        `https://mbasic.facebook.com/${pagePath}`,
        `https://m.facebook.com/${pagePath}`,
    ];

    for (const url of urlVariants) {
        try {
            const response = await fetch(url, { headers: HEADERS, redirect: 'follow' });

            if (!response.ok) {
                console.log(`   ⚠️  ${url} → HTTP ${response.status}`);
                continue;
            }

            const html = await response.text();

            const ogImageMatch = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i)
                || html.match(/<meta\s+content="([^"]+)"\s+property="og:image"/i);

            if (ogImageMatch && ogImageMatch[1]) {
                const imageUrl = ogImageMatch[1]
                    .replace(/&amp;/g, '&')
                    .replace(/&lt;/g, '<')
                    .replace(/&gt;/g, '>')
                    .replace(/&quot;/g, '"')
                    .replace(/&#039;/g, "'");

                if (imageUrl.startsWith('http')) {
                    return { imageUrl, variant: url };
                }
            }

            console.log(`   ⚠️  ${url} → No og:image in ${html.length} chars`);
        } catch (error) {
            console.log(`   ⚠️  ${url} → ${error.message}`);
        }
    }

    return null;
}

async function main() {
    console.log('=== Scrape Promoter og:image URLs ===\n');

    const results = [];

    for (const promoter of PROMOTERS) {
        console.log(`\n📄 ${promoter.name} (id=${promoter.id})`);
        console.log(`   FB: ${promoter.fbUrl}`);

        const scrapeResult = await scrapePromoterImage(promoter.fbUrl);

        if (!scrapeResult) {
            console.log(`   ❌ Could not find og:image`);
            results.push({ ...promoter, status: 'FAILED' });
            continue;
        }

        console.log(`   ✅ og:image via ${scrapeResult.variant}`);
        console.log(`   Image: ${scrapeResult.imageUrl.substring(0, 80)}...`);
        results.push({ ...promoter, status: 'OK', imageUrl: scrapeResult.imageUrl });

        await new Promise(r => setTimeout(r, 1500));
    }

    // Summary
    console.log('\n\n=== SUMMARY ===');
    console.log('─'.repeat(50));

    for (const r of results) {
        const icon = r.status === 'OK' ? '✅' : '❌';
        console.log(`${icon} ${r.name.padEnd(22)} (id=${r.id}) ${r.status}`);
    }

    const ok = results.filter(r => r.status === 'OK');
    console.log('─'.repeat(50));
    console.log(`✅ ${ok.length}/${results.length} found`);

    // Output JSON mapping for SQL update
    if (ok.length > 0) {
        console.log('\n=== IMAGE_DATA ===');
        const data = {};
        for (const r of ok) {
            data[r.id] = r.imageUrl;
        }
        console.log(JSON.stringify(data));
        console.log('=== END_IMAGE_DATA ===');
    }
}

main().catch(console.error);
