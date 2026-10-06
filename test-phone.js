const PhoneManager = require('./phone-manager');
const fs = require('fs');
const path = require('path');

function getRandomAudioFile() {
    const recordingsDir = path.join(__dirname, 'sounds', 'outgoing_calls');
    const files = fs.readdirSync(recordingsDir)
        .filter(f => f.endsWith('.wav'))
        .map(f => path.join(recordingsDir, f));

    if (files.length === 0) {
        console.error('No WAV files found in sounds/outgoing_calls directory');
        process.exit(1);
    }

    const randomFile = files[Math.floor(Math.random() * files.length)];
    return randomFile;
}

async function testCall() {
    const phoneManager = new PhoneManager();

    console.log('Starting phone manager...');
    await phoneManager.start();

    const audioFile = getRandomAudioFile();
    console.log(`Selected audio file: ${path.basename(audioFile)}`);

    console.log('Making test call...');
    phoneManager.makeCall(audioFile);

    // Keep script running for 60 seconds to allow call to complete
    setTimeout(() => {
        console.log('Test complete');
        process.exit(0);
    }, 60000);
}

testCall().catch(error => {
    console.error('Test failed:', error);
    process.exit(1);
});
