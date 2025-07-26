// utils/artist.js
// Utility functions for artists

async function getBestImageUrl(avatarUrl) {
    if (!avatarUrl) return null;
    if (!avatarUrl.includes('-large')) return avatarUrl;
    const t500Url = avatarUrl.replace('-large', '-t500x500');
    let retryCount = 0;
    while (retryCount < 3) {
        try {
            // We could fetch to check if the image exists
            // But here, we simply return the modified URL
            return t500Url;
        } catch (error) {
            retryCount++;
        }
    }
    return avatarUrl;
}

export default { getBestImageUrl };
