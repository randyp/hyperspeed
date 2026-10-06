const fs = require('fs');

console.log('Starting RAW joystick test...');
console.log('Device: /dev/input/js0');
console.log('Move sticks and press buttons on your Turnigy 9X');
console.log('Press Ctrl+C to exit\n');

const device = fs.createReadStream('/dev/input/js0');
let eventCount = 0;

device.on('data', (buffer) => {
    // Parse joystick event structure (8 bytes per event)
    for (let i = 0; i + 8 <= buffer.length; i += 8) {
        const time = buffer.readUInt32LE(i);
        const value = buffer.readInt16LE(i + 4);
        const type = buffer.readUInt8(i + 6);
        const number = buffer.readUInt8(i + 7);

        // Filter out INIT events (type & 0x80)
        const isInit = (type & 0x80) !== 0;
        const eventType = type & 0x7F;

        eventCount++;

        if (eventType === 1) {
            // Button event
            console.log(`[${eventCount}] BUTTON ${number}: ${value ? 'PRESSED' : 'RELEASED'} ${isInit ? '(INIT)' : ''}`);
        } else if (eventType === 2) {
            // Axis event
            const percent = (value / 32767 * 100).toFixed(1);
            console.log(`[${eventCount}] AXIS ${number}: ${value} (${percent}%) ${isInit ? '(INIT)' : ''}`);
        }
    }
});

device.on('error', (err) => {
    console.error('Error reading joystick:', err);
    process.exit(1);
});

console.log('Listening for RAW joystick events...\n');
