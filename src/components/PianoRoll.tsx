import React, { useEffect, useRef, useState } from 'react';
import { Stage, Layer, Rect, Text, Group, Line } from 'react-konva';
import { useProjectStore } from '../store/useProjectStore';
import { NOTE_HEIGHT, PIXELS_PER_TICK, TOTAL_KEYS, DEFAULT_DURATION, DEFAULT_VELOCITY, PIXELS_PER_BEAT } from '../utils/constants';
import { audioEngine } from '../engine/AudioEngine';
import * as Tone from 'tone';

export const PianoRoll: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<any>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [zoomX, setZoomX] = useState(1);
  const { notes, addNote, updateNote, selectedNoteIds, toggleNoteSelection, isPlaying, snapToGrid } = useProjectStore();

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      setSize({
        width: entries[0].contentRect.width,
        height: entries[0].contentRect.height,
      });
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        setZoomX(prev => Math.max(0.1, Math.min(prev - e.deltaY * 0.005, 5)));
      }
    };
    
    const container = containerRef.current;
    if (container) {
      container.addEventListener('wheel', handleWheel, { passive: false });
    }
    return () => container?.removeEventListener('wheel', handleWheel);
  }, []);

  useEffect(() => {
    let animFrame: number;
    let isActive = true;

    const renderLoop = () => {
      if (!isActive) return;
      if (Tone.Transport.state === "started" && playheadRef.current) {
        // Find current time in seconds
        const currentSeconds = Tone.Transport.seconds;
        // Convert to ticks
        const bpm = Tone.Transport.bpm.value;
        const ticksPerBeat = Tone.Transport.PPQ;
        const ticksPerSecond = (bpm / 60) * ticksPerBeat;
        const currentTick = currentSeconds * ticksPerSecond;
        const actualPixelsPerTick = PIXELS_PER_TICK * zoomX;
        
        playheadRef.current.x(currentTick * actualPixelsPerTick);
      } else if (Tone.Transport.state === "stopped" && playheadRef.current) {
         playheadRef.current.x(0);
      }
      
      animFrame = requestAnimationFrame(renderLoop);
    };

    if (isPlaying) {
      animFrame = requestAnimationFrame(renderLoop);
    } else {
      if (playheadRef.current) {
         const currentSeconds = Tone.Transport.seconds;
         const bpm = Tone.Transport.bpm.value || 120;
         const ticksPerBeat = Tone.Transport.PPQ;
         const ticksPerSecond = (bpm / 60) * ticksPerBeat;
         const actualPixelsPerTick = PIXELS_PER_TICK * zoomX;
         playheadRef.current.x((currentSeconds * ticksPerSecond) * actualPixelsPerTick);
         if (Tone.Transport.state === "stopped") {
           playheadRef.current.x(0);
         }
      }
    }

    return () => {
      isActive = false;
      if (animFrame) cancelAnimationFrame(animFrame);
    };
  }, [isPlaying, zoomX]);

  const handleStageClick = async (e: any) => {
    // If we click on an empty area, add a note
    const clickedOnEmpty = e.target === e.target.getStage();
    if (clickedOnEmpty) {
      useProjectStore.getState().setSelectedNoteIds([]);
      const stage = e.target.getStage();
      const pointerPosition = stage.getPointerPosition();
      if (!pointerPosition) return;

      await audioEngine.init();
      const actualPixelsPerTick = PIXELS_PER_TICK * zoomX;
      
      const pitch = TOTAL_KEYS - 1 - Math.floor(pointerPosition.y / NOTE_HEIGHT);
      let startTick = Math.max(0, pointerPosition.x / actualPixelsPerTick);
      let durationTick = DEFAULT_DURATION;

      const ticksPerBeat = Tone.Transport.PPQ;
      const snapTicks = ticksPerBeat / 4; // 16th note snap
      startTick = Math.round(startTick / snapTicks) * snapTicks;
      durationTick = snapTicks; // Make new notes snap duration
      
      addNote({
        pitch,
        startTick,
        durationTick,
        lyric: 'a',
        velocity: DEFAULT_VELOCITY,
      });

      audioEngine.playNote(pitch, 'a', DEFAULT_VELOCITY);
    }
  };

  const handleSelectNote = async (id: string, pitch: number, lyric: string, velocity: number, isShift: boolean) => {
    toggleNoteSelection(id, isShift);
    await audioEngine.init();
    audioEngine.playNote(pitch, lyric, velocity);
  };

  return (
    <div 
      ref={containerRef} 
      className="flex-1 overflow-auto flex flex-col"
      style={{
        backgroundColor: '#050507',
      }}
    >
      {/* Timeline Header (Sticky Top) */}
      <div 
        className="h-8 bg-[#121217] border-b border-zinc-800 flex sticky top-0 z-30 w-full"
        style={{ minWidth: Math.max(size.width, 2000) + 48 }}
      >
        <div className="w-12 border-r border-zinc-800 shrink-0 bg-[#121217]"></div>
        <div className="flex-1 relative overflow-hidden" style={{ backgroundSize: `${80 * zoomX}px 32px` }}>
          {Array.from({ length: 50 }).map((_, i) => (
            <div key={i} className="absolute h-full flex items-end pb-1 border-l border-zinc-700 font-mono text-[10px] text-zinc-500 px-1" style={{ left: i * PIXELS_PER_BEAT * 4 * zoomX, width: PIXELS_PER_BEAT * 4 * zoomX }}>
              {i + 1}
            </div>
          ))}
        </div>
      </div>

      <div 
        className="flex"
        style={{
          width: Math.max(size.width, 2000) + 48, // 48 is width of keys
        }}
      >
        {/* Vertical Piano Keys */}
        <div className="w-12 bg-[#121217] border-r border-zinc-800 flex flex-col sticky left-0 z-20 shrink-0">
          {Array.from({ length: TOTAL_KEYS }).map((_, i) => {
            const pitch = TOTAL_KEYS - 1 - i;
            const isWhite = [0, 2, 4, 5, 7, 9, 11].includes(pitch % 12);
            const isC = pitch % 12 === 0;
            const octave = Math.floor(pitch / 12) - 1;
            
            return (
              <div 
                key={pitch}
                className={`h-8 border-b border-zinc-900 flex items-center justify-end pr-1 text-[8px] font-bold uppercase
                  ${isWhite ? 'bg-white text-black' : 'bg-zinc-900 text-transparent'}`}
                style={{ height: NOTE_HEIGHT }}
                onClick={() => {
                   audioEngine.init().then(() => audioEngine.playNote(pitch, 'a', DEFAULT_VELOCITY));
                }}
              >
                {isC ? `C${octave}` : ''}
              </div>
            );
          })}
        </div>

        {/* Grid View */}
        <div 
          className="flex-1 relative flex flex-col"
          style={{
            backgroundImage: 'linear-gradient(to right, #1a1a21 1px, transparent 1px), linear-gradient(to bottom, #1a1a21 1px, transparent 1px)',
            backgroundSize: `${80 * zoomX}px 32px`,
          }}
        >
          <div className="flex-1 relative">
            <Stage 
              width={Math.max(size.width, 2000)} 
              height={TOTAL_KEYS * NOTE_HEIGHT} 
              onClick={handleStageClick}
            >
          <Layer>
            {notes.map((note) => {
              const isSelected = selectedNoteIds.includes(note.id);
              const actualPixelsPerTick = PIXELS_PER_TICK * zoomX;
              const x = note.startTick * actualPixelsPerTick;
              const y = (TOTAL_KEYS - 1 - note.pitch) * NOTE_HEIGHT;
              const width = note.durationTick * actualPixelsPerTick;

              return (
                <Group
                  key={note.id}
                  x={x}
                  y={y}
                  draggable
                  dragBoundFunc={(pos) => {
                    const snapTicks = Tone.Transport.PPQ / 4;
                    const snapPixels = snapTicks * actualPixelsPerTick;
                    const snappedX = Math.round(pos.x / snapPixels) * snapPixels;
                    const snappedY = Math.round(pos.y / NOTE_HEIGHT) * NOTE_HEIGHT;
                    return { 
                      x: Math.max(0, snappedX), 
                      y: Math.max(0, Math.min(TOTAL_KEYS * NOTE_HEIGHT - NOTE_HEIGHT, snappedY))
                    };
                  }}
                  onClick={(e) => {
                    e.cancelBubble = true;
                    handleSelectNote(note.id, note.pitch, note.lyric, note.velocity, e.evt.shiftKey);
                  }}
                  onDragEnd={(e) => {
                    const newX = e.target.x();
                    const newY = e.target.y();
                    let newStartTick = Math.max(0, newX / actualPixelsPerTick);
                    const newPitch = Math.max(0, Math.min(TOTAL_KEYS - 1, TOTAL_KEYS - 1 - Math.round(newY / NOTE_HEIGHT)));
                    
                    const ticksPerBeat = Tone.Transport.PPQ;
                    const snapTicks = ticksPerBeat / 4; // 16th note snap
                    newStartTick = Math.round(newStartTick / snapTicks) * snapTicks;

                    // Snap to grid visually
                    e.target.position({
                      x: newStartTick * actualPixelsPerTick,
                      y: (TOTAL_KEYS - 1 - newPitch) * NOTE_HEIGHT,
                    });

                    updateNote(note.id, {
                      startTick: newStartTick,
                      pitch: newPitch
                    });

                    audioEngine.playNote(newPitch, note.lyric, note.velocity);
                  }}
                >
                  <Rect
                    width={Math.max(width, 10)}
                    height={NOTE_HEIGHT - 2}
                    y={1}
                    fill={isSelected ? '#0891b2' : 'rgba(6, 182, 212, 0.8)'}
                    cornerRadius={4}
                    shadowColor="#22d3ee"
                    shadowBlur={isSelected ? 15 : 5}
                    shadowOpacity={0.6}
                    stroke={isSelected ? '#fff' : 'rgba(255,255,255,0.2)'}
                    strokeWidth={1}
                  />
                  {/* Resize Handle */}
                  <Rect
                    width={10}
                    height={NOTE_HEIGHT - 2}
                    x={Math.max(width, 10) - 10}
                    y={1}
                    draggable
                    onDragMove={(e) => {
                      e.cancelBubble = true;
                      const rectX = e.target.x();
                      const newWidth = Math.max(10, rectX + 10);
                      let newDuration = newWidth / actualPixelsPerTick;
                      
                      const ticksPerBeat = Tone.Transport.PPQ;
                      const snapTicks = ticksPerBeat / 4;
                      newDuration = Math.round(newDuration / snapTicks) * snapTicks;
                      newDuration = Math.max(snapTicks, newDuration);
                      e.target.x(newDuration * actualPixelsPerTick - 10);
                      e.target.y(1);
                    }}
                    onDragEnd={(e) => {
                      e.cancelBubble = true;
                      let newDuration = (e.target.x() + 10) / actualPixelsPerTick;
                      
                      const ticksPerBeat = Tone.Transport.PPQ;
                      const snapTicks = ticksPerBeat / 4;
                      newDuration = Math.round(newDuration / snapTicks) * snapTicks;
                      newDuration = Math.max(snapTicks, newDuration);
                      
                      updateNote(note.id, {
                        durationTick: newDuration
                      });
                    }}
                    hitStrokeWidth={0}
                    onMouseEnter={() => {
                        const stage = containerRef.current?.querySelector('canvas');
                        if (stage) stage.style.cursor = 'ew-resize';
                    }}
                    onMouseLeave={() => {
                        const stage = containerRef.current?.querySelector('canvas');
                        if (stage) stage.style.cursor = 'default';
                    }}
                  />
                  <Text
                    text={note.lyric}
                    fontSize={10}
                    fontFamily="sans-serif"
                    fill="white"
                    fontStyle="bold"
                    padding={5}
                    y={1 + (NOTE_HEIGHT - 18) / 2}
                    shadowColor="rgba(0,0,0,0.5)"
                    shadowBlur={2}
                  />
                </Group>
              );
            })}
            
            <Line
              ref={playheadRef}
              points={[0, -500, 0, TOTAL_KEYS * NOTE_HEIGHT + 500]}
              stroke="#fff"
              strokeWidth={2}
              shadowColor="#fff"
              shadowBlur={10}
              listening={false}
            />
          </Layer>
        </Stage>
          </div>

          <div className="sticky bottom-0 left-0 right-0 h-32 bg-black/80 border-t border-zinc-800 backdrop-blur-md p-4 z-40">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest">Pitch Bend Control</span>
              <span className="text-[9px] text-[#06b6d4]">Bezier Smooth</span>
            </div>
            <svg className="w-full h-16">
              <path d="M0 40 Q 180 0, 320 40 T 800 40" stroke="#06b6d4" strokeWidth="2" fill="none" />
              <circle cx="180" cy="20" r="3" fill="#fff" />
              <circle cx="320" cy="40" r="3" fill="#fff" />
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
};
