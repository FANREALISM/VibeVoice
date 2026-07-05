import type { Note } from '../store/useProjectStore';
import { useProjectStore } from '../store/useProjectStore';
import { audioEngine } from '../engine/AudioEngine';

/**
 * project.json schema (v1).
 *
 * NOTE: "track" here is the UTAU vocal track — the note/lyric/timing data —
 * NOT the voicebank. The voicebank (samples + oto.ini) is intentionally left
 * out of the project file: it's large, reusable across many projects, and
 * the user re-imports it separately. Only the backing/reference audio file
 * (if any) is bundled, since that's project-specific.
 */
interface ProjectManifest {
  formatVersion: 1;
  title: string;
  bpm: number;
  language: 'EN' | 'JP';
  snapToGrid: boolean;
  track: {
    notes: Note[];
  };
  audioTrack: {
    fileName: string;
    muted: boolean;
  } | null;
}

const MANIFEST_NAME = 'project.json';
const AUDIO_DIR = 'audio/';

function sanitizeFileName(name: string): string {
  return (name || 'Untitled Project').replace(/[\\/:*?"<>|]/g, '_').trim() || 'Untitled Project';
}

export async function exportProjectAsZip(): Promise<void> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();

  const state = useProjectStore.getState();
  const audioRaw = audioEngine.getAudioTrackRaw();

  const manifest: ProjectManifest = {
    formatVersion: 1,
    title: state.title,
    bpm: state.bpm,
    language: state.language,
    snapToGrid: state.snapToGrid,
    track: {
      notes: state.notes,
    },
    audioTrack: audioRaw ? { fileName: audioRaw.name, muted: state.audioTrackMuted } : null,
  };

  zip.file(MANIFEST_NAME, JSON.stringify(manifest, null, 2));

  if (audioRaw) {
    zip.file(`${AUDIO_DIR}${audioRaw.name}`, audioRaw.blob);
  }

  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${sanitizeFileName(state.title)}.vvproj.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function importProjectFromZip(file: File): Promise<void> {
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(file);

  const manifestEntry = zip.file(MANIFEST_NAME);
  if (!manifestEntry) {
    throw new Error('Invalid project file: project.json not found in archive.');
  }

  const manifestText = await manifestEntry.async('string');
  const manifest = JSON.parse(manifestText) as ProjectManifest;

  if (!manifest || manifest.formatVersion !== 1 || !manifest.track) {
    throw new Error('Invalid or unsupported project file format.');
  }

  // Load audio first (if present) so AudioEngine has decoded/raw bytes ready
  // before we flip the store state that the UI reads from.
  let audioTrackName: string | null = null;
  if (manifest.audioTrack) {
    const audioEntry = zip.file(`${AUDIO_DIR}${manifest.audioTrack.fileName}`);
    if (audioEntry) {
      const audioBlob = await audioEntry.async('blob');
      await audioEngine.loadAudioTrack(audioBlob, manifest.audioTrack.fileName);
      audioEngine.setAudioTrackMuted(manifest.audioTrack.muted);
      audioTrackName = manifest.audioTrack.fileName;
    } else {
      console.warn(`Project references audio file "${manifest.audioTrack.fileName}" but it was not found in the archive.`);
      audioEngine.removeAudioTrack();
    }
  } else {
    audioEngine.removeAudioTrack();
  }

  useProjectStore.getState().loadProjectSnapshot({
    title: manifest.title ?? 'Untitled Project',
    bpm: manifest.bpm ?? 120,
    language: manifest.language ?? 'JP',
    notes: manifest.track.notes ?? [],
    snapToGrid: manifest.snapToGrid ?? true,
    audioTrackName,
    audioTrackMuted: manifest.audioTrack?.muted ?? false,
  });
}
