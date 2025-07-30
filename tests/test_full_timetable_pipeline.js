#!/usr/bin/env node
// Test script pour la pipeline complète Clashfinder → CSV → JSON
// Usage: node test_full_pipeline.js "nom du festival"

import { getClashfinderTimetable } from '../get_data/get_clashfinder_timetable.js';
import { extractEventsFromCsv } from '../extract_events_timetable.js';

async function testFullPipeline(festivalName) {
    console.log(`🎵 === Test Pipeline Complète ===`);
    console.log(`🔍 Festival recherché: "${festivalName}"`);
    console.log('');

    try {
        // Étape 1: Récupérer le CSV depuis Clashfinder
        console.log(`📥 Étape 1: Récupération du CSV depuis Clashfinder...`);
        const clashfinderResult = await getClashfinderTimetable(festivalName, {
            saveFile: true,
            outputDir: '.',
            silent: false
        });
        
        console.log(`✅ Festival trouvé: ${clashfinderResult.festival.name}`);
        console.log(`📄 Fichier CSV: ${clashfinderResult.filename}`);
        console.log(`🌐 Lien Clashfinder: ${clashfinderResult.clashfinderUrl}`);
        console.log('');

        // Étape 2: Extraire les événements du CSV
        console.log(`🔄 Étape 2: Extraction des événements...`);
        const outputJsonPath = `extracted_${clashfinderResult.festival.id}_events.json`;
        const events = extractEventsFromCsv(clashfinderResult.filename, outputJsonPath);
        
        console.log(`✅ Extraction terminée: ${events.length} événements extraits`);
        console.log(`💾 Fichier JSON: ${outputJsonPath}`);
        console.log('');

        // Étape 3: Afficher un résumé
        console.log(`📊 === Résumé ===`);
        console.log(`Festival: ${clashfinderResult.festival.name} (${clashfinderResult.festival.id})`);
        console.log(`Événements totaux: ${events.length}`);
        
        // Compter les différents modes de performance
        const modes = {};
        const stages = new Set();
        events.forEach(event => {
            const mode = event.performance_mode || 'solo';
            modes[mode] = (modes[mode] || 0) + 1;
            stages.add(event.stage);
        });
        
        console.log(`Scènes: ${stages.size} (${Array.from(stages).join(', ')})`);
        console.log(`Modes de performance:`);
        Object.entries(modes).forEach(([mode, count]) => {
            console.log(`  - ${mode || 'solo'}: ${count}`);
        });
        
        // Exemples d'événements
        console.log('');
        console.log(`🎤 Quelques exemples d'événements:`);
        events.slice(0, 3).forEach((event, i) => {
            const mode = event.performance_mode ? ` (${event.performance_mode})` : '';
            const custom = event.custom_name ? ` [${event.custom_name}]` : '';
            console.log(`  ${i + 1}. ${event.name}${mode}${custom} - ${event.stage} @ ${event.time}`);
        });

        return {
            festival: clashfinderResult.festival,
            csvFile: clashfinderResult.filename,
            jsonFile: outputJsonPath,
            events: events,
            clashfinderUrl: clashfinderResult.clashfinderUrl
        };

    } catch (error) {
        console.error(`❌ Erreur dans la pipeline: ${error.message}`);
        throw error;
    }
}

// CLI usage
async function main() {
    const festivalName = process.argv[2];
    if (!festivalName) {
        console.error('Usage: node test_full_pipeline.js "nom du festival"');
        console.error('Exemple: node test_full_pipeline.js "Dour Festival"');
        process.exit(1);
    }

    try {
        const result = await testFullPipeline(festivalName);
        console.log('');
        console.log(`🎉 Pipeline terminée avec succès !`);
        console.log(`📁 Fichiers générés:`);
        console.log(`   - CSV: ${result.csvFile}`);
        console.log(`   - JSON: ${result.jsonFile}`);
    } catch (error) {
        console.error(`💥 Échec de la pipeline: ${error.message}`);
        process.exit(1);
    }
}

// Export pour utilisation comme module
export { testFullPipeline };

// Run main if called directly
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1].endsWith('test_full_pipeline.js')) {
    main();
}
