import React, { useState, useEffect } from 'react';
import { useProjectStore } from '../store/useProjectStore';

export const Inspector: React.FC = () => {
  const { notes, selectedNoteIds, updateNote, updateNotes, deleteNotes, language, setLanguage } = useProjectStore();
  
  const [batchLyrics, setBatchLyrics] = useState('');

  const selectedNotes = notes.filter(n => selectedNoteIds.includes(n.id));
  const isMulti = selectedNotes.length > 1;
  const note = selectedNotes.length === 1 ? selectedNotes[0] : null;

  // Local, uncommitted copies of the editable fields. Previously these
  // inputs called updateNote()/updateNotes() directly in onChange, which
  // fires on every keystroke — each call pushes a full snapshot onto the
  // undo stack (see useProjectStore.ts), so typing a 3-letter lyric created
  // 3 undo steps and Ctrl+Z only ever undid the last keystroke. Editing
  // locally and committing once on blur/Enter makes one edit = one undo
  // step, and matches how the batch-rename Apply button already behaves.
  const [localLyric, setLocalLyric] = useState('');
  const [localVelocity, setLocalVelocity] = useState<string>('');
  const [localDuration, setLocalDuration] = useState<string>('');

  useEffect(() => {
    if (!isMulti && note) {
      setLocalLyric(note.lyric);
      setLocalVelocity(String(note.velocity));
      setLocalDuration(String(note.durationTick));
    } else {
      setLocalLyric('');
      setLocalVelocity('');
      setLocalDuration('');
    }
    // Re-sync whenever the selection changes to a different/single note.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMulti, note?.id]);

  const handleBatchApply = () => {
    const tokens = batchLyrics.split(/[\s,]+/).map(t => t.trim()).filter(Boolean);
    if (tokens.length === 0) return;
    
    const sortedSelected = [...selectedNotes].sort((a, b) => a.startTick - b.startTick);
    
    sortedSelected.forEach((n, index) => {
      const lyric = tokens[index % tokens.length];
      updateNote(n.id, { lyric });
    });
  };

  const renderProjectSettings = () => (
    <div className="space-y-4 border-t border-zinc-800/80 pt-4 mt-4 text-white">
      <h4 className="text-[10px] uppercase font-bold text-zinc-500">Project Settings</h4>
      <div className="flex flex-col gap-2">
        <label className="text-[9px] font-bold text-zinc-500 uppercase block">Language / Lexicon</label>
        <div className="flex bg-zinc-900 rounded p-1">
          <button 
            className={`flex-1 py-1 text-[10px] font-bold transition-all ${language === 'JP' ? 'bg-[#06b6d4] text-black shadow-sm' : 'text-zinc-500 hover:text-white'}`}
             onClick={() => setLanguage('JP')}
          >
            Japanese
          </button>
          <button 
             className={`flex-1 py-1 text-[10px] font-bold transition-all ${language === 'EN' ? 'bg-[#06b6d4] text-black shadow-sm' : 'text-zinc-500 hover:text-white'}`}
             onClick={() => setLanguage('EN')}
          >
            English
          </button>
        </div>
      </div>
    </div>
  );

  if (selectedNotes.length === 0) {
    return (
      <aside className="w-64 border-l border-zinc-800/80 bg-[#0f0f13] p-4 flex flex-col gap-6">
        <header>
          <h3 className="text-[#06b6d4] text-[10px] font-black uppercase tracking-[0.2em] mb-1">Note Inspector</h3>
        </header>
        <div className="text-zinc-600 text-xs italic">Select a note to inspect...</div>
        {renderProjectSettings()}
      </aside>
    );
  }

  // Helper to convert MIDI pitch to Note Name (e.g., 60 -> C4)
  const getNoteName = (pitch: number) => {
    const notesStr = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const octave = Math.floor(pitch / 12) - 1;
    const noteName = notesStr[pitch % 12];
    return `${noteName}${octave}`;
  };

  const [localFormant, setLocalFormant] = useState(1.0);
  useEffect(() => {
    setLocalFormant(isMulti ? 1.0 : (note?.formant || 1.0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMulti, note?.id]);

  const commitFormant = (value: number) => {
    if (isMulti) {
      updateNotes(selectedNoteIds, { formant: value });
    } else if (note && value !== (note.formant || 1.0)) {
      updateNote(note.id, { formant: value });
    }
  };

  const commitLyric = () => {
    if (isMulti) {
      if (localLyric === '') return; // placeholder untouched, nothing to commit
      updateNotes(selectedNoteIds, { lyric: localLyric });
    } else if (note && localLyric !== note.lyric) {
      updateNote(note.id, { lyric: localLyric });
    }
  };

  const commitVelocity = () => {
    if (localVelocity === '') return;
    const value = Number(localVelocity);
    if (Number.isNaN(value)) return;
    if (isMulti) {
      updateNotes(selectedNoteIds, { velocity: value });
    } else if (note && value !== note.velocity) {
      updateNote(note.id, { velocity: value });
    }
  };

  const commitDuration = () => {
    if (localDuration === '') return;
    const value = Number(localDuration);
    if (Number.isNaN(value)) return;
    if (isMulti) {
      updateNotes(selectedNoteIds, { durationTick: value });
    } else if (note && value !== note.durationTick) {
      updateNote(note.id, { durationTick: value });
    }
  };

  const handleDelete = () => {
    deleteNotes(selectedNoteIds);
  };

  return (
    <aside className="w-64 border-l border-zinc-800/80 bg-[#0f0f13] p-4 flex flex-col gap-6 z-20">
      <header>
        <h3 className="text-[#06b6d4] text-[10px] font-black uppercase tracking-[0.2em] mb-1">
          {isMulti ? 'Bulk Inspector' : 'Note Inspector'}
        </h3>
        <div className="text-2xl font-light text-white">
          {isMulti ? `${selectedNotes.length} Selected` : (
            <>
              {getNoteName(note!.pitch)} <span className="text-xs text-zinc-500 font-mono">#{note!.id.substring(0, 4)}</span>
            </>
          )}
        </div>
      </header>

      <div className="space-y-4">
        <div>
          <label className="text-[9px] font-bold text-zinc-500 uppercase block mb-1">Smart Lyric Input {isMulti && '(Bulk Replace All)'}</label>
          <input 
            type="text" 
            value={localLyric} 
            placeholder={isMulti ? "(Multiple Lyrics...)" : ""}
            onChange={(e) => setLocalLyric(e.target.value)}
            onBlur={commitLyric}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            className="w-full bg-black/50 border border-zinc-800 rounded px-3 py-2 text-sm text-[#06b6d4] outline-none ring-1 ring-zinc-800 focus:ring-[#06b6d4]/50 mb-2" 
          />
          {!isMulti && <p className="text-[9px] text-zinc-600 mt-1 italic">Resolved: [{note!.lyric}.wav] via Map</p>}
        </div>

        {isMulti && (
          <div className="pt-2 border-t border-zinc-800/80">
            <label className="text-[9px] font-bold text-[#06b6d4] uppercase block mb-1">Batch Renaming (Sequence)</label>
            <p className="text-[8px] text-zinc-500 mb-2 leading-tight">Apply sequence across notes (e.g., "a, i, u" or "a i u")</p>
            <div className="flex gap-2">
              <input 
                type="text" 
                value={batchLyrics} 
                onChange={(e) => setBatchLyrics(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleBatchApply()}
                placeholder="a i u e o"
                className="w-full bg-black/50 border border-zinc-800 rounded px-2 py-1 text-xs text-[#06b6d4] outline-none ring-1 ring-zinc-800 focus:ring-[#06b6d4]/50" 
              />
              <button 
                onClick={handleBatchApply}
                className="bg-[#06b6d4] text-black px-3 py-1 rounded text-[10px] font-bold uppercase transition-colors hover:bg-[#06b6d4]/80 whitespace-nowrap"
              >
                Apply
              </button>
            </div>
          </div>
        )}

        {/* Formant Slider */}
        <div className="space-y-2">
          <div className="flex justify-between items-center text-[9px] font-bold text-zinc-500 uppercase">
            <label>Formant (Pitch Integrity) {isMulti && '(Bulk)'}</label>
            {!isMulti && <span className="text-[#06b6d4]">{(localFormant * 100).toFixed(0)}%</span>}
          </div>
          <input 
            type="range"
            min="0.5"
            max="1.5"
            step="0.01"
            value={localFormant}
            onChange={(e) => setLocalFormant(parseFloat(e.target.value))}
            onMouseUp={(e) => commitFormant(parseFloat((e.target as HTMLInputElement).value))}
            onTouchEnd={(e) => commitFormant(parseFloat((e.target as HTMLInputElement).value))}
            onKeyUp={(e) => commitFormant(parseFloat((e.target as HTMLInputElement).value))}
            className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-[#06b6d4]"
          />
          <div className="flex justify-between text-[8px] text-zinc-600 font-mono">
            <span>MALE</span>
            <span>NEUTRAL</span>
            <span>FEMALE</span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-[9px] text-zinc-600 uppercase block">Vel</label>
            <input 
              type="number"
              value={localVelocity}
              placeholder={isMulti ? "..." : ""}
              onChange={(e) => setLocalVelocity(e.target.value)}
              onBlur={commitVelocity}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-center w-full text-white outline-none"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[9px] text-zinc-600 uppercase block">Len (Ticks)</label>
            <input 
              type="number"
              value={localDuration}
              placeholder={isMulti ? "..." : ""}
              onChange={(e) => setLocalDuration(e.target.value)}
              onBlur={commitDuration}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-center w-full text-white outline-none"
            />
          </div>
        </div>
      </div>

      <div className="mt-auto">
        <button 
          onClick={handleDelete}
          className="w-full bg-red-500/5 text-red-500 border border-red-500/20 py-2 rounded text-[10px] font-black uppercase hover:bg-red-500/10 transition-colors mb-4"
        >
          Delete Selected
        </button>
        {renderProjectSettings()}
      </div>
    </aside>
  );
};