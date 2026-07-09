import { create } from 'zustand';
import { supabase, isSupabaseConfigured } from '../lib/supabase';

export interface Note {
  id: string;
  pitch: number;
  startTick: number;
  durationTick: number;
  lyric: string;
  velocity: number;
  formant?: number;
}

interface ProjectState {
  id: string | null;
  title: string;
  bpm: number;
  language: 'EN' | 'JP';
  notes: Note[];
  selectedNoteIds: string[];
  isDirty: boolean;
  isLoading: boolean;
  isPlaying: boolean;
  isLoadingVoicebank: boolean;

  // Reference/backing audio track (e.g. instrumental) imported by the user
  audioTrackName: string | null;
  audioTrackMuted: boolean;
  isLoadingAudioTrack: boolean;

  snapToGrid: boolean;
  zoomX: number;
  
  past: Note[][];
  future: Note[][];
  
  // Actions
  addNote: (note: Omit<Note, 'id'>) => void;
  addNotes: (notes: Omit<Note, 'id'>[]) => void;
  updateNote: (id: string, updates: Partial<Note>) => void;
  updateNotes: (ids: string[], updates: Partial<Note>) => void;
  updateNotesIndividually: (updates: { id: string; updates: Partial<Note> }[]) => void;
  deleteNote: (id: string) => void;
  deleteNotes: (ids: string[]) => void;
  undo: () => void;
  redo: () => void;
  setBpm: (bpm: number) => void;
  setLanguage: (lang: 'EN' | 'JP') => void;
  setTitle: (title: string) => void;
  setIsPlaying: (isPlaying: boolean) => void;
  setSnapToGrid: (snap: boolean) => void;
  setZoomX: (zoom: number) => void;
  setIsLoadingVoicebank: (loading: boolean) => void;
  setAudioTrackName: (name: string | null) => void;
  setAudioTrackMuted: (muted: boolean) => void;
  setIsLoadingAudioTrack: (loading: boolean) => void;
  setSelectedNoteIds: (ids: string[]) => void;
  toggleNoteSelection: (id: string, multi: boolean) => void;
  
  // Cloud Actions
  loadProject: (projectId: string) => Promise<void>;
  saveProject: (userId: string) => Promise<void>;
  resetProject: () => void;

  // Local project file (.zip) import: replaces title/bpm/language/notes/settings
  // in one shot so it doesn't get recorded as N separate undo steps.
  loadProjectSnapshot: (snapshot: {
    title: string;
    bpm: number;
    language: 'EN' | 'JP';
    notes: Note[];
    snapToGrid: boolean;
    audioTrackName: string | null;
    audioTrackMuted: boolean;
  }) => void;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  id: null,
  title: 'Untitled Project',
  bpm: 120,
  language: 'JP',
  notes: [],
  selectedNoteIds: [],
  isDirty: false,
  isLoading: false,
  isPlaying: false,
  isLoadingVoicebank: false,
  audioTrackName: null,
  audioTrackMuted: false,
  isLoadingAudioTrack: false,
  snapToGrid: true,
  zoomX: 1,

  past: [],
  future: [],

  undo: () => set((state) => {
    if (state.past.length > 0) {
      const previous = state.past[state.past.length - 1];
      const newPast = state.past.slice(0, state.past.length - 1);
      return {
        past: newPast,
        future: [state.notes, ...state.future],
        notes: previous,
        selectedNoteIds: [],
        isDirty: true
      };
    }
    return state;
  }),

  redo: () => set((state) => {
    if (state.future.length > 0) {
      const next = state.future[0];
      const newFuture = state.future.slice(1);
      return {
        past: [...state.past, state.notes],
        future: newFuture,
        notes: next,
        selectedNoteIds: [],
        isDirty: true
      };
    }
    return state;
  }),

  setSelectedNoteIds: (ids) => set({ selectedNoteIds: ids }),
  
  toggleNoteSelection: (id, multi) => set((state) => {
    if (multi) {
      if (state.selectedNoteIds.includes(id)) {
        return { selectedNoteIds: state.selectedNoteIds.filter(nId => nId !== id) };
      } else {
        return { selectedNoteIds: [...state.selectedNoteIds, id] };
      }
    } else {
      return { selectedNoteIds: [id] };
    }
  }),

  addNote: (note) => set((state) => ({
    past: [...state.past, state.notes],
    future: [],
    notes: [...state.notes, { ...note, id: crypto.randomUUID(), formant: note.formant ?? 1.0 }],
    isDirty: true
  })),

  addNotes: (notesToAdd) => set((state) => ({
    past: [...state.past, state.notes],
    future: [],
    notes: [
      ...state.notes,
      ...notesToAdd.map(n => ({ ...n, id: crypto.randomUUID(), formant: n.formant ?? 1.0 }))
    ],
    isDirty: true
  })),

  updateNote: (id, updates) => set((state) => ({
    past: [...state.past, state.notes],
    future: [],
    notes: state.notes.map(n => n.id === id ? { ...n, ...updates } : n),
    isDirty: true
  })),

  updateNotes: (ids, updates) => set((state) => ({
    past: [...state.past, state.notes],
    future: [],
    notes: state.notes.map(n => ids.includes(n.id) ? { ...n, ...updates } : n),
    isDirty: true
  })),

  updateNotesIndividually: (updatesList) => set((state) => {
    const byId = new Map(updatesList.map(u => [u.id, u.updates]));
    return {
      past: [...state.past, state.notes],
      future: [],
      notes: state.notes.map(n => byId.has(n.id) ? { ...n, ...(byId.get(n.id) as Partial<Note>) } : n),
      isDirty: true
    };
  }),

  deleteNote: (id) => set((state) => ({
    past: [...state.past, state.notes],
    future: [],
    notes: state.notes.filter(n => n.id !== id),
    selectedNoteIds: state.selectedNoteIds.filter(nId => nId !== id),
    isDirty: true
  })),

  deleteNotes: (ids) => set((state) => ({
    past: [...state.past, state.notes],
    future: [],
    notes: state.notes.filter(n => !ids.includes(n.id)),
    selectedNoteIds: state.selectedNoteIds.filter(nId => !ids.includes(nId)),
    isDirty: true
  })),

  setBpm: (bpm) => set({ bpm, isDirty: true }),
  setLanguage: (lang) => set({ language: lang, isDirty: true }),
  
  setTitle: (title) => set({ title, isDirty: true }),

  setIsPlaying: (isPlaying) => set({ isPlaying }),
  
  setSnapToGrid: (snap) => set({ snapToGrid: snap }),
  setZoomX: (zoom) => set({ zoomX: Math.max(0.1, Math.min(zoom, 5)) }),

  setIsLoadingVoicebank: (loading) => set({ isLoadingVoicebank: loading }),
  setAudioTrackName: (name) => set({ audioTrackName: name, isDirty: true }),
  setAudioTrackMuted: (muted) => set({ audioTrackMuted: muted }),
  setIsLoadingAudioTrack: (loading) => set({ isLoadingAudioTrack: loading }),

  resetProject: () => set({
    id: null,
    title: 'Untitled Project',
    bpm: 120,
    language: 'JP',
    notes: [],
    selectedNoteIds: [],
    isDirty: false,
    snapToGrid: true,
    audioTrackName: null,
    audioTrackMuted: false,
    isLoadingAudioTrack: false,
    past: [],
    future: []
  }),

  loadProject: async (projectId) => {
    if (!isSupabaseConfigured) {
      console.warn("Supabase not configured, skipping loadProject");
      return;
    }
    set({ isLoading: true });
    try {
      const { data, error } = await supabase
        .from('projects')
        .select('*')
        .eq('id', projectId)
        .single();

      if (!error && data) {
        set({
          id: data.id,
          title: data.title,
          bpm: data.bpm,
          notes: data.notes || [],
          isDirty: false,
          past: [],
          future: []
        });
      }
    } catch(e) {
      console.error(e instanceof Error ? e.message : String(e));
    }
    set({ isLoading: false });
  },

  saveProject: async (userId) => {
    if (!isSupabaseConfigured) {
      console.warn("Supabase not configured, skipping saveProject");
      return;
    }
    const state = get();
    // NOTE: this payload does not include language/snapToGrid/audioTrack —
    // those are silently dropped on cloud save (and therefore can't be
    // restored by loadProject below either). Not fixing that blind here:
    // isSupabaseConfigured is hardcoded false in lib/supabase.ts right now,
    // so this code path is currently unreachable, and guessing at column
    // names for a table schema I can't inspect risks breaking saves outright
    // the moment cloud sync is turned on if the guess is wrong. Add the
    // matching columns to the `projects` table first, then extend this
    // payload and the corresponding fields in loadProject() below together.
    const payload = {
      user_id: userId,
      title: state.title,
      bpm: state.bpm,
      notes: state.notes,
      last_modified: new Date().toISOString()
    };

    try {
      if (state.id) {
        await supabase.from('projects').update(payload).eq('id', state.id);
      } else {
        const { data } = await supabase.from('projects').insert(payload).select().single();
        if (data) set({ id: data.id });
      }
      set({ isDirty: false });
    } catch(e) {
      console.error(e instanceof Error ? e.message : String(e));
    }
  },

  loadProjectSnapshot: (snapshot) => set({
    title: snapshot.title,
    bpm: snapshot.bpm,
    language: snapshot.language,
    notes: snapshot.notes,
    snapToGrid: snapshot.snapToGrid,
    audioTrackName: snapshot.audioTrackName,
    audioTrackMuted: snapshot.audioTrackMuted,
    selectedNoteIds: [],
    isDirty: false,
    past: [],
    future: []
  })
}));
