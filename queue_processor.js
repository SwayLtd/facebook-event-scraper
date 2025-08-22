#!/usr/bin/env node

/**
 * Queue Processor pour les imports Facebook Events
 * 
 * Ce script écoute les notifications PostgreSQL et déclenche import_event.js
 * automatiquement quand de nouveaux événements sont ajoutés à la queue.
 * 
 * Usage:
 *   node queue_processor.js
 *   node queue_processor.js --poll-interval 5000  # Polling toutes les 5s au lieu de LISTEN/NOTIFY
 * 
 * Variables d'environnement requises:
 *   - SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY
 *   - Toutes les variables requises par import_event.js
 */

import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

// Load environment variables
dotenv.config();

// Configuration
const POLL_INTERVAL = parseInt(process.argv.includes('--poll-interval') ? 
  process.argv[process.argv.indexOf('--poll-interval') + 1] : '10000'); // 10 secondes par défaut

const MAX_CONCURRENT_IMPORTS = 3; // Nombre maximum d'imports simultanés
const RETRY_DELAY = 30000; // 30 secondes avant de réessayer un événement échoué

// Variables globales
let currentImports = 0;
let isShuttingDown = false;
let activeProcesses = new Set();

// Initialisation Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
    console.error('❌ SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont requis');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey);

// Logging avec timestamps
function logMessage(message, level = 'INFO') {
    const timestamp = new Date().toISOString();
    const prefix = level === 'ERROR' ? '❌' : level === 'SUCCESS' ? '✅' : level === 'WARN' ? '⚠️' : 'ℹ️';
    console.log(`${prefix} [${timestamp}] ${message}`);
}

// Fonction pour obtenir et traiter le prochain événement en attente
async function processNextEvent() {
    if (currentImports >= MAX_CONCURRENT_IMPORTS) {
        return; // Attendre qu'une place se libère
    }

    try {
        // Appeler la fonction PostgreSQL pour obtenir le prochain événement
        const { data, error } = await supabase.rpc('get_next_pending_event');
        
        if (error) {
            logMessage(`Erreur lors de la récupération du prochain événement: ${error.message}`, 'ERROR');
            return;
        }

        if (!data || data.length === 0) {
            // Aucun événement en attente
            return;
        }

        const event = data[0];
        logMessage(`📥 Traitement de l'événement ID ${event.id}: ${event.facebook_url}`);
        
        // Lancer l'import
        await processEvent(event);

    } catch (err) {
        logMessage(`Erreur inattendue lors du traitement: ${err.message}`, 'ERROR');
    }
}

// Fonction pour traiter un événement spécifique
async function processEvent(event) {
    currentImports++;
    const startTime = Date.now();

    return new Promise((resolve) => {
        // Arguments pour import_event.js
        const args = [
            'import_event.js',
            event.facebook_url
        ];

        logMessage(`🚀 Démarrage de l'import pour ${event.facebook_url} (ID: ${event.id})`);
        
        // Spawner le processus import_event.js
        const importProcess = spawn('node', args, {
            stdio: ['pipe', 'pipe', 'pipe'],
            env: { ...process.env }
        });

        activeProcesses.add(importProcess);
        
        let stdout = '';
        let stderr = '';

        importProcess.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        importProcess.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        importProcess.on('close', async (code) => {
            activeProcesses.delete(importProcess);
            currentImports--;
            
            const endTime = Date.now();
            const processingTime = Math.round((endTime - startTime) / 1000);

            if (code === 0) {
                // Succès - extraire l'event_id depuis stdout si possible
                let eventId = null;
                let artistsCount = 0;

                // Parser la sortie pour extraire des infos utiles
                const eventIdMatch = stdout.match(/Event ID: (\\d+)/);
                if (eventIdMatch) {
                    eventId = parseInt(eventIdMatch[1]);
                }

                const artistsMatch = stdout.match(/(\\d+) artists? imported/i);
                if (artistsMatch) {
                    artistsCount = parseInt(artistsMatch[1]);
                }

                // Marquer comme terminé
                try {
                    await supabase.rpc('mark_event_completed', {
                        event_id: event.id,
                        imported_event_id: eventId,
                        artists_count: artistsCount,
                        processing_time: processingTime
                    });

                    logMessage(`✅ Import terminé avec succès pour ${event.facebook_url} (${processingTime}s, ${artistsCount} artistes)`, 'SUCCESS');
                } catch (err) {
                    logMessage(`Erreur lors de la mise à jour du status: ${err.message}`, 'ERROR');
                }

            } else {
                // Échec - marquer comme failed
                let errorMessage = `Exit code: ${code}`;
                
                if (stderr) {
                    errorMessage += ` - ${stderr.slice(-200)}`; // Garder les 200 derniers caractères de stderr
                }

                try {
                    await supabase.rpc('mark_event_failed', {
                        event_id: event.id,
                        error_message: errorMessage,
                        error_details: {
                            exit_code: code,
                            processing_time: processingTime,
                            stderr: stderr.slice(-500), // Garder plus de détails
                            stdout: stdout.slice(-500)
                        }
                    });

                    logMessage(`❌ Import échoué pour ${event.facebook_url}: ${errorMessage}`, 'ERROR');
                    
                    // Programmer une nouvelle tentative si on n'a pas atteint la limite
                    if (event.retry_count < 5) {
                        setTimeout(() => {
                            logMessage(`🔄 Tentative de nouveau traitement pour ${event.facebook_url} dans ${RETRY_DELAY/1000}s`);
                            processNextEvent();
                        }, RETRY_DELAY);
                    }

                } catch (err) {
                    logMessage(`Erreur lors de la mise à jour du status d'échec: ${err.message}`, 'ERROR');
                }
            }

            resolve();
        });

        importProcess.on('error', async (err) => {
            activeProcesses.delete(importProcess);
            currentImports--;
            
            logMessage(`Erreur lors du lancement du processus: ${err.message}`, 'ERROR');
            
            try {
                await supabase.rpc('mark_event_failed', {
                    event_id: event.id,
                    error_message: `Process error: ${err.message}`,
                    error_details: { error: err.message }
                });
            } catch (updateErr) {
                logMessage(`Erreur lors de la mise à jour: ${updateErr.message}`, 'ERROR');
            }

            resolve();
        });
    });
}

// Fonction de polling (alternative à LISTEN/NOTIFY)
async function pollForEvents() {
    if (isShuttingDown) return;
    
    try {
        // Traiter plusieurs événements en parallèle si possible
        const promises = [];
        for (let i = 0; i < MAX_CONCURRENT_IMPORTS - currentImports; i++) {
            promises.push(processNextEvent());
        }
        
        if (promises.length > 0) {
            await Promise.all(promises);
        }
    } catch (err) {
        logMessage(`Erreur lors du polling: ${err.message}`, 'ERROR');
    }

    // Programmer le prochain polling
    setTimeout(pollForEvents, POLL_INTERVAL);
}

// Fonction de nettoyage avant arrêt
async function shutdown() {
    if (isShuttingDown) return;
    isShuttingDown = true;
    
    logMessage('🛑 Arrêt du processeur de queue...');
    
    // Attendre la fin des imports en cours
    if (activeProcesses.size > 0) {
        logMessage(`⏳ Attente de la fin de ${activeProcesses.size} imports en cours...`);
        
        // Tuer proprement les processus actifs après un délai
        setTimeout(() => {
            for (const proc of activeProcesses) {
                if (!proc.killed) {
                    proc.kill('SIGTERM');
                }
            }
        }, 30000); // 30 secondes de grâce
    }
    
    process.exit(0);
}

// Gestionnaires de signaux
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Démarrage du processeur
async function startProcessor() {
    logMessage('🚀 Démarrage du processeur de queue Facebook Events');
    logMessage(`⚙️ Configuration:`);
    logMessage(`   - Imports simultanés maximum: ${MAX_CONCURRENT_IMPORTS}`);
    logMessage(`   - Intervalle de polling: ${POLL_INTERVAL}ms`);
    logMessage(`   - Délai avant retry: ${RETRY_DELAY}ms`);

    // Vérifier que import_event.js existe
    const importScriptPath = path.join(process.cwd(), 'import_event.js');
    if (!fs.existsSync(importScriptPath)) {
        logMessage(`❌ Le fichier import_event.js n'existe pas dans ${process.cwd()}`, 'ERROR');
        process.exit(1);
    }

    // Traitement initial de la queue
    logMessage('🔍 Vérification de la queue existante...');
    await processNextEvent();

    // Démarrer le polling
    logMessage('👀 Démarrage du polling de la queue...');
    pollForEvents();
    
    logMessage('✅ Processeur de queue démarré avec succès');
}

// Point d'entrée
startProcessor().catch((err) => {
    logMessage(`❌ Erreur fatale lors du démarrage: ${err.message}`, 'ERROR');
    process.exit(1);
});
