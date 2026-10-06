const fs = require('fs');
const path = require('path');

/**
 * Manages sound selection with play tracking
 * Prioritizes unplayed sounds, then least recently played
 * Scans directory in real-time for new files
 */
class SoundSelector {
    constructor(directoryPath, description = 'sounds') {
        this.directoryPath = directoryPath;
        this.description = description;
        // Track last play time for each file (filename -> timestamp)
        this.playHistory = new Map();
    }

    /**
     * Scans directory for audio files (.wav, .mp3)
     * Prefers .wav files over .mp3 when both exist
     * Returns array of absolute file paths
     */
    scanDirectory() {
        try {
            if (!fs.existsSync(this.directoryPath)) {
                console.warn(`Directory not found: ${this.directoryPath}`);
                return [];
            }

            const allFiles = fs.readdirSync(this.directoryPath)
                .filter(f => f.endsWith('.wav') || f.endsWith('.mp3'));

            // Build set of base names that have WAV files
            const wavBaseNames = new Set();
            for (const file of allFiles) {
                if (file.endsWith('.wav')) {
                    wavBaseNames.add(file.slice(0, -4)); // Remove .wav extension
                }
            }

            // Filter out MP3 files if corresponding WAV exists
            const files = allFiles
                .filter(f => {
                    if (f.endsWith('.mp3')) {
                        const baseName = f.slice(0, -4); // Remove .mp3 extension
                        // Exclude MP3 if WAV with same base name exists
                        return !wavBaseNames.has(baseName);
                    }
                    return true; // Keep all WAV files
                })
                .map(f => path.join(this.directoryPath, f));

            return files;
        } catch (error) {
            console.error(`Error scanning directory ${this.directoryPath}:`, error);
            return [];
        }
    }

    /**
     * Selects the least recently played sound
     * Prioritizes unplayed sounds (randomly among them)
     * If all played, selects least recently played (randomly among ties)
     * Returns absolute file path or null if no files
     */
    selectSound() {
        const files = this.scanDirectory();

        if (files.length === 0) {
            console.warn(`No audio files found in ${this.directoryPath}`);
            return null;
        }

        // Separate unplayed and played files
        const unplayedFiles = [];
        const playedFiles = [];

        for (const file of files) {
            if (this.playHistory.has(file)) {
                playedFiles.push(file);
            } else {
                unplayedFiles.push(file);
            }
        }

        let selectedFile;

        if (unplayedFiles.length > 0) {
            // Randomly select from unplayed files
            selectedFile = unplayedFiles[Math.floor(Math.random() * unplayedFiles.length)];
            console.log(`Selected unplayed ${this.description}: ${path.basename(selectedFile)}`);
        } else {
            // All files have been played, find least recently played
            // Sort by play time (oldest first)
            playedFiles.sort((a, b) => {
                const timeA = this.playHistory.get(a) || 0;
                const timeB = this.playHistory.get(b) || 0;
                return timeA - timeB;
            });

            // Find all files with the oldest play time (there might be ties)
            const oldestTime = this.playHistory.get(playedFiles[0]) || 0;
            const oldestFiles = playedFiles.filter(f =>
                (this.playHistory.get(f) || 0) === oldestTime
            );

            // Randomly select among tied files
            selectedFile = oldestFiles[Math.floor(Math.random() * oldestFiles.length)];
            console.log(`Selected least recently played ${this.description}: ${path.basename(selectedFile)}`);
        }

        // Mark as played
        this.playHistory.set(selectedFile, Date.now());

        return selectedFile;
    }

    /**
     * Resets play history (useful for testing)
     */
    reset() {
        this.playHistory.clear();
        console.log(`Reset play history for ${this.description}`);
    }

    /**
     * Gets stats about the selector
     */
    getStats() {
        const files = this.scanDirectory();
        const playedCount = files.filter(f => this.playHistory.has(f)).length;
        return {
            totalFiles: files.length,
            playedCount: playedCount,
            unplayedCount: files.length - playedCount
        };
    }
}

module.exports = SoundSelector;
