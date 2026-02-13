/**
 * Test script: scrape og:image from Facebook promoter pages
 * Downloads up to 10 images locally to verify quality
 * 
 * Usage: node scripts/test-promoter-images.js
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, 'promoter-images-test');

// 10 well-known promoter pages to test
const TEST_URLS = [
    'https://www.facebook.com/acidelics',
    'https://www.facebook.com/allianceclub.party',
    'https://www.facebook.com/clubvaag',
    'https://www.facebook.com/fusebrussels',
    'https://www.facebook.com/kompassklub',
    'https://www.facebook.com/raverebels',
    'https://www.facebook.com/verknipt',
    'https://www.facebook.com/Modulairclub',
    'https://www.facebook.com/COMPLEXECAPTAIN',
    'https://www.facebook.com/unfacedmusic',
];

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

/**
 * Scrape og:image from a Facebook page, trying multiple URL variants
 */
async function scrapePromoterImage(facebookUrl) {
    if (!facebookUrl) return null;

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

            // Extract og:image
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
                    return { imageUrl, source: 'og:image', variant: url };
                }
            }

            // Fallback: look for profile picture patterns
            const imgMatch = html.match(/profpic[^"]*"[^"]*src="([^"]+)"/i)
                || html.match(/<img[^>]+class="[^"]*profilePhoto[^"]*"[^>]+src="([^"]+)"/i);

            if (imgMatch && imgMatch[1]) {
                const imgUrl = imgMatch[1].replace(/&amp;/g, '&');
                console.log(`   ℹ️  ${url} → Found profile image (not og:image)`);
                return { imageUrl: imgUrl, source: 'profileImg', variant: url };
            }

            console.log(`   ⚠️  ${url} → No og:image in ${html.length} chars`);
        } catch (error) {
            console.log(`   ⚠️  ${url} → ${error.message}`);
        }
    }

    return { error: 'All URL variants failed' };
}

/**
 * Download an image to disk
 */
async function downloadImage(imageUrl, filename) {
    try {
        const response = await fetch(imageUrl, {
            headers: { 'User-Agent': HEADERS['User-Agent'] },
        });

        if (!response.ok) {
            return { success: false, error: `HTTP ${response.status}` };
        }

        const contentType = response.headers.get('content-type') || '';
        const ext = contentType.includes('png') ? '.png'
            : contentType.includes('webp') ? '.webp'
                : '.jpg';

        const buffer = Buffer.from(await response.arrayBuffer());
        const filePath = path.join(OUTPUT_DIR, `${filename}${ext}`);
        fs.writeFileSync(filePath, buffer);

        const sizeKB = (buffer.length / 1024).toFixed(1);
        return { success: true, filePath: path.basename(filePath), sizeKB, contentType };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// Main
async function main() {
    console.log('=== Promoter Image Quality Test ===\n');

    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    const results = [];

    for (const url of TEST_URLS) {
        const pageName = url.split('/').filter(Boolean).pop();
        console.log(`\n📄 ${pageName} (${url})`);

        const scrapeResult = await scrapePromoterImage(url);

        if (scrapeResult.error) {
            console.log(`   ❌ Scrape failed: ${scrapeResult.error}`);
            results.push({ page: pageName, status: 'FAILED', error: scrapeResult.error });
            continue;
        }

        console.log(`   ✅ ${scrapeResult.source} via ${scrapeResult.variant}`);
        console.log(`      ${scrapeResult.imageUrl.substring(0, 100)}...`);

        const dlResult = await downloadImage(scrapeResult.imageUrl, pageName);

        if (!dlResult.success) {
            console.log(`   ❌ Download failed: ${dlResult.error}`);
            results.push({ page: pageName, status: 'DL_FAILED', error: dlResult.error });
            continue;
        }

        console.log(`   📦 ${dlResult.sizeKB} KB (${dlResult.contentType}) → ${dlResult.filePath}`);
        results.push({ page: pageName, status: 'OK', sizeKB: dlResult.sizeKB });

        // Delay between requests
        await new Promise(r => setTimeout(r, 1500));
    }

    // Summary
    console.log('\n\n=== SUMMARY ===');
    console.log('─'.repeat(60));

    const ok = results.filter(r => r.status === 'OK');
    const failed = results.filter(r => r.status !== 'OK');

    for (const r of results) {
        const icon = r.status === 'OK' ? '✅' : '❌';
        const detail = r.status === 'OK' ? `${r.sizeKB} KB` : r.error;
        console.log(`${icon} ${r.page.padEnd(25)} ${detail}`);
    }

    console.log('─'.repeat(60));
    console.log(`✅ ${ok.length}/${results.length} success`);
    if (failed.length > 0) console.log(`❌ ${failed.length}/${results.length} failed`);

    if (ok.length > 0) {
        console.log(`\n📁 Images saved to: ${OUTPUT_DIR}`);
    }
}

main().catch(console.error);
