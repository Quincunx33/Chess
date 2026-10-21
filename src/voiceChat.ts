// Real-Time WebRTC Voice Chat with WebSockets Signaling
export interface VoiceChatState {
  connected: boolean;
  connecting: boolean;
  muted: boolean;
  speakerMuted: boolean;
  speakerVolume: number;
  peerConnected: boolean;
  peerMuted: boolean;
  peerSpeaking: boolean;
  localSpeaking: boolean;
  error: string | null;
}

export type VoiceStateListener = (state: VoiceChatState) => void;

class VoiceChatManager {
  private pc: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private sendWs: ((msg: any) => void) | null = null;
  private roomCode: string | null = null;
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private animFrameId: number | null = null;
  private onRemoteStreamCb: ((stream: MediaStream) => void) | null = null;
  private stateListeners: Set<VoiceStateListener> = new Set();

  public state: VoiceChatState = {
    connected: false,
    connecting: false,
    muted: false,
    speakerMuted: false,
    speakerVolume: 1.0,
    peerConnected: false,
    peerMuted: false,
    peerSpeaking: false,
    localSpeaking: false,
    error: null
  };

  private notify() {
    for (const listener of this.stateListeners) {
      try {
        listener({ ...this.state });
      } catch (e) {
        console.warn('Voice state listener error:', e);
      }
    }
  }

  public subscribe(listener: VoiceStateListener): () => void {
    this.stateListeners.add(listener);
    listener({ ...this.state });
    return () => this.stateListeners.delete(listener);
  }

  public setSendWebSocket(fn: (msg: any) => void) {
    this.sendWs = fn;
  }

  public async startVoice(
    roomCode: string,
    isInitiator: boolean,
    onRemoteStream: (stream: MediaStream) => void
  ): Promise<boolean> {
    this.stopVoice();
    this.roomCode = roomCode;
    this.onRemoteStreamCb = onRemoteStream;
    this.state.connecting = true;
    this.state.error = null;
    this.notify();

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Microphone access is not supported by your browser.');
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
        video: false
      });

      this.localStream = stream;
      this.state.muted = false;

      // Start local audio level analyser for speaking indicator
      this.setupAudioAnalyser(stream);

      // Create RTCPeerConnection with Google STUN servers
      this.pc = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' }
        ]
      });

      stream.getAudioTracks().forEach((track) => {
        if (this.pc && this.localStream) {
          this.pc.addTrack(track, this.localStream);
        }
      });

      this.pc.ontrack = (event) => {
        if (event.streams && event.streams[0]) {
          this.state.peerConnected = true;
          this.notify();
          if (this.onRemoteStreamCb) {
            this.onRemoteStreamCb(event.streams[0]);
          }
        }
      };

      this.pc.onicecandidate = (event) => {
        if (event.candidate && this.sendWs && this.roomCode) {
          this.sendWs({
            type: 'voice_ice',
            roomCode: this.roomCode,
            candidate: event.candidate
          });
        }
      };

      this.pc.onconnectionstatechange = () => {
        const cs = this.pc?.connectionState;
        if (cs === 'connected') {
          this.state.connected = true;
          this.state.connecting = false;
          this.state.peerConnected = true;
          this.notify();
        } else if (cs === 'disconnected' || cs === 'failed' || cs === 'closed') {
          this.state.peerConnected = false;
          this.notify();
        }
      };

      if (isInitiator) {
        const offer = await this.pc.createOffer();
        await this.pc.setLocalDescription(offer);
        if (this.sendWs && this.roomCode) {
          this.sendWs({
            type: 'voice_offer',
            roomCode: this.roomCode,
            sdp: offer
          });
        }
      }

      this.state.connected = true;
      this.state.connecting = false;
      this.notify();
      return true;
    } catch (err: any) {
      console.warn('Voice chat initialization failed:', err);
      this.state.connecting = false;
      this.state.connected = false;
      this.state.error = err.message || 'Could not access microphone';
      this.notify();
      return false;
    }
  }

  public async handleSignal(msg: any) {
    if (!this.pc) return;
    try {
      if (msg.type === 'voice_offer') {
        await this.pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        if (this.sendWs && this.roomCode) {
          this.sendWs({
            type: 'voice_answer',
            roomCode: this.roomCode,
            sdp: answer
          });
        }
      } else if (msg.type === 'voice_answer') {
        if (this.pc.signalingState !== 'stable') {
          await this.pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
        }
      } else if (msg.type === 'voice_ice' && msg.candidate) {
        try {
          await this.pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
        } catch (e) {}
      } else if (msg.type === 'voice_status') {
        if (typeof msg.isMuted === 'boolean') {
          this.state.peerMuted = msg.isMuted;
        }
        if (typeof msg.isSpeaking === 'boolean') {
          this.state.peerSpeaking = msg.isSpeaking;
        }
        this.notify();
      }
    } catch (err) {
      console.warn('Error handling voice signal:', err);
    }
  }

  public toggleMute(): boolean {
    if (!this.localStream) return true;
    const audioTrack = this.localStream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      this.state.muted = !audioTrack.enabled;
      if (this.sendWs && this.roomCode) {
        this.sendWs({
          type: 'voice_status',
          roomCode: this.roomCode,
          isMuted: this.state.muted
        });
      }
      this.notify();
      return this.state.muted;
    }
    return true;
  }

  public toggleSpeaker(): boolean {
    this.state.speakerMuted = !this.state.speakerMuted;
    const audioEl = document.getElementById('remote-voice-audio') as HTMLAudioElement;
    if (audioEl) {
      audioEl.muted = this.state.speakerMuted;
    }
    this.notify();
    return this.state.speakerMuted;
  }

  public setSpeakerMuted(muted: boolean) {
    this.state.speakerMuted = Boolean(muted);
    const audioEl = document.getElementById('remote-voice-audio') as HTMLAudioElement;
    if (audioEl) {
      audioEl.muted = this.state.speakerMuted;
    }
    this.notify();
  }

  public setSpeakerVolume(vol: number) {
    const clamped = Math.max(0, Math.min(1, Number(vol) || 0));
    this.state.speakerVolume = clamped;
    const audioEl = document.getElementById('remote-voice-audio') as HTMLAudioElement;
    if (audioEl) {
      audioEl.volume = clamped;
      if (clamped === 0) {
        audioEl.muted = true;
        this.state.speakerMuted = true;
      } else if (this.state.speakerMuted) {
        audioEl.muted = false;
        this.state.speakerMuted = false;
      }
    }
    this.notify();
  }

  public stopVoice() {
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    if (this.audioCtx) {
      try {
        this.audioCtx.close();
      } catch (e) {}
      this.audioCtx = null;
      this.analyser = null;
    }
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop());
      this.localStream = null;
    }
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
    this.state = {
      connected: false,
      connecting: false,
      muted: false,
      speakerMuted: false,
      speakerVolume: 1.0,
      peerConnected: false,
      peerMuted: false,
      peerSpeaking: false,
      localSpeaking: false,
      error: null
    };
    this.notify();
  }

  private setupAudioAnalyser(stream: MediaStream) {
    try {
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtxClass) return;
      this.audioCtx = new AudioCtxClass();
      const source = this.audioCtx.createMediaStreamSource(stream);
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 64;
      source.connect(this.analyser);

      const bufferLength = this.analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      let lastSpeakingState = false;
      const checkVolume = () => {
        if (!this.analyser || !this.state.connected) return;
        this.analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const avg = sum / bufferLength;
        const isSpeaking = !this.state.muted && avg > 14;

        if (isSpeaking !== lastSpeakingState) {
          lastSpeakingState = isSpeaking;
          this.state.localSpeaking = isSpeaking;
          this.notify();
          if (this.sendWs && this.roomCode) {
            this.sendWs({
              type: 'voice_status',
              roomCode: this.roomCode,
              isSpeaking
            });
          }
        }
        this.animFrameId = requestAnimationFrame(checkVolume);
      };
      this.animFrameId = requestAnimationFrame(checkVolume);
    } catch (e) {
      console.warn('Audio analyser setup skipped:', e);
    }
  }
}

export const voiceChat = new VoiceChatManager();
