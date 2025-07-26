// utils/name.js

// Normalize name using exceptions file
function normalizeNameEnhanced(name) {
    if (!name) return '';
    let normalized = name.normalize('NFD');
    normalized = normalized.replace(/[\u0300-\u036f]/g, "");
    normalized = normalized.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
    return normalized;
}

function getNormalizedName(originalName, geocodingExceptions = {}) {
    if (geocodingExceptions[originalName]) {
        return geocodingExceptions[originalName];
    }
    return originalName;
}

export default { normalizeNameEnhanced, getNormalizedName };
