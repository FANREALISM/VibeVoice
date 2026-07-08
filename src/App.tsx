import React from 'react';
import { useAuth } from './hooks/useAuth';
import { LoginScreen } from './components/LoginScreen';
import { Music, Play, Square, Save, User as UserIcon, LogOut, Loader2, Pause, Download, Upload } from 'lucide-react';
import { useProjectStore } from './store/useProjectStore';
import { PianoRoll } from './components/PianoRoll';
import { Inspector } from './components/Inspector';
import { audioEngine } from './engine/AudioEngine';
import { exportProjectAsZip, importProjectFromZip } from './utils/projectIO';
import * as Tone from 'tone';

export default function App() {
  const { user, loading, logout } = useAuth();
  const { title, isDirty, saveProject, id, isPlaying, setIsPlaying, notes, bpm, setBpm, isLoadingVoicebank, setIsLoadingVoicebank, audioTrackName, setAudioTrackName, audioTrackMuted, setAudioTrackMuted, isLoadingAudioTrack, setIsLoadingAudioTrack } = useProjectStore();
  const [isEngineStarted, setIsEngineStarted] = React.useState(false);
  const [isStartingEngine, setIsStartingEngine] = React.useState(false);
  const [isExportingProject, setIsExportingProject] = React.useState(false);
  const [isImportingProject, setIsImportingProject] = React.useState(false);
  const projectFileInputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    Tone.Transport.bpm.value = bpm;
  }, [bpm]);

  const handleStartEngine = async () => {
    setIsStartingEngine(true);
    try {
      await audioEngine.init();
      setIsEngineStarted(true);
    } catch (e) {
      console.error(e instanceof Error ? e.message : String(e));
    } finally {
      setIsStartingEngine(false);
    }
  };

  const handlePlayToggle = async () => {
    // Engine init still gated here (first-ever interaction only) — the
    // actual AudioContext resume now happens exactly once, inside
    // audioEngine.togglePlayback(). Duplicating the resume sequence here
    // too (as before) added several extra await hops before playback ever
    // got scheduled, for no benefit.
    if (!isEngineStarted) {
      await handleStartEngine();
    }

    try {
      const newState = await audioEngine.togglePlayback(notes, bpm, isPlaying);
      setIsPlaying(newState);
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      alert(err instanceof Error ? err.message : 'Playback failed to start — try clicking Play again.');
    }
  };

  const handleStop = () => {
    audioEngine.stop();
    setIsPlaying(false);
  };

  const handleExportProject = async () => {
    setIsExportingProject(true);
    try {
      await exportProjectAsZip();
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      alert("Failed to export project.");
    } finally {
      setIsExportingProject(false);
    }
  };

  const handleImportProjectFile = async (file: File) => {
    setIsImportingProject(true);
    try {
      await importProjectFromZip(file);
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      alert(err instanceof Error ? err.message : "Failed to import project.");
    } finally {
      setIsImportingProject(false);
    }
  };

  React.useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') {
        return;
      }

      // Holding a key down fires repeated keydown events at the OS's
      // auto-repeat rate (roughly every 20-60ms once repeat kicks in).
      // Without this guard, holding spacebar even slightly past a quick
      // tap called togglePlayback() many times in rapid succession — each
      // call toggles Play<->Stop, cancelling and rescheduling every note
      // via Transport.cancel(). If the key happened to be released on an
      // odd/even repeat, playback could land back in "stopped" milliseconds
      // after starting, which looked exactly like "pressed Play, still
      // doesn't play" even though every individual toggle was working
      // correctly in isolation. e.repeat is true on all but the first
      // keydown of a hold, so this only blocks the auto-repeated ones.
      if (e.repeat) return;

      if (e.code === 'Space') {
        e.preventDefault();
        try {
          const newState = await audioEngine.togglePlayback(notes, bpm, isPlaying);
          setIsPlaying(newState);
        } catch (err) {
          console.error(err instanceof Error ? err.message : String(err));
        }
      } else if ((e.code === 'Delete' || e.code === 'Backspace')) {
        const selectedIds = useProjectStore.getState().selectedNoteIds;
        if (selectedIds.length > 0) {
          e.preventDefault();
          useProjectStore.getState().deleteNotes(selectedIds);
        }
      } else if (e.code === 'KeyZ' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (e.shiftKey) {
          useProjectStore.getState().redo();
        } else {
          useProjectStore.getState().undo();
        }
      } else if (e.code === 'KeyY' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        useProjectStore.getState().redo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [notes, bpm, isPlaying, setIsPlaying]);

  if (loading) {
    return (
      <div className="h-screen w-screen bg-daw-bg flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-daw-accent animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <LoginScreen />;
  }

  if (!isEngineStarted) {
    return (
      <div className="h-screen w-screen bg-daw-bg flex flex-col items-center justify-center text-zinc-300 font-sans p-8">
        <div className="flex items-center gap-2 mb-6">
          <div className="w-8 h-8 bg-[#06b6d4] rounded flex items-center justify-center shadow-[0_0_15px_rgba(6,182,212,0.6)]">
            <div className="w-2 h-4 bg-white rotate-[15deg] rounded-full"></div>
          </div>
          <span className="text-white font-black tracking-tighter text-3xl">VIBEVOICE</span>
        </div>
        <p className="text-zinc-400 mb-8 max-w-md text-center">
          Vibevoice requires your permission to start the audio engine and parse voicebanks.
        </p>
        <button 
          onClick={handleStartEngine}
          disabled={isStartingEngine}
          className="bg-[#06b6d4] hover:bg-[#0891b2] text-black font-bold py-3 px-8 rounded-lg shadow-[0_0_20px_rgba(6,182,212,0.4)] hover:shadow-[0_0_30px_rgba(6,182,212,0.6)] transition-all flex items-center gap-2 hover:scale-105 disabled:opacity-50 disabled:pointer-events-none"
        >
          {isStartingEngine ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <Play className="w-5 h-5" fill="currentColor" />
          )}
          {isStartingEngine ? 'Starting Engine...' : 'Initialize Audio Engine'}
        </button>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen bg-daw-bg text-zinc-300 flex flex-col overflow-hidden font-sans select-none">
      {/* Top Header/Toolbar */}
      <header className="h-14 border-b border-zinc-800/50 bg-daw-surface flex items-center justify-between px-4 z-50">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2 cursor-pointer group">
            <div className="w-6 h-6 bg-[#06b6d4] rounded flex items-center justify-center shadow-[0_0_15px_rgba(6,182,212,0.6)]">
              <div className="w-1.5 h-3 bg-white rotate-[15deg] rounded-full"></div>
            </div>
            <span className="text-white font-black tracking-tighter text-xl">VIBEVOICE</span>
            <span className="bg-zinc-800 text-[9px] px-1.5 py-0.5 rounded text-zinc-400 font-bold ml-1 tracking-widest hidden sm:inline-block">PRO</span>
          </div>
          
          <div className="h-6 w-px bg-zinc-800" />
          
          <div className="flex items-center gap-4 text-sm font-medium">
            <div className="flex items-center gap-2">
              <input 
                value={title}
                onChange={(e) => useProjectStore.getState().setTitle(e.target.value)}
                className="bg-transparent border-none focus:ring-0 text-sm font-medium text-zinc-100 w-48 outline-none"
              />
              {isDirty && (
                <div className="w-2 h-2 rounded-full bg-daw-accent shadow-[0_0_8px_rgba(6,182,212,0.8)]" title="Unsaved changes" />
              )}
            </div>
            <div className="hidden md:flex gap-1 text-[10px] text-zinc-500">
              <span className="cursor-pointer hover:text-zinc-300">File</span>
              <span className="cursor-pointer hover:text-zinc-300">Edit</span>
              <span className="cursor-pointer hover:text-zinc-300">View</span>
              <span className="cursor-pointer hover:text-zinc-300">Engine</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center bg-black/40 rounded-lg p-1 border border-zinc-800">
            <button onClick={handlePlayToggle} className="px-3 py-1.5 hover:text-white transition-colors">
              {isPlaying ? <Pause className="w-4 h-4" fill="currentColor" /> : <Play className="w-4 h-4" fill="currentColor" />}
            </button>
            <button onClick={handleStop} className={`px-3 py-1.5 ${isPlaying ? 'text-red-500 hover:text-red-400' : 'text-zinc-500 hover:text-zinc-400'}`}>
              <div className="w-3 h-3 bg-current rounded-sm shadow-[0_0_8px_rgba(239,68,68,0.4)]"></div>
            </button>
            <div className="h-4 w-px bg-zinc-800 mx-1" />
            <div className="px-3 font-mono text-xs hidden sm:block">
              <span className="text-[#06b6d4]">01 : 04 : 22</span>
            </div>
            <div className="h-4 w-px bg-zinc-800 mx-1 hidden sm:block" />
            <button
              onClick={handleExportProject}
              disabled={isExportingProject}
              title="Export Project (.zip)"
              className={`px-3 py-1.5 transition-colors text-zinc-500 hover:text-zinc-300 ${isExportingProject ? 'opacity-50 pointer-events-none' : ''}`}
            >
              {isExportingProject ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            </button>
            <button
              onClick={() => projectFileInputRef.current?.click()}
              disabled={isImportingProject}
              title="Import Project (.zip)"
              className={`px-3 py-1.5 transition-colors text-zinc-500 hover:text-zinc-300 ${isImportingProject ? 'opacity-50 pointer-events-none' : ''}`}
            >
              {isImportingProject ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            </button>
            <input
              ref={projectFileInputRef}
              type="file"
              accept=".zip,application/zip"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (file) {
                  await handleImportProjectFile(file);
                }
                e.target.value = '';
              }}
            />
            <button 
              onClick={() => saveProject(user.id)}
              title="Save to Cloud"
              className={`px-3 py-1.5 transition-colors ${isDirty ? 'text-daw-accent' : 'text-zinc-500 hover:text-zinc-300'}`}
            >
              <Save className="w-4 h-4" />
            </button>
          </div>
          
          <div className="hidden lg:flex text-xs font-mono text-zinc-500 bg-black/30 px-2 py-1.5 rounded-md border border-zinc-800 items-center justify-center group focus-within:border-[#06b6d4]/50 focus-within:ring-1 focus-within:ring-[#06b6d4]/50 transition-all">
            <input 
              type="number"
              min="20"
              max="300"
              value={bpm}
              onChange={(e) => {
                const val = parseInt(e.target.value);
                if (!isNaN(val)) setBpm(val);
              }}
              className="bg-transparent w-12 text-center text-zinc-300 outline-none appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            <span className="text-[9px] text-zinc-600 mt-0.5 pointer-events-none group-focus-within:text-[#06b6d4]">BPM</span>
          </div>

          <div className="flex items-center gap-3 ml-2 bg-daw-sidebar px-3 py-1.5 rounded-full border border-zinc-800">
            <div className="w-5 h-5 rounded-full bg-zinc-800 flex items-center justify-center overflow-hidden border border-daw-border">
              {user.user_metadata?.avatar_url ? (
                <img src={user.user_metadata.avatar_url} alt="User" />
              ) : (
                <UserIcon className="w-3 h-3 text-zinc-400" />
              )}
            </div>
            <span className="text-xs font-medium text-zinc-300 truncate max-w-[100px] hidden md:block">
              {user.email}
            </span>
            <button 
              onClick={() => logout()}
              className="text-zinc-600 hover:text-red-400 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Workspace */}
      <main className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <aside className="w-56 border-r border-zinc-800/80 bg-daw-sidebar hidden md:flex flex-col">
          <div className="p-4 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em]">Voicebank</span>
              <div className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_5px_rgba(34,197,94,0.5)]"></div>
            </div>
            
            <div className="bg-[#1a1a21] border border-[#06b6d4]/30 p-3 rounded-lg shadow-lg relative overflow-hidden group">
              <div className="absolute top-0 right-0 w-16 h-16 bg-[#06b6d4]/5 rounded-full -mr-8 -mt-8"></div>
              <div className="text-sm font-bold text-white relative z-10 flex justify-between items-center">
                <span>DEFOKO_V2</span>
                <label className={`cursor-pointer bg-[#06b6d4] text-black text-[10px] px-2 py-1 rounded shadow hover:bg-[#0891b2] transition-colors ${isLoadingVoicebank ? 'opacity-50 pointer-events-none' : ''}`}>
                  {isLoadingVoicebank ? 'Loading...' : 'Import Zip'}
                  <input type="file" accept=".zip,application/zip" className="hidden" disabled={isLoadingVoicebank} onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      setIsLoadingVoicebank(true);
                      try {
                        await audioEngine.loadVoicebank(file);
                        alert("Voicebank loaded! Found samples.");
                      } catch (err) {
                        alert("Failed to load voicebank");
                      } finally {
                        setIsLoadingVoicebank(false);
                      }
                    }
                  }} />
                </label>
              </div>
              <div className="text-[10px] text-zinc-500 mb-2 relative z-10">Custom Voice</div>
              <div className="flex gap-1 relative z-10">
                <div className="h-1 w-full bg-zinc-800 rounded-full overflow-hidden">
                  <div className="w-[85%] h-full bg-[#06b6d4]"></div>
                </div>
              </div>
            </div>

            <div className="bg-[#1a1a21] border border-zinc-700/50 p-3 rounded-lg shadow-lg relative overflow-hidden group">
              <div className="text-sm font-bold text-white flex justify-between items-center">
                <span className="truncate max-w-[110px]" title={audioTrackName || undefined}>
                  {audioTrackName || 'No Audio Track'}
                </span>
                <label className={`cursor-pointer bg-zinc-700 text-white text-[10px] px-2 py-1 rounded shadow hover:bg-zinc-600 transition-colors ${isLoadingAudioTrack ? 'opacity-50 pointer-events-none' : ''}`}>
                  {isLoadingAudioTrack ? 'Loading...' : (audioTrackName ? 'Replace' : 'Import Audio')}
                  <input type="file" accept="audio/*,.wav,.mp3,.ogg,.m4a,.flac" className="hidden" disabled={isLoadingAudioTrack} onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      setIsLoadingAudioTrack(true);
                      try {
                        await audioEngine.loadAudioTrack(file);
                        setAudioTrackName(file.name);
                      } catch (err) {
                        console.error(err instanceof Error ? err.message : String(err));
                        alert("Failed to load audio track. Make sure it's a supported audio format.");
                      } finally {
                        setIsLoadingAudioTrack(false);
                        e.target.value = '';
                      }
                    }
                  }} />
                </label>
              </div>
              <div className="text-[10px] text-zinc-500 mt-1">Backing / Reference Track</div>
              {audioTrackName && (
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={() => {
                      const next = !audioTrackMuted;
                      setAudioTrackMuted(next);
                      audioEngine.setAudioTrackMuted(next);
                    }}
                    className="text-[10px] px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-zinc-300"
                  >
                    {audioTrackMuted ? 'Unmute' : 'Mute'}
                  </button>
                  <button
                    onClick={() => {
                      audioEngine.removeAudioTrack();
                      setAudioTrackName(null);
                    }}
                    className="text-[10px] px-2 py-1 rounded bg-white/5 hover:bg-red-500/20 text-zinc-300 hover:text-red-400"
                  >
                    Remove
                  </button>
                </div>
              )}
            </div>

            <div className="mt-4">
              <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em]">Recent Projects</span>
              <div className="mt-2 space-y-1">
                <div className="text-xs py-2 px-3 bg-white/5 rounded cursor-pointer border-l-2 border-[#06b6d4] transition-all">Night_City_Melody</div>
                <div className="text-xs py-2 px-3 hover:bg-white/5 rounded cursor-pointer border-l-2 border-transparent">Starlight_Chorus</div>
                <div className="text-xs py-2 px-3 hover:bg-white/5 rounded cursor-pointer border-l-2 border-transparent">Test_Phonemes</div>
              </div>
            </div>
          </div>
          
          <div className="mt-auto p-4 border-t border-zinc-800/50">
            <div className="bg-zinc-900/50 p-2 rounded text-[10px] text-zinc-500 font-mono text-center">
              Supabase Connected
              <br/>
              ID: {id?.substring(0, 10) || 'LOCAL_CACHE'}
            </div>
          </div>
        </aside>

        {/* Editor / Piano Roll */}
        <section className="flex-1 bg-[#050507] relative flex flex-col overflow-hidden">
          <PianoRoll />
          
          {/* Status bar overlays */}
          <div className="absolute bottom-4 left-4 flex gap-6 text-[10px] font-bold text-zinc-600 uppercase tracking-tighter z-10 pointer-events-none">
            <span className="bg-black/60 px-2 py-1 rounded backdrop-blur">Grid: 1/16</span>
            <span className="bg-black/60 px-2 py-1 rounded backdrop-blur">Scale: Chromatic</span>
            <span className="bg-[#06b6d4]/20 text-[#06b6d4] px-2 py-1 rounded backdrop-blur">
              Snap: Always
            </span>
          </div>
        </section>

        {/* Right Sidebar: Inspector */}
        <Inspector />
      </main>

      {/* Status Bar */}
      <footer className="h-6 bg-daw-surface border-t border-zinc-800/50 px-4 flex items-center justify-between text-[9px] font-mono text-zinc-500 z-50">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 shadow-[0_0_5px_rgba(34,197,94,0.5)]"></span>
            Engine: Tone.wasm
          </span>
          <span className="hidden sm:inline">Sample Rate: 48kHz</span>
          <span className="hidden sm:inline">Lat: 14.2ms</span>
        </div>
        <div className="flex gap-4">
          <span className="hidden md:inline">X: 1840 | Y: 128</span>
          <span className="text-[#06b6d4]">Cloud Synced</span>
        </div>
      </footer>
    </div>
  );
}