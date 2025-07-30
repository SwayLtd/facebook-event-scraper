import fs from 'fs';
import { parse } from 'csv-parse/sync';

// Regex to detect performance modes inside names (excluding "presents"/"pres" which are handled specially)
const MODE_PATTERN = /\b(B2B|B3B|F2F|VS|meet|feat|ft)\b/i;
// Regex to detect "presents" or "pres" patterns
const PRESENTS_PATTERN = /\s+(presents|pres)\s+/i;
// Regex to strip trailing suffixes A/V or (live)
const SUFFIX_PATTERN = /\s+(A\/V|\(live\))$/i;

function parseDatetime(dtStr) {
    // Convert "YYYY/MM/DD HH:MM" to ISO 8601 "YYYY-MM-DDTHH:MM"
    if (!dtStr || !dtStr.trim()) return '';
    const parts = dtStr.trim().split(' ');
    if (parts.length !== 2) return '';
    const [datePart, timePart] = parts;
    const [yyyy, mm, dd] = datePart.split('/');
    if (!yyyy || !mm || !dd) return '';
    return `${yyyy}-${mm}-${dd}T${timePart}`;
}

function cleanName(name) {
    return name.replace(SUFFIX_PATTERN, '').trim();
}

function detectMode(name) {
    const match = name.match(MODE_PATTERN);
    return match ? match[1] : '';
}

function detectPresents(name) {
    // Detect "presents" or "pres" patterns and return the artist name and mode
    // Returns {artistName, mode, fullName} if found, else null
    const match = name.match(PRESENTS_PATTERN);
    if (match) {
        // Split on the presents pattern and take the first part as artist name
        const parts = name.split(PRESENTS_PATTERN);
        if (parts.length >= 3) { // [artist, separator, rest]
            const artistName = cleanName(parts[0]);
            return {
                artistName,
                mode: 'presents',
                fullName: cleanName(name)
            };
        }
    }
    return null;
}

function loadCsv(filepath) {
    console.log(`[LOG] Reading CSV file: ${filepath}`);
    const raw = fs.readFileSync(filepath, 'utf-8');
    const rawLines = raw.split(/\r?\n/);
    // Find header row (commented or not), ignore all lines before
    let headerIdx = null;
    let headerLine = null;
    for (let idx = 0; idx < rawLines.length; idx++) {
        let line = rawLines[idx].trimStart();
        if (line.startsWith('//')) {
            let uncommented = line.slice(2).trimStart();
            if (
                uncommented.startsWith('Start,') &&
                uncommented.includes('End') &&
                uncommented.includes('Name') &&
                uncommented.includes('Location')
            ) {
                headerIdx = idx;
                headerLine = uncommented;
                break;
            }
        } else if (
            line.startsWith('Start,') &&
            line.includes('End') &&
            line.includes('Name') &&
            line.includes('Location')
        ) {
            headerIdx = idx;
            headerLine = line;
            break;
        }
    }
    if (headerIdx === null) {
        console.error('[ERROR] CSV header row not found.');
        return [];
    }
    console.log(`[LOG] Header detected at line ${headerIdx + 1}`);
    // Compose only the header and data lines, ignore all lines before header and all comment lines after
    const dataLines = [headerLine, ...rawLines.slice(headerIdx + 1)].filter(l => l.trim() !== '' && !l.trimStart().startsWith('//')).join('\n');
    const records = parse(dataLines, {
        columns: true,
        skip_empty_lines: true
    });
    console.log(`[LOG] Parsed ${records.length} rows from CSV.`);
    const validEvents = records
        .map(row => ({
            start: row.Start?.trim() || '',
            end: row.End?.trim() || '',
            name: row.Name?.trim() || '',
            stage: row.Location?.trim() || ''
        }))
        .filter(ev => ev.start && ev.end && ev.name && ev.stage);
    console.log(`[LOG] Found ${validEvents.length} valid events.`);
    return validEvents;
}

function groupEvents(events) {
    console.log(`[LOG] Grouping events by (start, end, stage)`);
    const grouped = {};
    for (const ev of events) {
        const key = `${ev.start}|${ev.end}|${ev.stage}`;
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(ev.name);
    }
    // Split regex for B2B, x, vs, meet, feat, etc. (with spaces)
    // Note: "&" is excluded to keep band names like "Bigflo & Oli" intact
    // Note: "presents"/"pres" is handled separately as a special performance mode
    const splitRegex = /\s+(?:B2B|B3B|F2F|VS|x|vs|meet|w\/|feat|ft)\s+/i;
    const merged = [];
    for (const key in grouped) {
        const [start, end, stage] = key.split('|');
        for (const combinedName of grouped[key]) {
            // Log split for debug
            console.log(`[LOG] Processing slot: ${start} - ${end} @ ${stage} | Name: ${combinedName}`);
            
            // First check for "presents" pattern
            const presentsResult = detectPresents(combinedName);
            if (presentsResult) {
                // Handle "presents" case - keep artist name, set mode to "presents"
                console.log(`[LOG] Split result: ['${presentsResult.artistName}'] (presents mode)`);
                merged.push({
                    name: presentsResult.artistName,
                    time: parseDatetime(start),
                    end_time: parseDatetime(end),
                    stage,
                    performance_mode: presentsResult.mode,
                    custom_name: presentsResult.fullName
                });
            } else if (combinedName.trim().toLowerCase() === 'b2b2b2b2b') {
                const splitArtists = [cleanName(combinedName)];
                console.log(`[LOG] Split result: ${splitArtists}`);
                merged.push({
                    name: splitArtists[0],
                    time: parseDatetime(start),
                    end_time: parseDatetime(end),
                    stage,
                    performance_mode: '',
                });
            } else {
                const splitArtists = combinedName.split(splitRegex).map(cleanName).filter(Boolean);
                console.log(`[LOG] Split result: ${splitArtists}`);
                if (splitArtists.length > 1) {
                    for (const n of splitArtists) {
                        merged.push({
                            name: n,
                            time: parseDatetime(start),
                            end_time: parseDatetime(end),
                            stage,
                            performance_mode: 'B2B',
                            custom_name: cleanName(combinedName)
                        });
                    }
                } else {
                    merged.push({
                        name: cleanName(combinedName),
                        time: parseDatetime(start),
                        end_time: parseDatetime(end),
                        stage,
                        performance_mode: detectMode(combinedName)
                    });
                }
            }
        }
    }
    console.log(`[LOG] Merged events count: ${merged.length}`);
    return merged;
}

function toJson(entries, outputPath = null) {
    console.log(`[LOG] Serializing ${entries.length} entries to JSON.`);
    const outputList = entries.map(e => {
        const entry = {
            artist_id: [],
            name: e.name,
            time: e.time,
            end_time: e.end_time,
            soundcloud: '',
            stage: e.stage,
            performance_mode: e.performance_mode
        };
        if (e.custom_name) entry.custom_name = e.custom_name;
        return entry;
    });
    const jsonData = JSON.stringify(outputList, null, 2);
    if (outputPath) {
        // Create output directory if needed
        const dir = outputPath.split('/').slice(0, -1).join('/');
        if (dir && !fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
            console.log(`[LOG] Created output directory: ${dir}`);
        }
        fs.writeFileSync(outputPath, jsonData, 'utf-8');
        console.log(`[LOG] Saved JSON output to ${outputPath}`);
    } else {
        console.log(jsonData);
    }
}

function main() {
    console.log(`[LOG] === extract_events_timetable.js START ===`);
    console.log(`[LOG] Args:`, process.argv.slice(2));
    const args = process.argv.slice(2);
    if (args.length < 1) {
        console.error('Usage: node extract_events_timetable.js <csv_input> [-o output.json]');
        process.exit(1);
    }
    const csvInput = args[0];
    const outputIdx = args.indexOf('-o');
    const outputPath = outputIdx !== -1 ? args[outputIdx + 1] : null;
    console.log(`[LOG] Starting timetable extraction...`);
    console.log(`[LOG] Args: ${JSON.stringify(process.argv)}`);
    const events = loadCsv(csvInput);
    if (!events.length) {
        console.error('[ERROR] No valid events found. Check CSV formatting.');
        process.exit(1);
    }
    const merged = groupEvents(events);
    merged.sort((a, b) => {
        if (a.time === b.time) return a.stage.localeCompare(b.stage);
        return a.time.localeCompare(b.time);
    });
    toJson(merged, outputPath);
    console.log(`[LOG] Extraction finished.`);
}

// Check if this script is being run directly
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1].endsWith('extract_events_timetable.js')) {
    main();
}
