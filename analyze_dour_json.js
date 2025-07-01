/**
 * analyze_dour_json.js
 * 
 * Script d'analyse du JSON Dour 2025 pour prévisualiser les données
 * avant l'import principal
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

function analyzeDourJson(jsonFilePath) {
  try {
    console.log("🔍 Analyse du fichier JSON Dour 2025\n");
    
    if (!fs.existsSync(jsonFilePath)) {
      throw new Error(`Fichier JSON non trouvé: ${jsonFilePath}`);
    }
    
    const jsonData = JSON.parse(fs.readFileSync(jsonFilePath, 'utf8'));
    
    console.log(`📊 Statistiques générales:`);
    console.log(`   Total des performances: ${jsonData.length}`);
    
    // Analyser les artistes uniques
    const uniqueArtists = new Set();
    const artistPerformances = {};
    const stages = new Set();
    const performanceModes = new Set();
    
    for (const performance of jsonData) {
      const artistName = performance.name.trim();
      uniqueArtists.add(artistName);
      
      if (!artistPerformances[artistName]) {
        artistPerformances[artistName] = [];
      }
      artistPerformances[artistName].push(performance);
      
      if (performance.stage) {
        stages.add(performance.stage);
      }
      
      if (performance.performance_mode) {
        performanceModes.add(performance.performance_mode);
      }
    }
    
    console.log(`   Artistes uniques: ${uniqueArtists.size}`);
    
    // Analyser les scènes
    console.log(`\n🎪 Scènes (${stages.size}):`);
    Array.from(stages).sort().forEach(stage => {
      const count = jsonData.filter(p => p.stage === stage).length;
      console.log(`   • ${stage}: ${count} performances`);
    });
    
    // Analyser les modes de performance
    if (performanceModes.size > 0) {
      console.log(`\n🎭 Modes de performance:`);
      Array.from(performanceModes).forEach(mode => {
        const count = jsonData.filter(p => p.performance_mode === mode).length;
        console.log(`   • ${mode}: ${count} performances`);
      });
    }
    
    // Analyser les artistes avec plusieurs performances
    const multiplePerformances = Object.entries(artistPerformances)
      .filter(([_, performances]) => performances.length > 1)
      .sort((a, b) => b[1].length - a[1].length);
    
    if (multiplePerformances.length > 0) {
      console.log(`\n🔄 Artistes avec plusieurs performances (${multiplePerformances.length}):`);
      multiplePerformances.slice(0, 10).forEach(([artist, performances]) => {
        console.log(`   • ${artist}: ${performances.length} performances`);
        performances.forEach(p => {
          console.log(`     - ${p.stage} à ${p.time} (${p.end_time})`);
        });
      });
      
      if (multiplePerformances.length > 10) {
        console.log(`   ... et ${multiplePerformances.length - 10} autres`);
      }
    }
    
    // Analyser les créneaux horaires
    const timeSlots = {};
    jsonData.forEach(p => {
      if (p.time) {
        const hour = p.time.split(':')[0];
        timeSlots[hour] = (timeSlots[hour] || 0) + 1;
      }
    });
    
    console.log(`\n⏰ Répartition par heure:`);
    Object.entries(timeSlots)
      .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
      .forEach(([hour, count]) => {
        const bar = '█'.repeat(Math.ceil(count / 2));
        console.log(`   ${hour}h: ${count.toString().padStart(2)} ${bar}`);
      });
    
    // Analyser les liens SoundCloud existants
    const withSoundCloud = jsonData.filter(p => p.soundcloud && p.soundcloud.trim()).length;
    console.log(`\n🎵 Liens SoundCloud:`);
    console.log(`   Déjà renseignés: ${withSoundCloud}/${jsonData.length} (${((withSoundCloud/jsonData.length)*100).toFixed(1)}%)`);
    
    // Exemples d'artistes
    console.log(`\n📝 Échantillon d'artistes:`);
    const sampleArtists = Array.from(uniqueArtists).slice(0, 10);
    sampleArtists.forEach((artist, index) => {
      console.log(`   ${index + 1}. ${artist}`);
    });
    
    if (uniqueArtists.size > 10) {
      console.log(`   ... et ${uniqueArtists.size - 10} autres artistes`);
    }
    
    console.log(`\n✅ Analyse terminée. Le fichier semble valide pour l'import.`);
    
  } catch (error) {
    console.error(`❌ Erreur lors de l'analyse: ${error.message}`);
    process.exit(1);
  }
}

// Main execution
const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);

if (isMainModule) {
  const jsonFilePath = process.argv[2];
  
  if (!jsonFilePath) {
    console.error("Usage: node analyze_dour_json.js <chemin-vers-fichier-json>");
    console.error("Exemple: node analyze_dour_json.js ./true_dour2025.json");
    process.exit(1);
  }
  
  analyzeDourJson(jsonFilePath);
}

export { analyzeDourJson };
