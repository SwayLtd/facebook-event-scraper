// test_festival_days_detection.js
// Script de test pour détecter automatiquement les jours effectifs de festival à partir d'un JSON de performances
// Usage : node test_festival_days_detection.js imports/true_dour2025.json


import fs from 'fs';

function log(msg) {
    console.log(msg);
}

function parseISO(dateStr) {
    // Compatible avec YYYY-MM-DDTHH:mm ou YYYY-MM-DDTHH:mm:ss
    return new Date(dateStr);
}

function detectFestivalDays(performances) {
    // 1. Récupérer tous les horaires de début et de fin
    const slots = performances
        .filter(p => p.time && p.end_time)
        .map(p => ({
            start: parseISO(p.time),
            end: parseISO(p.end_time),
            raw: p
        }))
        .sort((a, b) => a.start - b.start);

    if (slots.length === 0) return [];

    // 2. Grouper en jours effectifs par coupure naturelle
    const days = [];
    let currentDay = [];
    let lastEnd = null;
    let dayIdx = 1;
    const MAX_GAP_HOURS = 4; // Si >4h sans perf, on considère un nouveau jour (ajustable si besoin)

    for (let i = 0; i < slots.length; i++) {
        const slot = slots[i];
        if (lastEnd) {
            const gap = (slot.start - lastEnd) / (1000 * 60 * 60); // en heures
            if (gap > MAX_GAP_HOURS) {
                // Nouvelle journée
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
    // Ajouter le dernier jour
    if (currentDay.length > 0) {
        days.push({
            name: `Day ${dayIdx}`,
            start: currentDay[0].start,
            end: currentDay[currentDay.length - 1].end
        });
    }

    // Formatage ISO court
    return days.map(d => ({
        name: d.name,
        start: d.start.toISOString().slice(0, 16),
        end: d.end.toISOString().slice(0, 16)
    }));
}

function main() {
    const jsonFile = process.argv[2];
    if (!jsonFile) {
        log('Usage: node test_festival_days_detection.js path/to/true_dour2025.json');
        process.exit(1);
    }
    const data = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
    log(`Nombre de performances : ${data.length}`);
    const days = detectFestivalDays(data);
    log('--- Festival Days détectés ---');
    days.forEach(d => {
        log(`${d.name}: ${d.start} → ${d.end}`);
    });
}

main();
