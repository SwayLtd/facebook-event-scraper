// utils/social.js
// External link normalization functions

// --- Social Link Normalization Helpers (from updateArtistExternalLinks.js) ---
const URL_REGEX = /\bhttps?:\/\/[^\")\s'<>]+/gi;
const HANDLE_REGEX = /(?:IG:?|Insta:?|Instagram:?|Twitter:?|TW:?|X:?|x:?|FB:?|Facebook:?|SC:?|SoundCloud:?|Wiki:?|Wikipedia:?|BandCamp:?|BC:?|@)([A-Za-z0-9._-]+)/gi;
const VALID_ID = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

function normalizeSocialLink(raw) {
    const r = raw.trim();
    // Full URL
    if (/^https?:\/\//i.test(r)) {
        return r;
    }
    // Raw handle
    const prefixMatch = r.match(/^[A-Za-z]+(?=[:@]?)/);
    const prefix = prefixMatch ? prefixMatch[0].toLowerCase() : '';
    const id = r.replace(/^[A-Za-z]+[:@]?/i, '').trim().toLowerCase();
    if (!VALID_ID.test(id) || id.length < 2) return null;
    if (["instagram", "insta", "ig"].includes(prefix)) return `https://instagram.com/${id}`;
    if (["twitter", "tw", "x"].includes(prefix)) return `https://twitter.com/${id}`;
    if (["facebook", "fb"].includes(prefix)) return `https://facebook.com/${id}`;
    if (["soundcloud", "sc"].includes(prefix)) return `https://soundcloud.com/${id}`;
    if (["bandcamp", "bc"].includes(prefix)) return `https://${id}.bandcamp.com`;
    if (["wikipedia", "wiki"].includes(prefix)) return `https://en.wikipedia.org/wiki/${id}`;
    return null;
}

function normalizeExternalLinks(externalLinksObj) {
    if (!externalLinksObj || typeof externalLinksObj !== 'object') return null;
    const normalized = {};
    for (const [platform, data] of Object.entries(externalLinksObj)) {
        const norm = normalizeSocialLink(data);
        if (norm) normalized[platform] = norm;
    }
    return Object.keys(normalized).length > 0 ? normalized : null;
}

export default { normalizeSocialLink, normalizeExternalLinks };
