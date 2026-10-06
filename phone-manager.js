const sip = require('sip');
const dgram = require('dgram');
const fs = require('fs');
const path = require('path');
const wav = require('wav');
const EventEmitter = require('events');
const SoundSelector = require('./sound-selector');

// Configuration
const CONFIG = {
    ATA_IP: '192.168.2.150',
    LOCAL_IP: '192.168.2.2',
    SIP_PORT: 5060,
    RTP_PORT_MIN: 8000,
    RTP_PORT_MAX: 9000,
    CALL_TIMEOUT_MS: 30000
};

// Phone states
const PHONE_STATES = {
    IDLE: 'IDLE',
    OUTGOING_RINGING: 'OUTGOING_RINGING',
    OUTGOING_CONNECTED: 'OUTGOING_CONNECTED',
    OUTGOING_PLAYING_AUDIO: 'OUTGOING_PLAYING_AUDIO',
    OUTGOING_DISCONNECTING: 'OUTGOING_DISCONNECTING',
    OUTGOING_TIMEOUT: 'OUTGOING_TIMEOUT',
    INCOMING_RINGING: 'INCOMING_RINGING',
    INCOMING_CONNECTED: 'INCOMING_CONNECTED',
    INCOMING_PLAYING_AUDIO: 'INCOMING_PLAYING_AUDIO',
    INCOMING_DISCONNECTING: 'INCOMING_DISCONNECTING',
    ERROR: 'ERROR'
};

// G.711 μ-law encoding lookup table
const MULAW_ENCODE_TABLE = [
    0,0,1,1,2,2,2,2,3,3,3,3,3,3,3,3,
    4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,
    5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,
    5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,
    6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,
    6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,
    6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,
    6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,
    7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,
    7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,
    7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,
    7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,
    7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,
    7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,
    7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,
    7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7
];

class PhoneManager extends EventEmitter {
    constructor() {
        super();
        this.ataIP = CONFIG.ATA_IP;
        this.localIP = CONFIG.LOCAL_IP;
        this.sipPort = CONFIG.SIP_PORT;
        this.calling = false;
        this.autoCallingEnabled = false;
        this.autoCallTimeoutId = null;
        this.autoCallIntervalSeconds = 60;
        this.state = PHONE_STATES.IDLE;
        this.callTimeoutId = null;
        this.incomingCall = null; // Track current incoming call context
        this.isHyperspeedActive = false; // Track if hyperspeed is active

        // Sound selectors with play tracking
        this.outgoingSelector = new SoundSelector(
            path.join(__dirname, 'sounds', 'outgoing_calls'),
            'outgoing call audio'
        );
        this.incomingSelector = new SoundSelector(
            path.join(__dirname, 'sounds', 'incoming_calls'),
            'incoming call audio'
        );
    }

    setHyperspeedActive(active) {
        this.isHyperspeedActive = active;
        console.log(`Hyperspeed is now ${active ? 'active' : 'inactive'}`);
    }

    setState(newState) {
        const oldState = this.state;
        this.state = newState;
        console.log(`Phone state: ${oldState} → ${newState}`);
        this.emit('state-changed', { oldState, newState });
    }

    getState() {
        return this.state;
    }

    async start() {
        return new Promise((resolve) => {
            // Create SIP stack
            sip.start({
                port: this.sipPort,
                host: this.localIP,
                publicHost: this.localIP,
                tcp: false,
                udp: true
            }, (request) => {
                // Handle incoming SIP messages
                console.log('===== Received SIP request =====');
                console.log('Method:', request.method);
                console.log('URI:', request.uri);
                console.log('From:', JSON.stringify(request.headers.from));
                console.log('To:', JSON.stringify(request.headers.to));
                console.log('================================');

                if (request.method === 'INVITE') {
                    // Incoming call from phone
                    this.handleIncomingCall(request);
                } else if (request.method === 'BYE') {
                    // Phone hung up
                    console.log('Phone hung up');
                    this.calling = false;
                    this.setState(PHONE_STATES.IDLE);
                    this.emit('call-ended');
                    this.scheduleNextCall();
                } else if (request.method === 'ACK') {
                    // ACK for incoming call
                    if (this.incomingCall) {
                        console.log('Incoming call ACK received');
                    }
                }
            });

            console.log(`SIP server listening on ${this.localIP}:${this.sipPort}`);
            resolve();
        });
    }

    getRandomAudioFile() {
        return this.outgoingSelector.selectSound();
    }

    getRandomIncomingAudioFile() {
        return this.incomingSelector.selectSound();
    }

    startAutoCalling(intervalSeconds = 60) {
        this.autoCallIntervalSeconds = intervalSeconds;
        this.autoCallingEnabled = true;
        console.log(`Starting auto-calling - will call ${intervalSeconds} seconds after each call ends`);

        // Make the first call immediately
        const audioFile = this.getRandomAudioFile();
        this.makeCall(audioFile);
    }

    stopAutoCalling() {
        this.autoCallingEnabled = false;
        if (this.autoCallTimeoutId) {
            clearTimeout(this.autoCallTimeoutId);
            this.autoCallTimeoutId = null;
        }
        console.log('Auto-calling stopped');
    }

    scheduleNextCall() {
        if (!this.autoCallingEnabled) {
            return;
        }

        // Clear any existing scheduled call
        if (this.autoCallTimeoutId) {
            clearTimeout(this.autoCallTimeoutId);
        }

        // Schedule next call after the interval
        this.autoCallTimeoutId = setTimeout(() => {
            if (this.autoCallingEnabled && !this.calling) {
                // Skip if hyperspeed is active, reschedule
                if (this.isHyperspeedActive) {
                    console.log('Skipping outbound call (hyperspeed active), rescheduling...');
                    this.scheduleNextCall();
                    return;
                }

                const audioFile = this.getRandomAudioFile();
                this.makeCall(audioFile);
            }
        }, this.autoCallIntervalSeconds * 1000);

        console.log(`Next call scheduled in ${this.autoCallIntervalSeconds} seconds`);
    }

    clearCallTimeout() {
        if (this.callTimeoutId) {
            clearTimeout(this.callTimeoutId);
            this.callTimeoutId = null;
        }
    }

    handleIncomingCall(request) {
        // Check if this is a single digit dial (0-9)
        const uri = request.uri || '';
        console.log(`Incoming INVITE - URI: ${uri}`);

        const match = uri.match(/sip:([0-9])@/) || uri.match(/sip:([0-9])$/);

        if (!match) {
            console.log('Not a single digit dial, sending busy');
            // Send 486 Busy Here response
            const busy = {
                status: 486,
                reason: 'Busy Here',
                headers: {
                    to: request.headers.to,
                    from: request.headers.from,
                    'call-id': request.headers['call-id'],
                    cseq: request.headers.cseq,
                    via: request.headers.via
                }
            };
            sip.send(busy);
            return;
        }

        const digit = match[1];
        console.log(`Incoming call detected - phone dialed: ${digit}`);

        // Pause auto-calling if in progress
        if (this.autoCallingEnabled && this.autoCallTimeoutId) {
            console.log('Pausing auto-calling for incoming call');
            clearTimeout(this.autoCallTimeoutId);
            this.autoCallTimeoutId = null;
        }

        // Store incoming call context
        this.incomingCall = {
            request: request,
            digit: digit,
            rtpPort: null,
            remoteSDP: null
        };

        this.calling = true;
        this.setState(PHONE_STATES.INCOMING_RINGING);
        this.emit('call-started');

        // Send 180 Ringing
        const ringing = {
            status: 180,
            reason: 'Ringing',
            headers: {
                to: request.headers.to,
                from: request.headers.from,
                'call-id': request.headers['call-id'],
                cseq: request.headers.cseq,
                via: request.headers.via
            }
        };
        sip.send(ringing);

        // Wait 1 second then answer
        setTimeout(() => {
            if (!this.incomingCall) return;

            // Generate RTP port
            const rtpPort = CONFIG.RTP_PORT_MIN + Math.floor(Math.random() * (CONFIG.RTP_PORT_MAX - CONFIG.RTP_PORT_MIN));
            this.incomingCall.rtpPort = rtpPort;

            // Parse remote SDP from INVITE
            const remoteSDP = this.parseSDP(request.content);
            this.incomingCall.remoteSDP = remoteSDP;

            if (!remoteSDP.ip || !remoteSDP.port) {
                console.error('Failed to parse remote SDP from INVITE');
                this.setState(PHONE_STATES.ERROR);
                this.calling = false;
                this.incomingCall = null;
                this.scheduleNextCall();
                return;
            }

            console.log(`Answering incoming call - will play audio to ${remoteSDP.ip}:${remoteSDP.port}`);

            // Send 200 OK
            const ok = {
                status: 200,
                reason: 'OK',
                headers: {
                    to: request.headers.to,
                    from: request.headers.from,
                    'call-id': request.headers['call-id'],
                    cseq: request.headers.cseq,
                    contact: [{ uri: `sip:hyperspeed@${this.localIP}:${this.sipPort}` }],
                    'content-type': 'application/sdp',
                    via: request.headers.via
                },
                content: this.createSDP(rtpPort)
            };
            sip.send(ok);

            this.setState(PHONE_STATES.INCOMING_CONNECTED);
            this.emit('call-answered');

            // Get random audio file and play it
            const audioFile = this.getRandomIncomingAudioFile();
            if (audioFile) {
                this.setState(PHONE_STATES.INCOMING_PLAYING_AUDIO);
                this.playAudio(audioFile, rtpPort, remoteSDP, () => {
                    // After audio finishes, hang up
                    console.log('Audio playback complete, hanging up incoming call...');
                    this.hangupIncomingCall();
                });
            } else {
                // No audio, hang up after 1 second
                setTimeout(() => {
                    this.hangupIncomingCall();
                }, 1000);
            }
        }, 1000);
    }

    hangupIncomingCall() {
        if (!this.incomingCall) return;

        this.setState(PHONE_STATES.INCOMING_DISCONNECTING);

        // Send BYE
        const bye = {
            method: 'BYE',
            uri: this.incomingCall.request.headers.from.uri,
            headers: {
                to: this.incomingCall.request.headers.from,
                from: this.incomingCall.request.headers.to,
                'call-id': this.incomingCall.request.headers['call-id'],
                cseq: { method: 'BYE', seq: 2 },
                via: []
            }
        };

        sip.send(bye, (response) => {
            console.log('Incoming call ended');
            this.calling = false;
            this.incomingCall = null;
            this.setState(PHONE_STATES.IDLE);
            this.emit('call-ended');
            this.scheduleNextCall();
        });
    }

    makeCall(audioFile = null) {
        if (this.calling) {
            console.log('Already in a call, skipping');
            return;
        }

        console.log(`Calling phone at ${this.ataIP}...`);
        if (audioFile) {
            console.log(`Will play audio: ${path.basename(audioFile)}`);
        }
        this.calling = true;

        const callId = `${Date.now()}@${this.localIP}`;
        const fromTag = `tag-${Math.random().toString(36).substr(2, 9)}`;
        const rtpPort = CONFIG.RTP_PORT_MIN + Math.floor(Math.random() * (CONFIG.RTP_PORT_MAX - CONFIG.RTP_PORT_MIN));

        // Create INVITE message
        const request = {
            method: 'INVITE',
            uri: `sip:${this.ataIP}`,
            headers: {
                to: { uri: `sip:${this.ataIP}` },
                from: {
                    uri: `sip:hyperspeed@${this.localIP}`,
                    params: { tag: fromTag }
                },
                'call-id': callId,
                cseq: { method: 'INVITE', seq: 1 },
                contact: [{ uri: `sip:hyperspeed@${this.localIP}:${this.sipPort}` }],
                'content-type': 'application/sdp',
                via: []
            },
            content: this.createSDP(rtpPort)
        };

        // Send INVITE
        this.setState(PHONE_STATES.OUTGOING_RINGING);
        this.emit('call-started');

        sip.send(request, (response) => {
            console.log('===========================================');
            console.log(`SIP Response: ${response.status} ${response.reason}`);
            console.log(`From: ${JSON.stringify(response.headers.from)}`);
            console.log(`To: ${JSON.stringify(response.headers.to)}`);
            console.log(`Call-ID: ${response.headers['call-id']}`);
            console.log(`CSeq: ${JSON.stringify(response.headers.cseq)}`);
            if (response.content) {
                console.log(`SDP Content Length: ${response.content.length} bytes`);
                console.log('SDP Preview:', response.content.substring(0, 200));
            } else {
                console.log('No SDP content in response');
            }
            console.log('===========================================');

            if (response.status === 100 || response.status === 180) {
                // Trying or Ringing - already in OUTGOING_RINGING state
                console.log('Phone is ringing...');
            } else if (response.status === 200) {
                // Phone answered!
                console.log('✓ Phone answered! (200 OK received)');
                this.clearCallTimeout();
                this.setState(PHONE_STATES.OUTGOING_CONNECTED);
                this.emit('call-answered');

                // Send ACK
                console.log('Sending ACK...');
                const ack = {
                    method: 'ACK',
                    uri: request.uri,
                    headers: {
                        to: response.headers.to,
                        from: response.headers.from,
                        'call-id': response.headers['call-id'],
                        cseq: { method: 'ACK', seq: response.headers.cseq.seq },
                        via: []
                    }
                };
                sip.send(ack);
                console.log('✓ ACK sent');

                // Parse remote RTP info from SDP
                console.log('Parsing remote SDP...');
                const remoteSDP = this.parseSDP(response.content);
                console.log(`Parsed SDP - IP: ${remoteSDP.ip}, Port: ${remoteSDP.port}`);

                if (!remoteSDP.ip || !remoteSDP.port) {
                    console.error('Failed to parse remote SDP');
                    this.setState(PHONE_STATES.ERROR);
                    this.calling = false;
                    setTimeout(() => this.setState(PHONE_STATES.IDLE), 1000);
                    return;
                }

                if (audioFile) {
                    // Play audio file
                    console.log(`Starting audio playback: ${path.basename(audioFile)}`);
                    console.log(`RTP: Local port ${rtpPort} → Remote ${remoteSDP.ip}:${remoteSDP.port}`);
                    this.setState(PHONE_STATES.OUTGOING_PLAYING_AUDIO);
                    this.playAudio(audioFile, rtpPort, remoteSDP, () => {
                        // After audio finishes, hang up
                        console.log('✓ Audio playback complete, hanging up...');
                        this.hangup(response);
                    });
                } else {
                    // No audio, hang up after 1 second
                    console.log('No audio file specified, hanging up in 1 second');
                    setTimeout(() => {
                        this.hangup(response);
                    }, 1000);
                }
            } else if (response.status >= 400) {
                // Error
                console.log(`Call failed: ${response.status} ${response.reason}`);
                this.clearCallTimeout();
                this.setState(PHONE_STATES.ERROR);
                this.calling = false;
                setTimeout(() => this.setState(PHONE_STATES.IDLE), 1000);
                this.scheduleNextCall();
            }
        });

        // Timeout after configured time
        this.callTimeoutId = setTimeout(() => {
            if (this.calling && this.state === PHONE_STATES.OUTGOING_RINGING) {
                console.log('Call timeout');
                this.setState(PHONE_STATES.OUTGOING_TIMEOUT);
                this.calling = false;
                setTimeout(() => this.setState(PHONE_STATES.IDLE), 1000);
                this.scheduleNextCall();
            }
        }, CONFIG.CALL_TIMEOUT_MS);
    }

    playAudio(audioFile, localPort, remoteSDP, callback) {
        console.log('===========================================');
        console.log(`Starting RTP audio playback`);
        console.log(`Audio file: ${path.basename(audioFile)}`);
        console.log(`Local RTP port: ${localPort}`);
        console.log(`Remote destination: ${remoteSDP.ip}:${remoteSDP.port}`);
        console.log('===========================================');

        // Create RTP socket
        const rtpSocket = dgram.createSocket('udp4');

        rtpSocket.on('error', (err) => {
            console.error('❌ RTP socket error:', err);
            rtpSocket.close();
            callback();
        });

        rtpSocket.bind(localPort, () => {
            console.log(`✓ RTP socket bound to port ${localPort}`);
        });

        // Read WAV file
        const reader = new wav.Reader();
        const stream = fs.createReadStream(audioFile);

        stream.on('error', (err) => {
            console.error('Error reading audio file:', err);
            rtpSocket.close();
            callback();
        });

        let sequenceNumber = Math.floor(Math.random() * 65535);
        let timestamp = Math.floor(Math.random() * 1000000);
        const ssrc = Math.floor(Math.random() * 0xFFFFFFFF) >>> 0;
        const payloadType = 0; // PCMU

        const packetSize = 160; // 20ms at 8kHz = 160 samples
        const packets = [];

        reader.on('error', (err) => {
            console.error('WAV reader error:', err);
            rtpSocket.close();
            callback();
        });

        reader.on('format', (format) => {
            console.log(`Audio format: ${format.sampleRate}Hz, ${format.channels} channel(s), ${format.bitDepth}-bit`);

            let buffer = Buffer.alloc(0);

            reader.on('data', (chunk) => {
                buffer = Buffer.concat([buffer, chunk]);

                while (buffer.length >= packetSize * 2) { // *2 because 16-bit samples
                    const samples = buffer.slice(0, packetSize * 2);
                    buffer = buffer.slice(packetSize * 2);

                    // Convert PCM16 to PCMU (G.711 μ-law)
                    const pcmu = this.pcm16ToPCMU(samples);

                    // Create RTP packet
                    const rtpPacket = this.createRTPPacket(sequenceNumber, timestamp, ssrc, payloadType, pcmu);

                    packets.push(rtpPacket);

                    sequenceNumber = (sequenceNumber + 1) & 0xFFFF;
                    timestamp = (timestamp + packetSize) & 0xFFFFFFFF;
                }
            });

            reader.on('end', () => {
                console.log(`✓ Audio buffered: ${packets.length} packets (${(packets.length * 20 / 1000).toFixed(1)}s duration)`);
                console.log(`Starting RTP packet transmission...`);

                // Send packets at 20ms intervals
                let packetIndex = 0;
                let sentPackets = 0;
                let errors = 0;

                const interval = setInterval(() => {
                    if (packetIndex < packets.length) {
                        rtpSocket.send(packets[packetIndex], remoteSDP.port, remoteSDP.ip, (err) => {
                            if (err) {
                                errors++;
                                if (errors === 1) {
                                    console.error(`❌ RTP send error:`, err);
                                }
                            } else {
                                sentPackets++;
                                if (sentPackets === 1 || sentPackets % 50 === 0 || sentPackets === packets.length) {
                                    console.log(`  Sent ${sentPackets}/${packets.length} RTP packets...`);
                                }
                            }
                        });
                        packetIndex++;
                    } else {
                        clearInterval(interval);
                        console.log(`✓ Audio playback complete (sent ${sentPackets} packets, ${errors} errors)`);
                        rtpSocket.close();
                        setTimeout(callback, 500);
                    }
                }, 20); // Send packet every 20ms
            });
        });

        stream.pipe(reader);
    }

    pcm16ToPCMU(pcm16Buffer) {
        // Proper G.711 μ-law encoding
        const BIAS = 0x84;
        const CLIP = 32635;

        const pcmu = Buffer.alloc(pcm16Buffer.length / 2);

        for (let i = 0; i < pcm16Buffer.length; i += 2) {
            let sample = pcm16Buffer.readInt16LE(i);

            // Get the sign bit
            const sign = (sample < 0) ? 0x80 : 0;

            // Get magnitude and clip
            if (sample < 0) sample = -sample;
            if (sample > CLIP) sample = CLIP;

            // Add bias
            sample += BIAS;

            // Get exponent and mantissa
            const exponent = MULAW_ENCODE_TABLE[(sample >> 7) & 0xFF];
            const mantissa = (sample >> (exponent + 3)) & 0x0F;

            // Combine and invert
            const encoded = ~(sign | (exponent << 4) | mantissa);

            pcmu[i / 2] = encoded & 0xFF;
        }

        return pcmu;
    }

    createRTPPacket(sequenceNumber, timestamp, ssrc, payloadType, payload) {
        const header = Buffer.alloc(12);

        // RTP version 2, no padding, no extension, no CSRC
        header[0] = 0x80;
        // Payload type
        header[1] = payloadType & 0x7F;
        // Sequence number
        header.writeUInt16BE(sequenceNumber, 2);
        // Timestamp (ensure unsigned)
        header.writeUInt32BE(timestamp >>> 0, 4);
        // SSRC
        header.writeUInt32BE(ssrc >>> 0, 8);

        return Buffer.concat([header, payload]);
    }

    parseSDP(sdp) {
        const lines = sdp.split('\n');
        const result = { ip: null, port: null };

        for (const line of lines) {
            const trimmedLine = line.trim();
            if (trimmedLine.startsWith('c=')) {
                // c=IN IP4 192.168.2.149
                const parts = trimmedLine.split(' ');
                if (parts.length >= 3) {
                    result.ip = parts[2].trim();
                }
            } else if (trimmedLine.startsWith('m=audio')) {
                // m=audio 5004 RTP/AVP 0 8 101
                const parts = trimmedLine.split(' ');
                if (parts.length >= 2) {
                    result.port = parseInt(parts[1]);
                }
            }
        }

        return result;
    }

    hangup(response) {
        this.setState(PHONE_STATES.OUTGOING_DISCONNECTING);

        // Send BYE
        const bye = {
            method: 'BYE',
            uri: response.headers.contact[0].uri,
            headers: {
                to: response.headers.to,
                from: response.headers.from,
                'call-id': response.headers['call-id'],
                cseq: { method: 'BYE', seq: 2 },
                via: []
            }
        };

        sip.send(bye, (byeResponse) => {
            console.log('Call ended');
            this.calling = false;
            this.setState(PHONE_STATES.IDLE);
            this.emit('call-ended');
            this.scheduleNextCall();
        });
    }

    createSDP(rtpPort) {
        // Simple SDP for audio call
        return `v=0
o=hyperspeed 0 0 IN IP4 ${this.localIP}
s=Hyperspeed Call
c=IN IP4 ${this.localIP}
t=0 0
m=audio ${rtpPort} RTP/AVP 0 8 101
a=rtpmap:0 PCMU/8000
a=rtpmap:8 PCMA/8000
a=rtpmap:101 telephone-event/8000
a=sendrecv
`;
    }
}

module.exports = PhoneManager;
module.exports.PHONE_STATES = PHONE_STATES;
module.exports.CONFIG = CONFIG;
