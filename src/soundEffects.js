// =============================================================================
// Wizard Chess 3D — Procedural Web Audio Sound Engine with iOS WebKit Unlock
// Zero external audio files (100% synthesized in real-time with Web Audio API)
// =============================================================================

class WizardSoundEngine {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.isMuted = false;
    this.isUnlocked = false;

    // Load initial mute state from localStorage if available
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const saved = window.localStorage.getItem('wizard_chess_muted');
        if (saved === 'true') {
          this.isMuted = true;
        }
      }
    } catch (e) {}

    this.initAudioContext = this.initAudioContext.bind(this);
    this.unlockAudio = this.unlockAudio.bind(this);
    this.playSilentUnlockAudio = this.playSilentUnlockAudio.bind(this);
    if (typeof window !== 'undefined') {
      this.setupUnlockListeners();
    }
  }

  initAudioContext() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      return this.ctx;
    }
    if (typeof window === 'undefined') return null;

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      console.warn('Web Audio API not supported in this browser.');
      return null;
    }

    try {
      this.ctx = new AudioContextClass();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(this.isMuted ? 0 : 0.85, this.ctx.currentTime);
      this.masterGain.connect(this.ctx.destination);
    } catch (err) {
      console.warn('Could not initialize AudioContext:', err);
    }

    return this.ctx;
  }

  setupUnlockListeners() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    // iOS Safari / WebKit requires user interaction (touchstart, touchend, pointerdown, click)
    // to resume AudioContext and trigger audio playback.
    const unlockEvents = ['touchstart', 'touchend', 'pointerdown', 'mousedown', 'keydown', 'click'];
    const handleFirstInteraction = () => {
      this.unlockAudio();
    };

    unlockEvents.forEach((evt) => {
      window.addEventListener(evt, handleFirstInteraction, { capture: true, passive: true });
      document.addEventListener(evt, handleFirstInteraction, { capture: true, passive: true });
    });
  }

  playSilentUnlockAudio() {
    try {
      if (!this.silentAudioEl && typeof document !== 'undefined') {
        const audio = document.createElement('audio');
        audio.setAttribute('preload', 'auto');
        audio.setAttribute('playsinline', 'true');
        audio.setAttribute('webkit-playsinline', 'true');
        // 0.1s silent WAV (RIFF header + minimal PCM)
        audio.src = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';
        audio.volume = 0.01;
        this.silentAudioEl = audio;
      }
      if (this.silentAudioEl) {
        const p = this.silentAudioEl.play();
        if (p && typeof p.then === 'function') {
          p.then(() => {
            this.silentAudioEl.pause();
          }).catch(() => {});
        }
      }
    } catch (e) {}
  }

  unlockAudio() {
    const ctx = this.initAudioContext();
    if (!ctx) return;

    if (ctx.state === 'suspended') {
      ctx.resume().then(() => {
        if (ctx.state === 'running') {
          this.isUnlocked = true;
        }
      }).catch(() => {});
    } else if (ctx.state === 'running') {
      this.isUnlocked = true;
    }

    // Critical iOS WebKit unlock: play a 1-sample silent buffer directly within the user gesture callback
    try {
      const buffer = ctx.createBuffer(1, 1, 22050);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start(0);
      this.isUnlocked = true;
    } catch (err) {}

    this.playSilentUnlockAudio();
  }

  toggleMute() {
    this.unlockAudio();
    this.isMuted = !this.isMuted;
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem('wizard_chess_muted', String(this.isMuted));
      }
    } catch (e) {}

    if (this.masterGain && this.ctx) {
      const t = this.ctx.currentTime || 0;
      this.masterGain.gain.cancelScheduledValues(t);
      this.masterGain.gain.linearRampToValueAtTime(this.isMuted ? 0 : 0.85, t + 0.05);
    }
    return !this.isMuted;
  }

  getSoundEnabled() {
    return !this.isMuted;
  }

  // Helper to generate a procedural noise buffer (stone scrape / crumble)
  createNoiseBuffer(duration = 0.5) {
    if (!this.ctx) return null;
    if (this._cachedNoiseBuffer) return this._cachedNoiseBuffer;
    const sampleRate = this.ctx.sampleRate || 44100;
    const bufferSize = sampleRate * 2;
    const buffer = this.ctx.createBuffer(1, bufferSize, sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    this._cachedNoiseBuffer = buffer;
    return buffer;
  }

  // 1. Piece Selection: Crisp marble resonance click
  playSelectSound() {
    if (this.isMuted) return;
    this.unlockAudio();
    if (!this.ctx || this.ctx.state === 'closed') return;

    const t = this.ctx.currentTime || 0;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(840, t);
    osc.frequency.exponentialRampToValueAtTime(320, t + 0.08);

    gain.gain.setValueAtTime(0.24, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start(t);
    osc.stop(t + 0.08);
  }

  // 2. Piece Movement Slide: Heavy stone statue sliding across granite altar slab
  playMoveSlideSound(duration = 0.45) {
    if (this.isMuted) return;
    this.unlockAudio();
    if (!this.ctx || this.ctx.state === 'closed') return;

    const t = this.ctx.currentTime;
    const dur = Math.max(0.2, Math.min(1.2, duration));

    // Friction scrape noise
    const noiseBuf = this.createNoiseBuffer(dur);
    if (noiseBuf) {
      const noiseSource = this.ctx.createBufferSource();
      noiseSource.buffer = noiseBuf;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(380, t);
      filter.frequency.linearRampToValueAtTime(260, t + dur);
      filter.Q.value = 3.5;

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.01, t);
      gain.gain.linearRampToValueAtTime(0.18, t + 0.06);
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur);

      noiseSource.connect(filter);
      filter.connect(gain);
      gain.connect(this.masterGain);

      noiseSource.start(t);
      noiseSource.stop(t + dur);
    }

    // Heavy stone pedestal placement thud at landing
    const thudTime = t + dur * 0.85;
    const osc = this.ctx.createOscillator();
    const thudGain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(140, thudTime);
    osc.frequency.exponentialRampToValueAtTime(45, thudTime + 0.14);

    thudGain.gain.setValueAtTime(0.28, thudTime);
    thudGain.gain.exponentialRampToValueAtTime(0.001, thudTime + 0.14);

    osc.connect(thudGain);
    thudGain.connect(this.masterGain);

    osc.start(thudTime);
    osc.stop(thudTime + 0.14);
  }

  // 3. Melee Attack Wind-up Whoosh
  playAttackWhooshSound() {
    if (this.isMuted) return;
    this.unlockAudio();
    if (!this.ctx || this.ctx.state === 'closed') return;

    const t = this.ctx.currentTime || 0;
    const dur = 0.32;
    const noiseBuf = this.createNoiseBuffer(dur);
    if (!noiseBuf) return;

    const noiseSource = this.ctx.createBufferSource();
    noiseSource.buffer = noiseBuf;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(180, t);
    filter.frequency.exponentialRampToValueAtTime(850, t + 0.18);
    filter.frequency.exponentialRampToValueAtTime(140, t + dur);
    filter.Q.value = 2.4;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.01, t);
    gain.gain.linearRampToValueAtTime(0.26, t + 0.16);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);

    noiseSource.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    noiseSource.start(t);
    noiseSource.stop(t + dur);
  }

  // 4. Physical Weapon Strike Clash (Sword / Mace impacting stone statue)
  playStrikeClashSound() {
    if (this.isMuted) return;
    this.unlockAudio();
    if (!this.ctx || this.ctx.state === 'closed') return;

    const t = this.ctx.currentTime || 0;

    // Metallic blade crack
    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const clashGain = this.ctx.createGain();

    osc1.type = 'sawtooth';
    osc1.frequency.setValueAtTime(940, t);
    osc1.frequency.exponentialRampToValueAtTime(180, t + 0.09);

    osc2.type = 'square';
    osc2.frequency.setValueAtTime(1420, t);
    osc2.frequency.exponentialRampToValueAtTime(220, t + 0.08);

    clashGain.gain.setValueAtTime(0.32, t);
    clashGain.gain.exponentialRampToValueAtTime(0.001, t + 0.09);

    osc1.connect(clashGain);
    osc2.connect(clashGain);
    clashGain.connect(this.masterGain);

    osc1.start(t);
    osc2.start(t);
    osc1.stop(t + 0.09);
    osc2.stop(t + 0.09);
  }

  // 5. Stone Shatter Explosion (Piece explodes into flying stone shards)
  playStoneShatterSound() {
    if (this.isMuted) return;
    this.unlockAudio();
    if (!this.ctx || this.ctx.state === 'closed') return;

    const t = this.ctx.currentTime || 0;

    // Deep explosive impact thud
    const subOsc = this.ctx.createOscillator();
    const subGain = this.ctx.createGain();
    subOsc.type = 'sine';
    subOsc.frequency.setValueAtTime(160, t);
    subOsc.frequency.exponentialRampToValueAtTime(32, t + 0.55);

    subGain.gain.setValueAtTime(0.55, t);
    subGain.gain.exponentialRampToValueAtTime(0.001, t + 0.55);

    subOsc.connect(subGain);
    subGain.connect(this.masterGain);
    subOsc.start(t);
    subOsc.stop(t + 0.55);

    // Sharp stone fracture crack
    const crackNoise = this.createNoiseBuffer(0.22);
    if (crackNoise) {
      const crackSource = this.ctx.createBufferSource();
      crackSource.buffer = crackNoise;

      const crackFilter = this.ctx.createBiquadFilter();
      crackFilter.type = 'highpass';
      crackFilter.frequency.setValueAtTime(1200, t);

      const crackGain = this.ctx.createGain();
      crackGain.gain.setValueAtTime(0.42, t);
      crackGain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);

      crackSource.connect(crackFilter);
      crackFilter.connect(crackGain);
      crackGain.connect(this.masterGain);

      crackSource.start(t);
      crackSource.stop(t + 0.22);
    }

    // Secondary crumbling shards scattering over 0.7s
    const rumbleNoise = this.createNoiseBuffer(0.75);
    if (rumbleNoise) {
      const rumbleSource = this.ctx.createBufferSource();
      rumbleSource.buffer = rumbleNoise;

      const rumbleFilter = this.ctx.createBiquadFilter();
      rumbleFilter.type = 'bandpass';
      rumbleFilter.frequency.setValueAtTime(550, t + 0.04);
      rumbleFilter.frequency.linearRampToValueAtTime(220, t + 0.75);
      rumbleFilter.Q.value = 2.0;

      const rumbleGain = this.ctx.createGain();
      rumbleGain.gain.setValueAtTime(0.01, t);
      rumbleGain.gain.linearRampToValueAtTime(0.35, t + 0.05);
      rumbleGain.gain.exponentialRampToValueAtTime(0.001, t + 0.75);

      rumbleSource.connect(rumbleFilter);
      rumbleFilter.connect(rumbleGain);
      rumbleGain.connect(this.masterGain);

      rumbleSource.start(t);
      rumbleSource.stop(t + 0.75);
    }
  }

  // 6. Checkmate & King Fall: Solemn Cathedral Bell Toll + Heavy Stone Topple Crash
  playCheckmateBellSound() {
    if (this.isMuted) return;
    this.unlockAudio();
    if (!this.ctx || this.ctx.state === 'closed') return;

    const t = this.ctx.currentTime || 0;
    // Harmonic frequencies of a deep bronze gothic cathedral bell
    const harmonics = [
      { freq: 220, gain: 0.35, dur: 2.8 },  // Hum
      { freq: 261.6, gain: 0.28, dur: 2.2 },// Prime / minor third
      { freq: 440, gain: 0.22, dur: 1.8 },  // Octave
      { freq: 659.2, gain: 0.16, dur: 1.4 },// Tierce
      { freq: 880, gain: 0.12, dur: 1.0 }   // Nominal
    ];

    harmonics.forEach(({ freq, gain: initGain, dur }) => {
      const osc = this.ctx.createOscillator();
      const gainNode = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t);

      gainNode.gain.setValueAtTime(initGain, t);
      gainNode.gain.exponentialRampToValueAtTime(0.001, t + dur);

      osc.connect(gainNode);
      gainNode.connect(this.masterGain);

      osc.start(t);
      osc.stop(t + dur);
    });
  }

  playKingImpactSound() {
    if (this.isMuted) return;
    this.unlockAudio();
    if (!this.ctx || this.ctx.state === 'closed') return;

    const t = this.ctx.currentTime || 0;
    // Massive monolithic stone thud + crown shard scattering
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(95, t);
    osc.frequency.exponentialRampToValueAtTime(28, t + 0.65);

    gain.gain.setValueAtTime(0.65, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.65);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start(t);
    osc.stop(t + 0.65);

    // Stone rubble burst
    const noise = this.createNoiseBuffer(0.5);
    if (noise) {
      const nSource = this.ctx.createBufferSource();
      nSource.buffer = noise;
      const nFilter = this.ctx.createBiquadFilter();
      nFilter.type = 'lowpass';
      nFilter.frequency.setValueAtTime(650, t);
      nFilter.frequency.exponentialRampToValueAtTime(150, t + 0.5);

      const nGain = this.ctx.createGain();
      nGain.gain.setValueAtTime(0.38, t);
      nGain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);

      nSource.connect(nFilter);
      nFilter.connect(nGain);
      nGain.connect(this.masterGain);

      nSource.start(t);
      nSource.stop(t + 0.5);
    }
  }

  // 7. Camera Preset Transition Whoosh
  playCameraWhooshSound() {
    if (this.isMuted) return;
    this.unlockAudio();
    if (!this.ctx || this.ctx.state === 'closed') return;

    const t = this.ctx.currentTime || 0;
    const dur = 0.28;
    const noise = this.createNoiseBuffer(dur);
    if (!noise) return;

    const nSource = this.ctx.createBufferSource();
    nSource.buffer = noise;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(140, t);
    filter.frequency.exponentialRampToValueAtTime(420, t + 0.12);
    filter.frequency.exponentialRampToValueAtTime(120, t + dur);
    filter.Q.value = 1.8;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.01, t);
    gain.gain.linearRampToValueAtTime(0.12, t + 0.12);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);

    nSource.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    nSource.start(t);
    nSource.stop(t + dur);
  }
}

export const soundEngine = new WizardSoundEngine();
