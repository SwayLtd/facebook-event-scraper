// correct_festival_days_metadata.js
// Script pour corriger les festival_days de l'event 322 dans la base Supabase
// Usage : node correct_festival_days_metadata.js imports/true_dour2025.json

import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const EVENT_ID = 322;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Veuillez définir SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY dans les variables d\'environnement.');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function parseISO(dateStr) {
    return new Date(dateStr);
}

function detectFestivalDays(performances) {
    const slots = performances
        .filter(p => p.time && p.end_time)
        .map(p => ({
            start: parseISO(p.time),
            end: parseISO(p.end_time),
            raw: p
        }))
        .sort((a, b) => a.start - b.start);
    if (slots.length === 0) return [];
    const days = [];
    let currentDay = [];
    let lastEnd = null;
    let dayIdx = 1;
    const MAX_GAP_HOURS = 4;
    for (let i = 0; i < slots.length; i++) {
        const slot = slots[i];
        if (lastEnd) {
            const gap = (slot.start - lastEnd) / (1000 * 60 * 60);
            if (gap > MAX_GAP_HOURS) {
                days.push({
                    name: `Day ${dayIdx}`,
                    start: currentDay[0].start,
                    end: currentDay[currentDay.length - 1].end
                });
                dayIdx++;
                currentDay = [];
            }
        }
        currentDay.push(slot);
        lastEnd = slot.end;
    }
    if (currentDay.length > 0) {
        days.push({
            name: `Day ${dayIdx}`,
            start: currentDay[0].start,
            end: currentDay[currentDay.length - 1].end
        });
    }
    return days.map(d => ({
        name: d.name,
        start: d.start.toISOString().slice(0, 16),
        end: d.end.toISOString().slice(0, 16)
    }));
}

async function main() {
    const jsonFile = process.argv[2];
    if (!jsonFile) {
        console.error('Usage: node correct_festival_days_metadata.js path/to/true_dour2025.json');
        process.exit(1);
    }
    const data = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
    const festival_days = detectFestivalDays(data);
    console.log('Nouvelles valeurs festival_days:', festival_days);
    // Récupérer l'event
    const { data: event, error: fetchError } = await supabase
        .from('events')
        .select('id, metadata')
        .eq('id', EVENT_ID)
        .single();
    if (fetchError) {
        console.error('Erreur récupération event:', fetchError.message);
        process.exit(2);
    }
    let metadata = event.metadata || {};
    if (typeof metadata === 'string') {
        try { metadata = JSON.parse(metadata); } catch { metadata = {}; }
    }
    metadata.festival_days = festival_days;
    // Mise à jour
    const { error: updateError } = await supabase
        .from('events')
        .update({ metadata })
        .eq('id', EVENT_ID);
    if (updateError) {
        console.error('Erreur mise à jour:', updateError.message);
        process.exit(3);
    }
    console.log('Mise à jour des festival_days réussie pour event 322.');
}

main();
