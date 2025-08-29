#!/usr/bin/env node

/**
 * Test Runner pour valider la migration process-event
 * Vérifie que la migration directe s'est bien passée
 */

import { promises as fs } from 'fs';
import path from 'path';

const PROJECT_ROOT = process.cwd();
const SUPABASE_FUNCTIONS = path.join(PROJECT_ROOT, 'supabase', 'functions');

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function getFileSize(filePath) {
  try {
    const stats = await fs.stat(filePath);
    return {
      bytes: stats.size,
      lines: (await fs.readFile(filePath, 'utf8')).split('\n').length
    };
  } catch {
    return null;
  }
}

async function checkFileContent(filePath, searchString) {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return content.includes(searchString);
  } catch {
    return false;
  }
}

console.log('🎯 Migration Process Event Test Runner');
console.log('==================================================');

let totalTests = 0;
let passedTests = 0;

async function runTests() {
// Test 1: Architecture _shared/ 
console.log('\n📁 Test 1: _shared/ Architecture');
totalTests++;
const sharedPath = path.join(SUPABASE_FUNCTIONS, '_shared');

const sharedFiles = [
  'models/artist.ts',
  'models/event.ts', 
  'models/promoter.ts',
  'models/venue.ts',
  'models/timetable.ts',
  'utils/database.ts',
  'utils/logger.ts',
  'utils/retry.ts',
  'utils/constants.ts'
];

let sharedOk = true;
for (const file of sharedFiles) {
  const filePath = path.join(sharedPath, file);
  const exists = await fileExists(filePath);
  console.log(exists ? `✅ ${file} found` : `❌ ${file} missing`);
  if (!exists) sharedOk = false;
}

if (sharedOk) {
  console.log('✅ Shared Architecture: PASSED');
  passedTests++;
} else {
  console.log('❌ Shared Architecture: FAILED');
}
console.log('--------------------------------------------------');

// Test 2: Migration réussie
console.log('\n🔄 Test 2: Migration Status');
totalTests++;
const processEventPath = path.join(SUPABASE_FUNCTIONS, 'process-event', 'index.ts');
const enhancedProcessEventPath = path.join(SUPABASE_FUNCTIONS, 'enhanced-process-event', 'index.ts');
const backupPath = path.join(SUPABASE_FUNCTIONS, 'process-event', 'index.ts.backup');

const processEventExists = await fileExists(processEventPath);
const enhancedExists = await fileExists(enhancedProcessEventPath);
const backupExists = await fileExists(backupPath);

console.log(processEventExists ? '✅ process-event/index.ts exists' : '❌ process-event/index.ts missing');
console.log(!enhancedExists ? '✅ enhanced-process-event removed' : '❌ enhanced-process-event still exists');
console.log(backupExists ? '✅ backup created' : '❌ backup missing');

const migrationSuccess = processEventExists && !enhancedExists && backupExists;
if (migrationSuccess) {
  console.log('✅ Migration Status: PASSED');
  passedTests++;
} else {
  console.log('❌ Migration Status: FAILED');
}
console.log('--------------------------------------------------');

// Test 3: Nouveau process-event utilise _shared/
console.log('\n🔗 Test 3: _shared/ Integration');
totalTests++;
const hasSharedImports = await checkFileContent(processEventPath, "from '../_shared/utils/logger.ts'");
const hasStructuredLogging = await checkFileContent(processEventPath, 'logger.info');
const noConsoleLog = !(await checkFileContent(processEventPath, 'console.log'));

console.log(hasSharedImports ? '✅ _shared/ imports found' : '❌ _shared/ imports missing');
console.log(hasStructuredLogging ? '✅ structured logging found' : '❌ structured logging missing');
console.log(noConsoleLog ? '✅ no console.log found' : '❌ console.log still present');

const integrationSuccess = hasSharedImports && hasStructuredLogging;
if (integrationSuccess) {
  console.log('✅ _shared/ Integration: PASSED');
  passedTests++;
} else {
  console.log('❌ _shared/ Integration: FAILED');
}
console.log('--------------------------------------------------');

// Test 4: Taille et complexité du nouveau process-event
console.log('\n📊 Test 4: File Analysis');
totalTests++;
const processEventStats = await getFileSize(processEventPath);
const artistStats = await getFileSize(path.join(sharedPath, 'models', 'artist.ts'));

if (processEventStats) {
  console.log(`✅ process-event: ${processEventStats.lines} lines, ${Math.round(processEventStats.bytes/1024)}KB`);
} else {
  console.log('❌ process-event stats unavailable');
}

if (artistStats) {
  console.log(`✅ artist.ts: ${artistStats.lines} lines, ${Math.round(artistStats.bytes/1024)}KB`);
} else {
  console.log('❌ artist.ts stats unavailable');
}

const fileAnalysisSuccess = processEventStats && processEventStats.lines > 300;
if (fileAnalysisSuccess) {
  console.log('✅ File Analysis: PASSED');
  passedTests++;
} else {
  console.log('❌ File Analysis: FAILED');
}
console.log('--------------------------------------------------');

// Test 5: Validation fonctionnelle
console.log('\n⚡ Test 5: Functional Validation');
totalTests++;
const hasEventProcessing = await checkFileContent(processEventPath, 'processSimpleEventArtists');
const hasErrorHandling = await checkFileContent(processEventPath, 'try {');
const hasCorsHeaders = await checkFileContent(processEventPath, 'corsHeaders');

console.log(hasEventProcessing ? '✅ event processing logic found' : '❌ event processing logic missing');
console.log(hasErrorHandling ? '✅ error handling found' : '❌ error handling missing');
console.log(hasCorsHeaders ? '✅ CORS headers found' : '❌ CORS headers missing');

const functionalSuccess = hasEventProcessing && hasErrorHandling && hasCorsHeaders;
if (functionalSuccess) {
  console.log('✅ Functional Validation: PASSED');
  passedTests++;
} else {
  console.log('❌ Functional Validation: FAILED');
}
console.log('--------------------------------------------------');

// Résultats finaux
console.log(`\n📊 Final Results: ${passedTests}/${totalTests} tests passed`);

if (passedTests === totalTests) {
  console.log('\n🎉 Migration completed successfully! All tests passed.');
  process.exit(0);
} else {
  console.log(`\n⚠️ ${totalTests - passedTests} test(s) failed. Please review the migration.`);
  process.exit(1);
}
}

// Run the tests
runTests();
