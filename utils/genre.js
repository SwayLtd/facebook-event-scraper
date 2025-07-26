// utils/genre.js
// Utility functions for genres

/**
 * refineGenreName
 *
 * This function takes a genre name (as retrieved from Last.fm or another source)
 * and reformats it for more readable display. It first applies word-by-word capitalization,
 * then detects and corrects certain special cases (for example, if the name does not contain spaces and contains
 * the word "techno", it inserts a space before "Techno"). This refinement allows for genre names such as
 * "Hard Techno" instead of "Hardtechno" for better visual clarity and uniformity in the database.
 *
 * @param {string} name - The genre name to refine.
 * @returns {string} - The reformatted genre name for display (e.g., "Hard Techno").
 */
function refineGenreName(name) {
    let refined = name.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
    if (!refined.includes(' ') && /techno/i.test(refined)) {
        refined = refined.replace(/(.*)(Techno)/i, '$1 Techno');
    }
    return refined;
}

/**
 * Splits a compound tag containing known delimiters (" x ", " & ", " + ") into sub-tags.
 * @param {string} tag - The tag to split.
 * @returns {string[]} - Array of sub-tags.
 */
function splitCompoundTags(tag) {
    const delimiters = [" x ", " & ", " + "];
    for (const delim of delimiters) {
        if (tag.includes(delim)) {
            return tag.split(delim).map(t => t.trim());
        }
    }
    return [tag];
}

/**
 * Removes all non-alphanumeric characters to get a condensed version.
 * @param {string} name - The genre name.
 * @returns {string} - The slugified genre name.
 */
function slugifyGenre(name) {
    return name.replace(/\W/g, "").toLowerCase();
}

/**
 * Cleans a description by removing HTML tags, the "Read more on Last.fm" part,
 * and removes a possible " ." at the end of the string.
 * If, after cleaning, the description is too short (less than 30 characters), returns "".
 * @param {string} desc - The description to clean.
 * @returns {string} - The cleaned description or empty string.
 */
function cleanDescription(desc) {
    if (!desc) return "";
    let text = desc.replace(/<[^>]*>/g, '').trim();
    text = text.replace(/read more on last\.fm/gi, '').trim();
    text = text.replace(/\s+\.\s*$/, '');
    return text.length < 30 ? "" : text;
}

export default { refineGenreName, splitCompoundTags, slugifyGenre, cleanDescription };
