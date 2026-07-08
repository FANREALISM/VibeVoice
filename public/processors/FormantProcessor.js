/**
 * FormantProcessor.js
 * Optimized "Middle Ground" Granular Pitch Shifter.
 * 
 * Goals:
 * 1. Smooth, windowed grains (Hann Window) to eliminate crackling.
 * 2. 50-60ms grain size (sweet spot for vocals).
 * 3. Safe read/write pointer buffer margin.
 */

class FormantProcessor extends AudioWorkletProcessor {
    static get parameterDescriptors() {
        return [
            { name: 'pitchRatio', defaultValue: 1.0, minValue: 0.1, maxValue: 10.0 },
            { name: 'formantShift', defaultValue: 1.0, minValue: 0.1, maxValue: 10.0 }
        ];
    }

    constructor() {
        super();
        // Larger buffer for safety
        this.bufferSize = 65536;
        this.buffer = new Float32Array(this.bufferSize);
        this.writePtr = 0;
        // How many real (non-zero-initialized) samples have been written
        // since this processor was created. Used to stop triggerGrain()
        // from reading uninitialized buffer regions on a freshly-started
        // note — previously it always looked back a fixed 3000 samples
        // regardless of how much real audio existed yet, guaranteeing the
        // first ~68ms of every note (a brand new AudioWorkletNode is
        // created per note/phoneme, so this hit on EVERY note) produced
        // silent grains.
        this.samplesWritten = 0;
        
        // Use a 55ms grain at 44.1kHz (~2425 samples)
        this.baseGrainSize = 2400; 
        this.numGrains = 24; // Increased headroom for overlapping grains
        this.grains = [];
        for (let i = 0; i < this.numGrains; i++) {
            this.grains.push({
                active: false,
                readPtr: 0,
                pos: 0,
                len: this.baseGrainSize
            });
        }

        this.spawnTimer = 0;
        
        // Precompute Hann window
        this.window = new Float32Array(this.baseGrainSize);
        for (let i = 0; i < this.baseGrainSize; i++) {
            this.window[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (this.baseGrainSize - 1)));
        }
    }

    process(inputs, outputs, parameters) {
        const input = inputs[0] ? inputs[0][0] : null;
        const output = outputs[0] ? outputs[0][0] : null;

        if (!input || !output) return true;

        const pitchRatio = parameters.pitchRatio[0] || 1.0;
        const formantShift = parameters.formantShift[0] || 1.0;

        for (let i = 0; i < input.length; i++) {
            // Write input to ring buffer
            this.buffer[this.writePtr] = input[i];
            if (this.samplesWritten < this.bufferSize) this.samplesWritten++;

            // Grain Spawning logic
            // Threshold is half the grain size for 50% overlap at 1.0 pitch
            // Increment adjusted by pitchRatio to change trigger frequency
            this.spawnTimer += pitchRatio;
            // Don't spawn grains until we actually have enough real history
            // for triggerGrain()'s look-back to read (see MIN_LOOKBACK below)
            // — otherwise early grains read uninitialized zeros.
            if (this.spawnTimer >= (this.baseGrainSize / 2) && this.samplesWritten >= 64) {
                this.spawnTimer = 0;
                this.triggerGrain();
            }

            // Synthesize output from active grains
            let mixed = 0;
            for (let g = 0; g < this.numGrains; g++) {
                const grain = this.grains[g];
                if (grain.active) {
                    // Resampling position logic
                    const currentPos = (grain.readPtr + grain.pos) % this.bufferSize;
                    
                    // Linear Interpolation
                    const i0 = Math.floor(currentPos);
                    const i1 = (i0 + 1) % this.bufferSize;
                    const frac = currentPos - i0;
                    const s0 = this.buffer[i0];
                    const s1 = this.buffer[i1];
                    const sample = s0 + frac * (s1 - s0);

                    // Windowing logic: window index is determined by normalized progress through the grain data
                    const winIdx = Math.floor(grain.pos);
                    
                    if (winIdx < this.baseGrainSize && winIdx >= 0) {
                        mixed += sample * this.window[winIdx];
                        // Progress through grain at formant shift speed
                        grain.pos += formantShift;
                    } else {
                        grain.active = false;
                    }
                }
            }

            // Normalization & Hard Limiting
            // Overlapping Hann windows sum to ~1.0; 0.75 scaling provides safe headroom
            let outVal = (isNaN(mixed) || !isFinite(mixed)) ? 0 : mixed * 0.75;
            output[i] = Math.max(-1.0, Math.min(1.0, outVal));

            // Advance write pointer
            this.writePtr = (this.writePtr + 1) % this.bufferSize;
        }

        return true;
    }

    triggerGrain() {
        for (let i = 0; i < this.numGrains; i++) {
            if (!this.grains[i].active) {
                this.grains[i].active = true;
                this.grains[i].pos = 0;
                this.grains[i].len = this.baseGrainSize;

                // Look back far enough for a full 55ms grain without reading
                // past what's actually been written into the ring buffer yet.
                // Fixed 3000-sample look-back assumed the buffer always had
                // that much real history — false for the first ~68ms of
                // every note (a fresh AudioWorkletNode/buffer per phoneme).
                const desiredLookback = 3000;
                const safeLookback = Math.min(desiredLookback, this.samplesWritten);
                this.grains[i].readPtr = (this.writePtr - safeLookback + this.bufferSize) % this.bufferSize;
                return;
            }
        }
    }
}

registerProcessor('formant-processor', FormantProcessor);
