export class AudioCue {
    constructor() {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        this.intervalId = null;
    }

    startTickingSound() {
        // this.playAudioFile(() => {
            // Start ticking after the MP3 has finished playing
            if (this.audioContext.state === 'suspended') {
                this.audioContext.resume(); // Ensure the audio context is running
            }

            this.intervalId = setInterval(() => {
                const oscillator = this.audioContext.createOscillator();
                const gainNode = this.audioContext.createGain();

                oscillator.frequency.setValueAtTime(1000, this.audioContext.currentTime); // Frequency of the ticking sound
                gainNode.gain.setValueAtTime(0.1, this.audioContext.currentTime); // Volume of the ticking sound

                oscillator.connect(gainNode);
                gainNode.connect(this.audioContext.destination);

                oscillator.start();
                oscillator.stop(this.audioContext.currentTime + 0.1); // Duration of the ticking sound
            }, 1000);
        // });
    }

    stopTickingSound() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
    }

    playAudioFile(onComplete) {
        const url = 'processing.mp3'; // URL to your MP3 file
        fetch(url)
            .then(response => response.arrayBuffer())
            .then(arrayBuffer => this.audioContext.decodeAudioData(arrayBuffer))
            .then(audioBuffer => {
                const source = this.audioContext.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(this.audioContext.destination);
                source.start(0);
                source.onended = onComplete; // When MP3 ends, call the onComplete callback
            })
            .catch(error => console.error('Error loading or playing MP3:', error));
    }
}
