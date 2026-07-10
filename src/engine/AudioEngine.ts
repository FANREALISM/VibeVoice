import * as Tone from 'tone';
import { Note, useProjectStore } from '../store/useProjectStore';
import { romajiToHiraganaMap, parseEnglishToPhonemes, buildCVVCAliases, preloadCmuDictionary } from './Phonemizer';
// @ts-ignore
import processorUrl from '/processors/FormantProcessor.js?url';

// Bind Tone.js to a dedicated native AudioContext IMMEDIATELY on module load,
// before React mounts anything. This is the actual fix for the Transport-
// clock-mismatch bug: App.tsx / PianoRoll.tsx touch Tone.Transport in a
// useEffect on mount, well before AudioEngine.init() ever runs (init only
// runs on a user gesture, e.g. pressing Play). If we set the context here,
// Transport is born on the right context from its very first access, so we
// get both things the previous two attempts each had half of:
//   - a real, self-created AudioContext (so AudioWorkletNode construction is
//     against a plain native context, not Tone's internal wrapper — this is
//     what made the worklet reliable before, and what broke when we switched
//     to unwrapping Tone.getContext().rawContext)
//   - Transport and all audio nodes sharing one clock from the start (so we
//     don't reintroduce "sound on preview, silence on Play")
// Creating the context here is safe pre-user-gesture: it can exist suspended
// until Tone.start() resumes it later inside a real click handler.
const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
const dedicatedNativeContext: AudioContext = new AudioContextClass();
Tone.setContext(dedicatedNativeContext);

interface OtoParameters {
  file: string;
  alias: string;
  offset: number;
  consonant: number;
  cutoff: number;
  preutterance: number;
  overlap: number;
}

interface UtauSample {
  buffer: Tone.ToneAudioBuffer;
  oto: OtoParameters;
}

const arpabetToXSampa: Record<string, string[]> = {
  'aa': ['A', 'a', 'Q'],
  'ih': ['I', 'i'],
  'iy': ['i:', 'e', 'i'],
  'eh': ['E', 'e'],
  'uh': ['U'],
  'ah': ['V', '@'],
  'ae': ['{', 'a'],
  'aw': ['aU'],
  'ay': ['aI'],
  'ey': ['eI'],
  'ow': ['oU'],
  'oy': ['OI'],
  'uw': ['u:', 'u'],
  'er': ['3r', '3`', '3', '@r'],
  'ao': ['O'],
  'zh': ['Z'],
  'ch': ['tS'],
  'sh': ['S'],
  'jh': ['dZ'],
  'dh': ['D'],
  'th': ['T'],
  'ng': ['N'],
  'r': ['r\\', 'r'],
  'y': ['j', 'y'],
  'hh': ['h']
};

class AudioEngine {
  private synth!: Tone.PolySynth;
  private voicebank: Map<string, UtauSample> = new Map();
  private useCustomVoice: boolean = false;
  private isInitialized: boolean = false;
  private baseMidi = 60; // Assuming C4 as base
  private activeSources: any[] = [];
  private effectChain!: Tone.Volume;
  private workletReady: boolean = false;
  private isXSampa: boolean = false;
  public nativeContext?: AudioContext;
  private trackPlayer: Tone.Player | null = null;
  private trackVolume: Tone.Volume | null = null;
  private audioTrackRaw: { blob: Blob; name: string } | null = null;

  constructor() {
    // NOTE: synth/filter/effectChain are intentionally NOT built here.
    // init() creates a fresh native AudioContext and calls Tone.setContext()
    // on it. Any Tone node instantiated before that swap stays bound to the
    // old (default) context's destination — connecting it to nodes on the
    // new context fails silently in the Web Audio API (no error, no sound).
    // That was exactly the "still no sound" bug: the AudioWorklet path
    // bypasses effectChain and routes straight to nativeContext.destination,
    // so it kept working, while the GrainPlayer/plain-synth fallback paths
    // (which both route through effectChain) went completely silent whenever
    // the worklet wasn't in use. Building these lazily inside init(), after
    // setContext(), keeps everything on the same context.
  }

  private buildSynthGraph() {
    this.synth = new Tone.PolySynth(Tone.FMSynth, {
      harmonicity: 3,
      modulationIndex: 2.5,
      oscillator: { type: "sawtooth" },
      envelope: {
        attack: 0.1,
        decay: 0.2,
        sustain: 0.8,
        release: 0.5
      },
      modulation: { type: "sine" },
      modulationEnvelope: {
        attack: 0.2,
        decay: 0.01,
        sustain: 1,
        release: 0.5
      }
    });

    const filter = new Tone.Filter(3000, "lowpass");

    this.effectChain = new Tone.Volume(0);
    this.effectChain.chain(filter, Tone.getDestination());

    this.synth.connect(this.effectChain);
  }

  public async loadVoicebank(file: File) {
    if (!this.isInitialized) await this.init();
    
    console.log("Loading zip archive for Voicebank...");
    const { default: JSZip } = await import('jszip');
    const zip = new JSZip();
    await zip.loadAsync(file);
    
    this.voicebank.clear();
    const context = Tone.context.rawContext as AudioContext;
    
    // 1. Find and parse oto.ini files
    const otoData = new Map<string, OtoParameters>();
    const decodeOtoText = (buf: ArrayBuffer): string => {
      // Try UTF-8 first (strict, so it throws/produces replacement chars on invalid bytes)
      try {
        const utf8 = new TextDecoder("utf-8", { fatal: true }).decode(buf);
        return utf8;
      } catch {
        // Fall back to Shift-JIS, the historical/common encoding for oto.ini in UTAU voicebanks
        try {
          return new TextDecoder("shift-jis").decode(buf);
        } catch {
          // Last resort: lossy UTF-8 so we at least don't crash
          return new TextDecoder("utf-8", { fatal: false }).decode(buf);
        }
      }
    };

    for (const [relativePath, zipEntry] of Object.entries(zip.files)) {
      if (relativePath.toLowerCase().endsWith('oto.ini')) {
         const rawBuf = await zipEntry.async("arraybuffer");
         const text = decodeOtoText(rawBuf);
         const lines = text.split(/\r?\n/);
         for (const line of lines) {
            if (!line.trim() || line.startsWith('#')) continue;
            const [filePart, paramsPart] = line.split('=');
            if (filePart && paramsPart) {
                const params = paramsPart.split(',');
                const alias = params[0] || filePart.replace(/\.wav$/i, "");
                otoData.set(alias, {
                    file: filePart,
                    alias: alias,
                    offset: parseFloat(params[1]) || 0,
                    consonant: parseFloat(params[2]) || 0,
                    cutoff: parseFloat(params[3]) || 0,
                    preutterance: parseFloat(params[4]) || 0,
                    overlap: parseFloat(params[5]) || 0
                });
            }
         }
      }
    }
    
    // 2. Decode WAV files
    let wavCount = 0;
    const decodedWavs = new Map<string, Tone.ToneAudioBuffer>();
    for (const [relativePath, zipEntry] of Object.entries(zip.files)) {
      if (!zipEntry.dir && relativePath.toLowerCase().endsWith('.wav')) {
        const arrayBuffer = await zipEntry.async("arraybuffer");
        try {
          const audioBuffer = await context.decodeAudioData(arrayBuffer);
          const toneBuffer = new Tone.ToneAudioBuffer(audioBuffer);
          const filename = relativePath.split('/').pop() || "";
          decodedWavs.set(filename, toneBuffer);
          wavCount++;
        } catch (e) {
          console.warn(`Failed to decode ${relativePath}`);
        }
      }
    }

    // 3. Map to aliases with OTO data
    for (const [filename, toneBuffer] of decodedWavs.entries()) {
      let foundAlias = false;
      for (const [alias, oto] of otoData.entries()) {
        if (oto.file === filename) {
          this.voicebank.set(alias, { buffer: toneBuffer, oto });
          foundAlias = true;
        }
      }
      
      // Fallback mapping if no oto.ini entry exists
      if (!foundAlias) {
        const defaultAlias = filename.replace(/\.wav$/i, "");
        this.voicebank.set(defaultAlias, {
            buffer: toneBuffer,
            oto: {
                file: filename,
                alias: defaultAlias,
                offset: 0,
                consonant: 50,
                cutoff: 0,
                preutterance: 20,
                overlap: 10
            }
        });
      }
    }

    if (wavCount > 0) {
      this.useCustomVoice = true;
      console.log(`Loaded custom voicebank. Samples decoded: ${wavCount}, Aliases registered: ${this.voicebank.size}`);
      const first20 = Array.from(this.voicebank.keys()).slice(0, 20);
      console.log(`First 20 valid aliases loaded in oto.ini format:`, first20);

      // Auto-detect English C+V/VCCV format
      const isEnglishVB = first20.some(alias => alias.startsWith('- ') || alias.endsWith(' -') || alias.match(/^[a-z]{1,2}$/i));
      if (isEnglishVB) {
        console.log("English C+V / VCCV format detected. Switching language to EN.");
        useProjectStore.getState().setLanguage('EN');
      }

      const allAliases = Array.from(this.voicebank.keys());
      this.isXSampa = allAliases.some(alias => /[@A3IQ]/.test(alias));
      if (this.isXSampa) {
        console.log("X-SAMPA aliasing format detected.");
      }
      // Full alias dump (not just first 20) — needed to see the actual vowel/
      // consonant symbol set this voicebank uses, so arpabetToXSampa can be
      // expanded against real data instead of guessed blind.
      console.log("FULL ALIAS LIST:", allAliases);
      const singleTokenSet = new Set<string>();
      allAliases.forEach(a => a.split(' ').forEach(p => { if (p !== '-') singleTokenSet.add(p); }));
      console.log("Unique single phoneme tokens across all aliases:", Array.from(singleTokenSet).sort());
      // Targeted: what does this voicebank actually call transitions involving
      // 'k' and vowels close to 'aa'/'uh'? Need real naming convention, not a guess.
      console.log("Aliases containing 'k':", allAliases.filter(a => a.split(' ').includes('k')));
      console.log("Aliases containing 'a', 'A', 'Q', or '@':", allAliases.filter(a => /(^|\s)(a|A|Q|@)($|\s)/.test(a)));
      console.log("Aliases containing 'U' or 'u':", allAliases.filter(a => /(^|\s)(U|u)($|\s)/.test(a)));

    } else {
      console.warn("No .wav files found in zip.");
    }
  }

  public async loadAudioTrack(file: File | Blob, fileName?: string) {
    if (!this.isInitialized) await this.init();

    const arrayBuffer = await file.arrayBuffer();
    const context = Tone.context.rawContext as AudioContext;
    const audioBuffer = await context.decodeAudioData(arrayBuffer.slice(0));

    // Dispose any previously loaded track before replacing it
    this.removeAudioTrack();

    const toneBuffer = new Tone.ToneAudioBuffer(audioBuffer);
    this.trackVolume = new Tone.Volume(0).connect(Tone.getDestination());
    this.trackPlayer = new Tone.Player(toneBuffer).connect(this.trackVolume);

    // Sync to the Transport so the backing track starts/stops/seeks together
    // with the vocal notes instead of running on its own separate clock.
    // (start(0) is (re)issued in togglePlayback, since Transport.cancel()
    // wipes any schedule set here.)
    this.trackPlayer.sync();

    // Retain the raw bytes so a full project export can re-embed the exact
    // original file without needing to re-encode the decoded PCM buffer.
    const resolvedName = fileName || (file instanceof File ? file.name : 'audio-track');
    this.audioTrackRaw = { blob: file, name: resolvedName };
  }

  public removeAudioTrack() {
    if (this.trackPlayer) {
      try {
        this.trackPlayer.unsync();
        this.trackPlayer.stop();
        this.trackPlayer.dispose();
      } catch (e) { /* already disposed */ }
      this.trackPlayer = null;
    }
    if (this.trackVolume) {
      try { this.trackVolume.dispose(); } catch (e) { /* already disposed */ }
      this.trackVolume = null;
    }
    this.audioTrackRaw = null;
  }

  /** Raw bytes + original filename of the currently loaded backing track, if any. */
  public getAudioTrackRaw(): { blob: Blob; name: string } | null {
    return this.audioTrackRaw;
  }

  public setAudioTrackMuted(muted: boolean) {
    if (this.trackVolume) this.trackVolume.mute = muted;
  }

  public async init() {
    if (this.isInitialized) return;

    // Start loading the English pronunciation dictionary in parallel with audio
    // context setup below — both need to finish before playback, but neither
    // blocks the other.
    const dictPromise = preloadCmuDictionary();
    
    // Context is already bound at module load time (see top of this file) —
    // Transport was born on `dedicatedNativeContext`, so there is no clock
    // mismatch to work around here, and no need to unwrap anything from
    // Tone's internals. Tone.start() just resumes the (already-correct)
    // context on this user gesture.
    await Tone.start();
    this.nativeContext = dedicatedNativeContext;

    // Build the fallback synth graph (PolySynth -> filter -> effectChain ->
    // destination) only now that the context is guaranteed running.
    this.buildSynthGraph();

    if (this.nativeContext && this.nativeContext.audioWorklet) {
      try {
        await this.nativeContext.audioWorklet.addModule(processorUrl);
        console.log("Formant-Preserving AudioWorklet Loaded Successfully");
        this.workletReady = true;
      } catch (e: any) {
        console.warn("Failed to load Formant-Preserving AudioWorklet module:", e.message || e);
        this.workletReady = false;
      }
    } else {
      this.workletReady = false;
    }

    Tone.Transport.PPQ = 480; 
    await dictPromise;
    console.log("Audio Engine Ready");
    this.isInitialized = true;
  }

  private parseSyllables(word: string): string[] {
    if (!word) return ["a"];
    const cleanWord = word.replace(/\s+/g, "");
    const regex = /([^aeiouy]*[aeiouy]+|[^aeiouy]+$)/gi;
    const matches = cleanWord.match(regex);
    if (!matches) return [word];
    return matches.map(s => s.toLowerCase().trim()).filter(s => s.length > 0);
  }

  public async togglePlayback(notes: Note[], bpm: number, isPlaying: boolean) {
    if (!this.isInitialized) {
      await this.init();
    }
    
    if (isPlaying) {
      this.stop();
      return false;
    } else {
      await this.ensureAudioContextRunning();

      Tone.Transport.stop();
      Tone.Transport.cancel(0);

      Tone.Transport.bpm.value = bpm;

      if (this.trackPlayer) {
        try {
          // A synced Player retains internal "started" state across
          // Transport.stop()/cancel() cycles. Calling start(0) a second
          // time without stopping it first can throw ("Start time must be
          // strictly greater than previous start time"), which — since
          // nothing downstream was in a try/catch — silently aborted the
          // rest of this function before notes.forEach() and
          // Transport.start() ever ran. That produced exactly "click Play,
          // nothing happens, no error visible unless you check the console".
          if (this.trackPlayer.state === 'started') {
            this.trackPlayer.stop();
          }
          this.trackPlayer.start(0);
        } catch (e) {
          console.error('Failed to start backing track:', e instanceof Error ? e.message : e);
        }
      }

      notes.forEach((note) => {
        this.scheduleLyricTicks(note.pitch, note.lyric, note.velocity, note.startTick, note.durationTick, note.formant || 1.0);
      });

      // Explicitly pass the freshly-read current time instead of calling
      // Transport.start() bare. After the browser auto-suspends the
      // AudioContext during a period of silence (a real power-saving
      // behavior, and one this app was especially prone to triggering
      // during earlier silent-Play bugs) and it's later resumed here via
      // ensureAudioContextRunning(), Transport's own internal "now"
      // reference can end up stale relative to the context's actual
      // currentTime — schedule() callbacks then compute `time` values
      // that lag the real clock by however long the context was
      // suspended (tens of seconds in testing), which is scheduling notes
      // effectively in the past: nothing audible, no error. Passing
      // Tone.now() explicitly forces Transport to root itself at the
      // context's real current time on every single Play press.
      Tone.Transport.start(Tone.now());
      return true;
    }
  }

  public stop() {
    Tone.Transport.stop();
    Tone.Transport.cancel();
    this.synth.releaseAll();
    
    // Stop all custom players safely
    this.activeSources.forEach(src => {
      try {
        if (src.env) src.env.triggerRelease(Tone.now());
        if (src.cPlayer) src.cPlayer.stop(Tone.now() + 0.3);
        if (src.vPlayer) src.vPlayer.stop(Tone.now() + 0.3);
        
        setTimeout(() => {
          try {
            if (src.cPlayer) src.cPlayer.dispose();
            if (src.vPlayer) src.vPlayer.dispose();
            if (src.env) src.env.dispose();
            if (src.volNode) src.volNode.dispose();
          } catch(e){}
        }, 1000);
      } catch(e) {}
    });
    this.activeSources = [];
  }

  /**
   * Resumes the AudioContext if suspended. Must be called synchronously-ish
   * from within a real user gesture (click handler) — browsers only honor
   * resume()/Tone.start() when called close to an actual click/keypress.
   * Every public method that can produce audible output calls this first;
   * previously only togglePlayback() did, which meant piano-roll preview
   * clicks (playNote) fired silently against a still-suspended context.
   */
  private async ensureAudioContextRunning() {
    if (this.nativeContext && this.nativeContext.state === 'suspended') {
      await this.nativeContext.resume();
    }
    await Tone.start();
    if (Tone.getContext().state !== 'running') {
      await Tone.getContext().resume();
    }
    // Some browsers resolve resume() without actually transitioning the
    // context to 'running' (e.g. transient-activation already spent by the
    // time this promise settles, or the resume request was silently
    // ignored). Previously we trusted the resolved promise and scheduled
    // playback anyway — that produced the exact symptom of "notes get
    // scheduled, nothing audible, and the console prints the suspended
    // warning right after". Fail loudly instead of pretending it worked.
    if (this.nativeContext && this.nativeContext.state !== 'running') {
      throw new Error(
        `AudioContext is still "${this.nativeContext.state}" after a resume attempt. ` +
        `Click Play again — some browsers need a second direct click to actually unlock audio.`
      );
    }
  }

  public async playNote(pitch: number, lyric: string = "a", velocity: number = 100) {
    if (!this.isInitialized) {
      await this.init();
    }
    await this.ensureAudioContextRunning();
    this.playSyllablesInternal(pitch, lyric, velocity, undefined, 0.5);
  }

  private getAliasSample(alias: string): UtauSample | undefined {
    // 1. Exact Name
    if (this.voicebank.has(alias)) return this.voicebank.get(alias);
    
    // 2. Hiragana Fallback (for JP)
    const hiragana = romajiToHiraganaMap[alias.toLowerCase()];
    if (hiragana && this.voicebank.has(hiragana)) return this.voicebank.get(hiragana);

    // 3. X-SAMPA Translation for English Phonemes
    if (this.isXSampa) {
      const parts = alias.split(' ');
      let variations: string[][] = [[]];

      for (const part of parts) {
        if (part === '-') {
          variations.forEach(v => v.push('-'));
        } else {
          const cleanPart = part.toLowerCase().trim();
          const xsampaOptions = arpabetToXSampa[cleanPart] || [part];
          const newVariations: string[][] = [];
          for (const option of xsampaOptions) {
            for (const v of variations) {
              newVariations.push([...v, option]);
            }
          }
          variations = newVariations;
        }
      }

      const possibleAliases = variations.map(v => v.join(' '));
      for (const translatedAlias of possibleAliases) {
          if (this.voicebank.has(translatedAlias)) {
            console.log(`[ALIAS LOOKUP] '${alias}' -> HIT '${translatedAlias}' (tried: ${possibleAliases.join(', ')})`);
            return this.voicebank.get(translatedAlias);
          }
      }
      console.log(`[ALIAS LOOKUP] '${alias}' -> MISS (tried: ${possibleAliases.join(', ')})`);
    }

    // 4. Common Spelling Normalizations 
    if (this.useCustomVoice) {
      for (const [key, val] of this.voicebank.entries()) {
        if (key.toLowerCase() === alias.toLowerCase() || 
            (hiragana && key.includes(hiragana)) || 
            key.includes(alias)) {
          console.log(`[ALIAS LOOKUP] '${alias}' -> HIT via loose substring match '${key}'`);
          return val;
        }
      }
    }
    console.log(`[ALIAS LOOKUP] '${alias}' -> TOTAL MISS, will fall back to synth`);
    return undefined;
  }

  private scheduleLyric(pitch: number, lyric: string, velocity: number, startTime: number, duration: number, useTransport: boolean = false, formant: number = 1.0) {
    const lang = useProjectStore.getState().language;

    let aliasesToPlay: string[] = [];

    if (lang === 'EN') {
      const phonemes = parseEnglishToPhonemes(lyric);
      aliasesToPlay = buildCVVCAliases(phonemes);
      // Dynamic fallback for EN: if exact CVVC alias not found, just use the raw phonemes
      let usableAliases: string[] = [];
      aliasesToPlay.forEach(alias => {
        if (this.getAliasSample(alias)) {
          usableAliases.push(alias);
        } else {
          // Fallback logic
          // If the alias is like '- b' or 'b -', fallback to the core phoneme 'b'
          // If the alias is a transition like 'a b', fallback to 'a' and 'b'
          const parts = alias.split(' ');
          parts.forEach(p => {
             const core = p.replace('-', '').trim();
             if (core) usableAliases.push(core);
          });
        }
      });
      // Deduplicate continuous same phonemes roughly
      aliasesToPlay = usableAliases.filter((a, i, arr) => i === 0 || a !== arr[i - 1]);
    } else {
      aliasesToPlay = this.parseSyllables(lyric);
    }
    
    if (aliasesToPlay.length === 0) aliasesToPlay = ["a"];

    console.log(`Scheduling for word '${lyric}':`, aliasesToPlay);

    const subDur = duration / aliasesToPlay.length;
    aliasesToPlay.forEach((alias, index) => {
      const subStartTime = startTime + (index * subDur);
      
      let preSec = 0;
      const sample = this.getAliasSample(alias);
      if (this.useCustomVoice && sample) {
        preSec = sample.oto.preutterance / 1000;
      }
      
      if (useTransport) {
        let shiftTransport = subStartTime - preSec;
        if (shiftTransport < 0) shiftTransport = 0;

        Tone.Transport.schedule((time) => {
          this.triggerNoteInternal(pitch, alias, velocity, time + preSec, subDur, formant);
        }, shiftTransport);
      } else {
        this.triggerNoteInternal(pitch, alias, velocity, subStartTime, subDur, formant);
      }
    });
  }

  private scheduleLyricTicks(pitch: number, lyric: string, velocity: number, startTick: number, durationTick: number, formant: number = 1.0) {
    lyric = lyric.trim();
    if (!lyric) return;

    let aliasesToPlay: string[] = [];
    const lang = useProjectStore.getState().language;
    
    if (lang === 'EN') {
      const phonemes = parseEnglishToPhonemes(lyric);
      aliasesToPlay = buildCVVCAliases(phonemes);
      let usableAliases: string[] = [];
      aliasesToPlay.forEach(alias => {
        if (this.getAliasSample(alias)) {
          usableAliases.push(alias);
        } else {
          const parts = alias.split(' ');
          parts.forEach(p => {
             const core = p.replace('-', '').trim();
             if (core) usableAliases.push(core);
          });
        }
      });
      aliasesToPlay = usableAliases.filter((a, i, arr) => i === 0 || a !== arr[i - 1]);
    } else {
      aliasesToPlay = this.parseSyllables(lyric);
    }
    
    if (aliasesToPlay.length === 0) aliasesToPlay = ["a"];

    console.log(`Scheduling for word '${lyric}':`, aliasesToPlay);

    // Splitting the note's total duration equally across every CVVC alias
    // (including brief consonant/transition aliases) can produce segments
    // a few tens of milliseconds long on short notes — audibly nothing, and
    // for the granular worklet specifically, shorter than its ~68ms warm-up.
    // Floor each segment at a minimum audible length; this can make the
    // sum of segments exceed the note's nominal duration on very short/
    // heavily-multi-phoneme notes, which is the correct trade-off (a note
    // that's audible but slightly late-ending beats one that's silent).
    const currentBpmForFloor = Tone.Transport.bpm.value;
    const ticksPerSecondForFloor = (currentBpmForFloor / 60) * Tone.Transport.PPQ;
    const MIN_SEGMENT_SECONDS = 0.09;
    const minSegmentTicks = MIN_SEGMENT_SECONDS * ticksPerSecondForFloor;
    const subDurTick = Math.max(durationTick / aliasesToPlay.length, minSegmentTicks);
    aliasesToPlay.forEach((alias, index) => {
      const subStartTick = startTick + (index * subDurTick);
      
      let preSec = 0;
      const sample = this.getAliasSample(alias);
      if (this.useCustomVoice && sample) {
        preSec = sample.oto.preutterance / 1000;
      }
      
      const currentBpm = Tone.Transport.bpm.value;
      const ticksPerBeat = Tone.Transport.PPQ;
      const ticksPerSecond = (currentBpm / 60) * ticksPerBeat;
      const preUtteranceTicks = preSec * ticksPerSecond;

      let shiftTransportTicks = subStartTick - preUtteranceTicks;
      if (shiftTransportTicks < 0) shiftTransportTicks = 0;

      Tone.Transport.schedule((time) => {
        // Calculate duration dynamically based on current BPM
        const currentBpmNow = Tone.Transport.bpm.value;
        const ticksPerSecondNow = (currentBpmNow / 60) * ticksPerBeat;
        const subDurSecs = subDurTick / ticksPerSecondNow;
        
        this.triggerNoteInternal(pitch, alias, velocity, time + preSec, subDurSecs, formant);
      }, `${shiftTransportTicks}i`);
    });
  }

  private playSyllablesInternal(pitch: number, lyric: string, velocity: number, time?: number, duration?: number, formant: number = 1.0) {
    const baseTime = time !== undefined ? time : Tone.now();
    const dur = duration !== undefined ? duration : 0.5;
    this.scheduleLyric(pitch, lyric, velocity, baseTime, dur, false, formant);
  }

  private triggerNoteInternal(pitch: number, lyric: string, velocity: number, time?: number, duration?: number, formant: number = 1.0) {
    this.triggerNoteWithFormant(pitch, lyric, velocity, formant, time, duration);
  }

  private triggerNoteWithFormant(pitch: number, lyric: string, velocity: number, formant: number, time?: number, duration?: number) {
    const vel = Math.max(0, Math.min(1, velocity / 127));
    let sample = this.getAliasSample(lyric);
    const isDirectPlay = time === undefined;
    
    let preSec = 0;
    if (this.useCustomVoice && sample) {
      preSec = sample.oto.preutterance / 1000;
    }
    
    // If scheduling directly via UI click, add a tiny lookahead + preutterance so we don't schedule in the past
    const startTime = !isDirectPlay ? time : Tone.now() + preSec + 0.05;

    if (this.useCustomVoice && sample) {
      const { buffer, oto } = sample;
      const shiftSemis = pitch - this.baseMidi;
      const detuneCents = shiftSemis * 100;
      
      // OTO Parse calculations (ms to seconds)
      let offsetSec = oto.offset / 1000;
      let consonantSec = oto.consonant / 1000;
      let preutteranceSec = oto.preutterance / 1000;
      let overlapSec = oto.overlap / 1000;
      
      let cutoffSec = oto.cutoff < 0 ? 
        buffer.duration + (oto.cutoff / 1000) : 
        (oto.cutoff > 0 ? (oto.offset + oto.cutoff) / 1000 : buffer.duration);
        
      // Safeties to prevent invalid audio bounds
      if (consonantSec <= 0) consonantSec = 0.05;
      if (offsetSec >= buffer.duration) offsetSec = 0;
      if (cutoffSec <= offsetSec + consonantSec) cutoffSec = Math.min(buffer.duration, offsetSec + consonantSec + 0.1);
      
      const vowelStart = offsetSec + consonantSec;
      const vowelEnd = cutoffSec;
      const actualStartTime = startTime - preutteranceSec;
      
      const pitchRatio = Math.pow(2, shiftSemis / 12);
      const userFormant = formant;

      let sourceObj: any;

      // Diagnostic bypass: ?bypassFormant=1 in the URL skips the
      // AudioWorkletNode entirely and routes straight to the destination.
      // If sound IS heard during Play with this flag on, the worklet is the
      // culprit under concurrent multi-note load. If it's STILL silent,
      // the bug is upstream of the worklet (players/envelope/connection
      // graph itself), not the DSP code. One build, two test conditions,
      // no further guessing needed to isolate which half of the pipeline
      // is at fault.
      const bypassFormant = typeof window !== 'undefined' &&
        new URLSearchParams(window.location.search).get('bypassFormant') === '1';

      if (bypassFormant) {
        const consonantPlayer = new Tone.Player(buffer);
        const vowelPlayer = new Tone.Player({ url: buffer, loop: true, loopStart: vowelStart, loopEnd: vowelEnd });
        const tightOverlap = Math.min(0.03, overlapSec > 0 ? overlapSec : 0.01);
        const env = new Tone.AmplitudeEnvelope({ attack: tightOverlap, decay: 0, sustain: 1, release: 0.1 });
        const volNode = new Tone.Volume(Tone.gainToDb(vel)).connect(Tone.getDestination());
        consonantPlayer.disconnect();
        vowelPlayer.disconnect();
        consonantPlayer.connect(env);
        vowelPlayer.connect(env);
        env.connect(volNode);

        const noteDur = duration || 0.5;
        const vowelStartTime = actualStartTime + consonantSec;
        let vowelDuration = noteDur - (consonantSec - preutteranceSec);
        if (vowelDuration < 0.08) vowelDuration = 0.08;

        consonantPlayer.start(actualStartTime, offsetSec, consonantSec);
        vowelPlayer.start(vowelStartTime, vowelStart);
        env.triggerAttack(actualStartTime);
        env.triggerRelease(vowelStartTime + vowelDuration);
        consonantPlayer.stop(vowelStartTime + 0.1);
        vowelPlayer.stop(vowelStartTime + vowelDuration + 0.3);

        const cleanupDelayMs = ((vowelStartTime + vowelDuration + 1.0) - Tone.now()) * 1000;
        setTimeout(() => {
          try { consonantPlayer.dispose(); vowelPlayer.dispose(); env.dispose(); volNode.dispose(); } catch (e) {}
        }, Math.max(0, cleanupDelayMs));

        return;
      }

      if (this.workletReady && this.nativeContext) {
        try {
          // Ensure context is running - critical for AudioWorklet
          if (this.nativeContext.state === 'suspended') {
            this.nativeContext.resume();
          }

          const workletNode = new AudioWorkletNode(this.nativeContext, 'formant-processor', {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            parameterData: {
              pitchRatio: pitchRatio,
              formantShift: userFormant
            }
          });

          // AudioWorkletNode processor crashes (an uncaught throw inside
          // process()) are otherwise completely silent — no console output,
          // no rejected promise, nothing. This is the only way to find out
          // if that's what's happening.
          workletNode.onprocessorerror = (event) => {
            console.error('[FormantProcessor] worklet processor crashed:', event);
          };

          console.log(
            `[triggerNoteWithFormant] lyric='${lyric}' contextTime=${this.nativeContext.currentTime.toFixed(3)} ` +
            `actualStartTime=${actualStartTime.toFixed(3)} pitchRatio=${pitchRatio.toFixed(3)} ` +
            `contextState=${this.nativeContext.state}`
          );

          const consonantPlayer = new Tone.Player(buffer);
          const vowelPlayer = new Tone.Player({
            url: buffer,
            loop: true,
            loopStart: vowelStart,
            loopEnd: vowelEnd,
          });

          // Tighter crossfade for VCCV (max 30ms)
          const tightOverlap = Math.min(0.03, overlapSec > 0 ? overlapSec : 0.01);

          const env = new Tone.AmplitudeEnvelope({
            attack: tightOverlap,
            decay: 0.0,
            sustain: 1.0,
            release: 0.1,
          });

          const volNode = new Tone.Volume(Tone.gainToDb(vel));

          // Strict Routing: Disconnect from destination before manual connection
          consonantPlayer.disconnect();
          vowelPlayer.disconnect();
          
          consonantPlayer.connect(env);
          vowelPlayer.connect(env);
          env.connect(volNode);
          
          // Connect Tone graph into Native Worklet using static connect
          Tone.connect(volNode, workletNode);
          
          // Route through Tone.getDestination() (a Gain/Volume node Tone
          // manages) rather than nativeContext.destination directly. The
          // previous direct routing was a leftover from an earlier debugging
          // session and meant the master volume/mute control added later
          // had literally zero effect on this path — the primary one, since
          // this is what plays whenever the worklet is available. Master
          // volume only ever reached the rare fallback paths (GrainPlayer,
          // plain synth), which do route through Tone.getDestination() via
          // effectChain. Tone.connect() here is the correct interop helper
          // for wiring a raw native AudioWorkletNode into a Tone-managed
          // node graph.
          Tone.connect(workletNode, Tone.getDestination());

          sourceObj = { 
            cPlayer: consonantPlayer, 
            vPlayer: vowelPlayer,
            env: env, 
            volNode: volNode,
            worklet: workletNode
          };

          this.activeSources.push(sourceObj);

          const noteDur = duration || 0.5;
          const vowelStartTime = actualStartTime + consonantSec;
          let vowelDuration = noteDur - (consonantSec - preutteranceSec);
          // 0.01s (10ms) was the previous floor here — inaudible on its own,
          // and shorter than the worklet's grain size, so it produced
          // effectively nothing. This is the actual reason "aku" was still
          // silent even after the earlier duration-floor fix: that fix
          // floored the *total* segment length, but consonantSec alone
          // (up to ~150ms from this voicebank's oto.ini) was eating the
          // whole budget before vowelDuration was computed, leaving this
          // line to clamp it right back down to 10ms regardless.
          const MIN_VOWEL_SECONDS = 0.08;
          if (vowelDuration < MIN_VOWEL_SECONDS) vowelDuration = MIN_VOWEL_SECONDS;

          console.log(
            `[triggerNoteWithFormant] vowelStartTime=${vowelStartTime.toFixed(3)} vowelDuration=${vowelDuration.toFixed(3)} ` +
            `bufferDuration=${buffer.duration.toFixed(3)} offsetSec=${offsetSec.toFixed(3)} consonantSec=${consonantSec.toFixed(3)}`
          );

          consonantPlayer.start(actualStartTime, offsetSec, consonantSec);
          vowelPlayer.start(vowelStartTime, vowelStart);

          env.triggerAttack(actualStartTime);
          env.triggerRelease(vowelStartTime + vowelDuration);

          consonantPlayer.stop(vowelStartTime + 0.1);
          vowelPlayer.stop(vowelStartTime + vowelDuration + 0.3);

          const cleanupDelayMs = ((vowelStartTime + vowelDuration + 1.0) - Tone.now()) * 1000;
          setTimeout(() => {
            try {
              consonantPlayer.dispose();
              vowelPlayer.dispose();
              env.dispose();
              volNode.dispose();
              workletNode.disconnect();
              this.activeSources = this.activeSources.filter(s => s !== sourceObj);
            } catch(e) {}
          }, Math.max(0, cleanupDelayMs));
        } catch (err: any) {
          console.error("Worklet creation failed:", err.message || "Unknown error", err.name || "");
          this.executeFallbackTrigger(buffer, vel, actualStartTime, offsetSec, consonantSec, vowelStart, vowelEnd, overlapSec, shiftSemis, pitchRatio, userFormant, duration, preutteranceSec);
        }
      } else {
        // Fallback to GrainPlayer
        this.executeFallbackTrigger(buffer, vel, actualStartTime, offsetSec, consonantSec, vowelStart, vowelEnd, overlapSec, shiftSemis, pitchRatio, userFormant, duration, preutteranceSec);
      }
      
    } else {
      // Fallback Synth Behavior
      if (this.useCustomVoice) {
          console.warn(`Lyric '${lyric}' not found in voicebank. Falling back to synth.`);
      }
      const freq = Tone.Frequency(pitch, "midi").toNote();
      if (time !== undefined) {
        this.synth.triggerAttackRelease(freq, duration || "8n", time, vel);
      } else {
        this.synth.triggerAttackRelease(freq, duration || "8n", undefined, vel);
      }
    }
  }

  private executeFallbackTrigger(
    buffer: Tone.ToneAudioBuffer,
    vel: number,
    actualStartTime: number,
    offsetSec: number,
    consonantSec: number,
    vowelStart: number,
    vowelEnd: number,
    overlapSec: number,
    shiftSemis: number,
    pitchRatio: number,
    userFormant: number,
    duration?: number,
    preutteranceSec: number = 0
  ) {
    const grainSize = 0.08;
    const grainOverlap = 0.04;
    const detuneCents = shiftSemis * 100;

    // GrainPlayer's `detune` speeds up each grain's internal playback to
    // achieve pitch shift (it is not true time-domain pitch shifting).
    // At higher pitchRatio, more grains complete within the same grainSize/
    // overlap window, so more of them sum together — loudness climbs with
    // pitch instead of staying constant. This is a heuristic compensation,
    // not an exact physical model — listen and retune the exponent if it's
    // over/under-corrected.
    const loudnessCompensation = 1 / Math.max(1, Math.sqrt(pitchRatio));
    const compensatedVel = vel * loudnessCompensation;

    const consonantPlayer = new Tone.GrainPlayer({
      url: buffer,
      detune: detuneCents,
      grainSize: grainSize,
      overlap: grainOverlap,
      playbackRate: 1,
    });

    const vowelPlayer = new Tone.GrainPlayer({
      url: buffer,
      detune: detuneCents,
      grainSize: grainSize,
      overlap: grainOverlap,
      playbackRate: 1,
      loop: true,
      loopStart: vowelStart,
      loopEnd: vowelEnd,
    });

    const tightOverlap = Math.min(0.03, overlapSec > 0 ? overlapSec : 0.01);

    const env = new Tone.AmplitudeEnvelope({
      attack: tightOverlap,
      decay: 0.0,
      sustain: 1.0,
      release: 0.1,
    });
    
    const volNode = new Tone.Volume(Tone.gainToDb(compensatedVel));

    consonantPlayer.disconnect();
    vowelPlayer.disconnect();

    consonantPlayer.connect(env);
    vowelPlayer.connect(env);
    env.chain(volNode, this.effectChain);
    
    const sourceObj = { 
      cPlayer: consonantPlayer, 
      vPlayer: vowelPlayer,
      env: env, 
      volNode: volNode 
    };
    
    this.activeSources.push(sourceObj);

    const noteDur = duration || 0.5;
    const vowelStartTime = actualStartTime + consonantSec;
    let vowelDuration = noteDur - (consonantSec - preutteranceSec);
    if (vowelDuration < 0.08) vowelDuration = 0.08;

    consonantPlayer.start(actualStartTime, offsetSec, consonantSec);
    vowelPlayer.start(vowelStartTime, vowelStart);

    if (shiftSemis > 0) {
      const correctionRatio = 1 / pitchRatio;
      consonantPlayer.grainSize = Math.max(0.01, grainSize * correctionRatio * userFormant);
      vowelPlayer.grainSize = Math.max(0.01, grainSize * correctionRatio * userFormant);
    }

    env.triggerAttack(actualStartTime);
    env.triggerRelease(vowelStartTime + vowelDuration);

    consonantPlayer.stop(vowelStartTime + 0.1);
    vowelPlayer.stop(vowelStartTime + vowelDuration + 0.3);

    const cleanupDelayMs = ((vowelStartTime + vowelDuration + 1.0) - Tone.now()) * 1000;
    setTimeout(() => {
      try {
        consonantPlayer.dispose();
        vowelPlayer.dispose();
        env.dispose();
        volNode.dispose();
        this.activeSources = this.activeSources.filter(s => s !== sourceObj);
      } catch(e) {}
    }, Math.max(0, cleanupDelayMs));
  }
}

export const audioEngine = new AudioEngine();