import React, { useEffect, useState } from 'react';
import { useStoreState } from '../../model';
import { MelodyLyricLine } from '../../model';

/**
 * Shows current + next lyric lines driven by PitchDisplay song clock.
 * Parent mounts this during practice; songPos is polled via callback ref.
 */
export function LyricsBar({
  getSongPos,
}: {
  getSongPos: () => number | null;
}) {
  const lines = useStoreState((state) => state.melody.lines) as
    | MelodyLyricLine[]
    | undefined;
  const [activeIdx, setActiveIdx] = useState(-1);

  useEffect(() => {
    if (!lines || !lines.length) {
      setActiveIdx(-1);
      return;
    }
    let raf = 0;
    const tick = () => {
      const pos = getSongPos();
      if (pos != null) {
        let idx = -1;
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const end = line.start + line.duration + 800;
          if (pos >= line.start - 200 && pos < end) {
            idx = i;
            break;
          }
          if (pos >= line.start) {
            idx = i;
          }
        }
        setActiveIdx(idx);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [lines, getSongPos]);

  if (!lines || !lines.length || activeIdx < 0) {
    return null;
  }

  const current = lines[activeIdx];
  const next = lines[activeIdx + 1];

  return (
    <div className="lyrics-display unselectable" data-testid="lyrics-display">
      <div className="lyrics-current">{current.text}</div>
      {next && <div className="lyrics-next">{next.text}</div>}
    </div>
  );
}

export default LyricsBar;
