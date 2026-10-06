const Joystick = require('joystick');

console.log('Starting joystick test...');
console.log('Device: /dev/input/js0');
console.log('Move sticks and press buttons on your Turnigy 9X');
console.log('Press Ctrl+C to exit\n');

const joystick = new Joystick(0, 3500, 350); // device, deadzone, precision

let axisValues = {};

joystick.on('axis', (data) => {
    axisValues[data.number] = data.value;
    console.log(`AXIS ${data.number}: ${data.value} (${data.init ? 'INIT' : 'UPDATE'})`);
    console.log('Current state:', axisValues);
    console.log('---');
});

joystick.on('button', (data) => {
    console.log(`BUTTON ${data.number}: ${data.value ? 'PRESSED' : 'RELEASED'}`);
    console.log('---');
});

// Keep the process running
setInterval(() => {
    // Do nothing, just keep alive
}, 1000);

console.log('Listening for joystick events...\n');
