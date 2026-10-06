const { createNoise2D } = require('simplex-noise');
const { ipcRenderer } = require('electron');
const path = require('path');
const PhoneManager = require('./phone-manager');
const PHONE_STATES = PhoneManager.PHONE_STATES;
const SoundSelector = require('./sound-selector');
const Joystick = require('joystick');

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const button = document.getElementById('hyperspeed-button');

// Phone state tracking
let phoneState = PHONE_STATES.IDLE;
let phoneIconBlink = false;
let phoneBlinkInterval = null;

// Space flight sound effect (always playing at low volume)
const spaceFlightSound = new Audio('sounds/space-rocket-flight.mp3');
spaceFlightSound.loop = true;
spaceFlightSound.volume = 0.2;
spaceFlightSound.play().catch(err => console.error('Audio play error:', err));

// Acceleration sound effect
const accelerationSound = new Audio('sounds/spaceship-acceleration.mp3');
accelerationSound.volume = 0.7;

// Track if we're waiting for acceleration sound to finish
let waitingForAcceleration = false;

// Hyperspeed song
let currentSong = null;

// Song selector with play tracking
const songSelector = new SoundSelector(
    path.join(__dirname, 'sounds', 'songs'),
    'hyperspeed song'
);

function getRandomSong() {
    return songSelector.selectSound();
}

function playSong() {
    const songPath = getRandomSong();

    if (!songPath) {
        console.warn('No songs available, turning off hyperspeed');
        if (isHyperspeed) {
            toggleHyperspeed();
        }
        return;
    }

    currentSong = new Audio(songPath);
    currentSong.volume = 1.0;
    currentSong.play().catch(err => console.error('Song play error:', err));

    // Turn off hyperspeed when song ends
    currentSong.addEventListener('ended', () => {
        console.log('Song ended, turning off hyperspeed');
        if (isHyperspeed) {
            toggleHyperspeed();
        }
    });
}

function stopSong() {
    if (currentSong) {
        currentSong.pause();
        currentSong.currentTime = 0;
        currentSong = null;
        console.log('Stopped hyperspeed song');
    }
}

// Listen for phone state changes
ipcRenderer.on('phone-state-changed', (event, data) => {
    phoneState = data.newState;

    // Setup blinking for OUTGOING_RINGING and INCOMING_RINGING states
    if (phoneState === PHONE_STATES.OUTGOING_RINGING || phoneState === PHONE_STATES.INCOMING_RINGING) {
        if (!phoneBlinkInterval) {
            phoneBlinkInterval = setInterval(() => {
                phoneIconBlink = !phoneIconBlink;
            }, 500); // Blink every 500ms
        }
    } else {
        // Stop blinking for other states
        if (phoneBlinkInterval) {
            clearInterval(phoneBlinkInterval);
            phoneBlinkInterval = null;
        }
        phoneIconBlink = false;
    }
});

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

let isHyperspeed = false;
let hyperspeedProgress = 0.0;
let nebulaOpacity = 1.0;
const stars = [];
const numStars = 1500;
const noise2D = createNoise2D();
const HYPERSPEED_RAMP_UP_TIME = 2.0; // seconds (sped up)
const HYPERSPEED_RAMP_DOWN_TIME = 2.0; // seconds
const NORMAL_SPEED = 5;
const MAX_HYPERSPEED = 50;
const STREAK_LENGTH = 10.0; // Multiplier for line length during hyperspeed

// Flight controls - rotate the star field instead of the ship
let pitchVelocity = 0;
let rollVelocity = 0;
const ROTATION_SPEED = 0.002;
const DAMPING = 0.95;
const keys = {};

// Joystick/RC controller state
let joystickAxes = {
    throttle: 0,  // Axis 0
    yaw: 0,       // Axis 1
    pitch: 0,     // Axis 2
    roll: 0       // Axis 3
};

// Initialize joystick
const joystick = new Joystick(0, 3500, 350); // device, deadzone, precision

joystick.on('axis', (data) => {
    // Map axis numbers to flight controls
    // Note: You may need to adjust these mappings based on your controller
    switch(data.number) {
        case 0: joystickAxes.throttle = data.value; break;
        case 1: joystickAxes.yaw = data.value; break;
        case 2: joystickAxes.pitch = data.value; break;
        case 3: joystickAxes.roll = data.value; break;
    }
});

joystick.on('button', (data) => {
    console.log('Button', data.number, data.value ? 'pressed' : 'released');
});

class Nebula {
    constructor() {
        this.x = Math.random() * canvas.width;
        this.y = Math.random() * canvas.height;
        this.z = Math.random() * 500 + 1000;
        this.initialZ = this.z;
        this.scale = Math.random() * 300 + 200;
        this.speed = 0.5;
        this.colors = [
            ['rgba(138, 43, 226, ', 'rgba(75, 0, 130, '],  // purple/indigo
            ['rgba(65, 105, 225, ', 'rgba(25, 25, 112, '], // blue
            ['rgba(219, 112, 147, ', 'rgba(199, 21, 133, '] // pink
        ];
        this.colorPair = this.colors[Math.floor(Math.random() * this.colors.length)];
        this.noiseOffsetX = Math.random() * 1000;
        this.noiseOffsetY = Math.random() * 1000;
    }

    update() {
        const speed = NORMAL_SPEED + (MAX_HYPERSPEED - NORMAL_SPEED) * hyperspeedProgress;

        // Stars move toward us (we move forward)
        this.z -= speed;

        // Apply rotation from controls
        const rotated = rotateStarByControls(this.x, this.y, this.z);
        this.x = rotated.x;
        this.y = rotated.y;
        this.z = rotated.z;

        const distance = Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
        if (distance < 10 || distance > 3000) {
            // Respawn in sphere
            const radius = 2000;
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);
            this.x = radius * Math.sin(phi) * Math.cos(theta);
            this.y = radius * Math.sin(phi) * Math.sin(theta);
            this.z = radius * Math.cos(phi);
            this.initialZ = this.z;
        }
    }

    draw() {
        // Nebulae are already rotated in update(), just use camera view
        const rotated = {
            x: this.x - canvas.width / 2,
            y: this.y - canvas.height / 2,
            z: this.z
        };

        if (rotated.z <= 0) return;

        const screenX = (rotated.x / rotated.z) * canvas.width + canvas.width / 2;
        const screenY = (rotated.y / rotated.z) * canvas.height + canvas.height / 2;
        const apparentScale = this.scale / rotated.z * 1000;

        if (screenX + apparentScale < 0 || screenX - apparentScale > canvas.width ||
            screenY + apparentScale < 0 || screenY - apparentScale > canvas.height) {
            return;
        }

        const resolution = 32;
        const imageData = ctx.createImageData(resolution, resolution);

        for (let py = 0; py < resolution; py++) {
            for (let px = 0; px < resolution; px++) {
                const nx = (px / resolution - 0.5) * 2;
                const ny = (py / resolution - 0.5) * 2;
                const dist = Math.sqrt(nx * nx + ny * ny);

                if (dist > 1) continue;

                const distanceTraveled = (this.initialZ - this.z) * 0.001;
                const noiseValue = noise2D(
                    (px + this.noiseOffsetX) * 0.1 + distanceTraveled,
                    (py + this.noiseOffsetY) * 0.1 + distanceTraveled
                );

                const alpha = Math.max(0, (1 - dist) * (noiseValue + 1) / 2 * 0.6 * nebulaOpacity);

                const idx = (py * resolution + px) * 4;
                const color = alpha > 0.15 ? this.colorPair[0] : this.colorPair[1];
                const rgb = color.match(/\d+/g);

                imageData.data[idx] = parseInt(rgb[0]);
                imageData.data[idx + 1] = parseInt(rgb[1]);
                imageData.data[idx + 2] = parseInt(rgb[2]);
                imageData.data[idx + 3] = alpha * 255;
            }
        }

        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = resolution;
        tempCanvas.height = resolution;
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.putImageData(imageData, 0, 0);

        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        ctx.drawImage(
            tempCanvas,
            screenX - apparentScale,
            screenY - apparentScale,
            apparentScale * 2,
            apparentScale * 2
        );
        ctx.restore();
    }
}

const nebulae = [new Nebula(), new Nebula(), new Nebula()];

class Star {
    constructor() {
        this.reset();
    }

    reset() {
        // Generate stars mostly ahead of the player at varied distances
        const maxRadius = canvas.width * 2;
        const minRadius = 50;
        const radius = minRadius + Math.random() * (maxRadius - minRadius);
        const theta = Math.random() * Math.PI * 2; // horizontal angle

        // Bias phi toward forward (z > 0): forward-biased spread
        const phi = Math.acos(1 - Math.random() * 1.5); // wide forward bias

        this.x = radius * Math.sin(phi) * Math.cos(theta);
        this.y = radius * Math.sin(phi) * Math.sin(theta);
        this.z = Math.abs(radius * Math.cos(phi)); // ensure positive z (ahead)

        this.prevX = this.x;
        this.prevY = this.y;
        this.prevZ = this.z;

        // Random vibrant star colors
        const r = Math.floor(Math.random() * 256);
        const g = Math.floor(Math.random() * 256);
        const b = Math.floor(Math.random() * 256);
        this.color = `rgb(${r}, ${g}, ${b})`;
    }

    update() {
        this.prevX = this.x;
        this.prevY = this.y;
        this.prevZ = this.z;

        const speed = NORMAL_SPEED + (MAX_HYPERSPEED - NORMAL_SPEED) * hyperspeedProgress;

        // Stars move toward us (we move forward)
        this.z -= speed;

        // Apply rotation from controls
        const rotated = rotateStarByControls(this.x, this.y, this.z);
        this.x = rotated.x;
        this.y = rotated.y;
        this.z = rotated.z;

        // Reset if star passes behind us, gets too close, or too far
        if (this.z < 1 || this.z > canvas.width * 3) {
            this.reset();
        }
    }

    draw() {
        // Stars are already rotated in update(), just use camera view
        const rotated = { x: this.x, y: this.y, z: this.z };

        if (rotated.z <= 0) return;

        const sx = (rotated.x / rotated.z) * canvas.width + canvas.width / 2;
        const sy = (rotated.y / rotated.z) * canvas.height + canvas.height / 2;

        if (sx < 0 || sx > canvas.width || sy < 0 || sy > canvas.height) {
            return;
        }

        if (hyperspeedProgress > 0.1) {
            // Previous position is already rotated, just use it
            const prevRotated = { x: this.prevX, y: this.prevY, z: this.prevZ };

            if (prevRotated.z <= 0) return;

            // Calculate the tail position in 3D by extrapolating backwards
            // Vector from prev (tail direction) to current
            const dx = rotated.x - this.prevX;
            const dy = rotated.y - this.prevY;
            const dz = rotated.z - this.prevZ;

            // Extrapolate backwards
            const tailX = rotated.x - dx * STREAK_LENGTH;
            const tailY = rotated.y - dy * STREAK_LENGTH;
            const tailZ = rotated.z - dz * STREAK_LENGTH;

            if (tailZ <= 0) return;

            const startX = (tailX / tailZ) * canvas.width + canvas.width / 2;
            const startY = (tailY / tailZ) * canvas.height + canvas.height / 2;

            const baseSize = (1 - rotated.z / canvas.width) * 2 * hyperspeedProgress;
            const widthMultiplier = 1 + (hyperspeedProgress * 8);
            ctx.lineWidth = Math.max(baseSize * widthMultiplier, 1);
            ctx.strokeStyle = this.color.replace('rgb', 'rgba').replace(')', ', 0.8)');
            ctx.beginPath();
            ctx.moveTo(startX, startY);
            ctx.lineTo(sx, sy);
            ctx.stroke();
        } else {
            const size = (1 - rotated.z / canvas.width) * 5;
            ctx.fillStyle = this.color;
            ctx.beginPath();
            ctx.arc(sx, sy, Math.max(size, 1), 0, Math.PI * 2);
            ctx.fill();
        }
    }
}

for (let i = 0; i < numStars; i++) {
    stars.push(new Star());
}

function toggleHyperspeed() {
    isHyperspeed = !isHyperspeed;
    button.classList.toggle('active');

    // Notify main process about hyperspeed state change
    ipcRenderer.send('hyperspeed-changed', isHyperspeed);

    if (isHyperspeed) {
        // Play acceleration sound and wait for it to finish
        waitingForAcceleration = true;
        accelerationSound.currentTime = 0;
        accelerationSound.play().catch(err => console.error('Acceleration audio play error:', err));
    } else {
        // Turning off - resume rocket sound at normal volume
        spaceFlightSound.volume = 0.2;

        // Cancel acceleration sound if still playing
        if (waitingForAcceleration) {
            accelerationSound.pause();
            accelerationSound.currentTime = 0;
            waitingForAcceleration = false;
        }

        // Stop hyperspeed song
        stopSong();
    }
}

// When acceleration sound finishes, turn off rocket sound and start accelerating
accelerationSound.addEventListener('ended', () => {
    if (isHyperspeed && waitingForAcceleration) {
        spaceFlightSound.volume = 0; // Mute rocket sound during hyperspeed
        waitingForAcceleration = false;
        playSong(); // Start playing random hyperspeed song
    }
});

function updateHyperspeed() {
    // Don't start accelerating until acceleration sound finishes
    if (waitingForAcceleration) {
        return;
    }

    const targetProgress = isHyperspeed ? 1.0 : 0.0;

    if (Math.abs(hyperspeedProgress - targetProgress) > 0.01) {
        if (hyperspeedProgress < targetProgress) {
            const rampUpSpeed = 1.0 / (HYPERSPEED_RAMP_UP_TIME * 60); // 60fps
            hyperspeedProgress = Math.min(1.0, hyperspeedProgress + rampUpSpeed);
        } else {
            const rampDownSpeed = 1.0 / (HYPERSPEED_RAMP_DOWN_TIME * 60); // 60fps
            hyperspeedProgress = Math.max(0.0, hyperspeedProgress - rampDownSpeed);
        }
    } else {
        hyperspeedProgress = targetProgress;
    }
}

function updateNebulaOpacity() {
    const targetOpacity = 1.0;
    const fadeSpeed = 0.05;
    if (Math.abs(nebulaOpacity - targetOpacity) > 0.01) {
        nebulaOpacity += (targetOpacity - nebulaOpacity) * fadeSpeed;
    } else {
        nebulaOpacity = targetOpacity;
    }
}

button.addEventListener('click', toggleHyperspeed);

window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
        e.preventDefault();
        toggleHyperspeed();
    } else if (e.code === 'KeyQ' || e.code === 'Backspace') {
        e.preventDefault();
        // Trigger outbound call
        ipcRenderer.send('trigger-outbound-call');
    }
    keys[e.code] = true;
});

window.addEventListener('keyup', (e) => {
    keys[e.code] = false;
});

function updateFlightControls() {
    // Arrow keys only
    if (keys['ArrowUp']) pitchVelocity += ROTATION_SPEED;
    if (keys['ArrowDown']) pitchVelocity -= ROTATION_SPEED;
    if (keys['ArrowLeft']) rollVelocity += ROTATION_SPEED;
    if (keys['ArrowRight']) rollVelocity -= ROTATION_SPEED;

    // Apply damping
    pitchVelocity *= DAMPING;
    rollVelocity *= DAMPING;
}

function rotateStarByControls(x, y, z) {
    // Apply pitch (rotate around X axis)
    let cosPitch = Math.cos(pitchVelocity);
    let sinPitch = Math.sin(pitchVelocity);
    let yPitch = y * cosPitch - z * sinPitch;
    let zPitch = y * sinPitch + z * cosPitch;

    // Apply roll (rotate around Z axis)
    let cosRoll = Math.cos(rollVelocity);
    let sinRoll = Math.sin(rollVelocity);
    let xRoll = x * cosRoll - yPitch * sinRoll;
    let yRoll = x * sinRoll + yPitch * cosRoll;

    return { x: xRoll, y: yRoll, z: zPitch };
}

function animate() {
    updateHyperspeed();
    updateNebulaOpacity();
    updateFlightControls();

    // Calculate screen shake based on acceleration (most shake during ramp-up)
    const shakeIntensity = isHyperspeed ? (1 - hyperspeedProgress) * 16 : 0;
    const shakeX = (Math.random() - 0.5) * shakeIntensity;
    const shakeY = (Math.random() - 0.5) * shakeIntensity;

    ctx.save();
    ctx.translate(shakeX, shakeY);

    ctx.fillStyle = 'black';
    ctx.fillRect(-20, -20, canvas.width + 40, canvas.height + 40);

    if (nebulaOpacity > 0.01) {
        nebulae.forEach(nebula => {
            nebula.update();
            nebula.draw();
        });
    }

    stars.forEach(star => {
        star.update();
        star.draw();
    });

    // Debug info
    ctx.fillStyle = 'white';
    ctx.font = '14px monospace';
    ctx.fillText(`Joystick - Throttle: ${joystickAxes.throttle}`, 10, 20);
    ctx.fillText(`Joystick - Yaw: ${joystickAxes.yaw}`, 10, 40);
    ctx.fillText(`Joystick - Pitch: ${joystickAxes.pitch}`, 10, 60);
    ctx.fillText(`Joystick - Roll: ${joystickAxes.roll}`, 10, 80);
    ctx.fillText(`Pitch velocity: ${pitchVelocity.toFixed(4)}`, 10, 110);
    ctx.fillText(`Roll velocity: ${rollVelocity.toFixed(4)}`, 10, 130);

    ctx.restore();

    // Draw phone icon based on state
    drawPhoneIcon();

    requestAnimationFrame(animate);
}

function drawPhoneIcon() {
    // Only show icon when not IDLE
    if (phoneState === PHONE_STATES.IDLE ||
        phoneState === PHONE_STATES.OUTGOING_DISCONNECTING ||
        phoneState === PHONE_STATES.INCOMING_DISCONNECTING ||
        phoneState === PHONE_STATES.OUTGOING_TIMEOUT ||
        phoneState === PHONE_STATES.ERROR) {
        return;
    }

    // Blinking for ringing states, solid for others
    const isRinging = phoneState === PHONE_STATES.OUTGOING_RINGING || phoneState === PHONE_STATES.INCOMING_RINGING;
    const shouldShow = !isRinging || phoneIconBlink;

    if (!shouldShow) return;

    // Position in bottom right corner
    const iconSize = 80;
    const x = canvas.width - iconSize - 30;
    const y = canvas.height - iconSize - 30;

    ctx.save();

    // Draw phone icon (simplified handset shape)
    ctx.strokeStyle = '#fff';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 6;

    // Phone handset shape (scaled up)
    ctx.beginPath();
    ctx.arc(x + 20, y + 20, 16, 0, Math.PI * 2);
    ctx.arc(x + 60, y + 60, 16, 0, Math.PI * 2);
    ctx.moveTo(x + 30, y + 24);
    ctx.lineTo(x + 50, y + 56);
    ctx.stroke();

    // Optional: Add a filled circle background for better visibility
    if (phoneState === PHONE_STATES.OUTGOING_CONNECTED ||
        phoneState === PHONE_STATES.OUTGOING_PLAYING_AUDIO ||
        phoneState === PHONE_STATES.INCOMING_CONNECTED ||
        phoneState === PHONE_STATES.INCOMING_PLAYING_AUDIO) {
        ctx.fillStyle = 'rgba(0, 255, 0, 0.3)'; // Green glow when connected
        ctx.beginPath();
        ctx.arc(x + iconSize / 2, y + iconSize / 2, iconSize / 2, 0, Math.PI * 2);
        ctx.fill();
    }

    ctx.restore();
}

window.addEventListener('resize', () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
});

animate();
