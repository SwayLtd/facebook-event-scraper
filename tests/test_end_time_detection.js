/**
 * Test the auto-detection of event end time from timetable data
 */
import fs from 'fs';
import timetableModule from '../models/timetable.js';

async function testEndTimeDetection() {
    console.log('🧪 Testing event end time auto-detection...');

    try {
        // Load real Dour 2025 data
        const jsonData = JSON.parse(fs.readFileSync('./imports/dour2025/true_dour2025.json', 'utf8'));

        const options = {
            logMessage: (msg) => console.log(`[TEST] ${msg}`)
        };

        console.log(`📊 Test data loaded: ${jsonData.length} performances`);
        console.log(`📊 Sample performances:`);
        jsonData.slice(0, 3).forEach(perf => {
            console.log(`  - ${perf.name}: ${perf.time} → ${perf.end_time} (${perf.stage})`);
        });

        // Test the detection function
        console.log('\n🔍 Testing end time detection...');
        const detectedEndTime = timetableModule.detectEventEndTimeFromTimetable(jsonData, options);

        if (detectedEndTime) {
            const endDate = new Date(detectedEndTime);
            console.log(`✅ Detected event end time: ${endDate.toLocaleString()}`);
            console.log(`✅ ISO format: ${detectedEndTime}`);

            // Validate that it's actually the latest time in the dataset
            let manualLatest = null;
            for (const perf of jsonData) {
                if (perf.end_time) {
                    const perfEnd = new Date(perf.end_time);
                    if (!manualLatest || perfEnd > manualLatest) {
                        manualLatest = perfEnd;
                    }
                }
            }

            if (manualLatest) {
                const detectedDate = new Date(detectedEndTime);
                if (Math.abs(detectedDate.getTime() - manualLatest.getTime()) < 1000) {
                    console.log(`✅ Validation: Detected time matches manual calculation`);
                } else {
                    console.log(`❌ Validation failed: Expected ${manualLatest.toISOString()}, got ${detectedEndTime}`);
                }
            }

        } else {
            console.log(`❌ No end time detected`);
        }

        // Test edge cases
        console.log('\n🧪 Testing edge cases...');

        // Empty data
        const emptyResult = timetableModule.detectEventEndTimeFromTimetable([], options);
        console.log(`Empty data test: ${emptyResult === null ? '✅ Correctly returned null' : '❌ Should return null'}`);

        // Data without end_time (should estimate)
        const noEndTimeData = [
            { name: 'Test Artist', time: '2025-07-16T20:00', stage: 'Main' }
        ];
        const estimatedResult = timetableModule.detectEventEndTimeFromTimetable(noEndTimeData, options);
        if (estimatedResult) {
            const estimated = new Date(estimatedResult);
            const expected = new Date('2025-07-16T21:00'); // +1 hour
            console.log(`Estimation test: ${Math.abs(estimated.getTime() - expected.getTime()) < 1000 ? '✅ Correctly estimated +1 hour' : '❌ Estimation failed'}`);
        }

        console.log('🎉 End time detection test completed!');

    } catch (error) {
        console.error('❌ Test failed:', error);
        console.error('Stack trace:', error.stack);
    }
}

// Run the test
testEndTimeDetection().then(() => {
    console.log('Test finished');
    process.exit(0);
}).catch(error => {
    console.error('Test crashed:', error);
    process.exit(1);
});
