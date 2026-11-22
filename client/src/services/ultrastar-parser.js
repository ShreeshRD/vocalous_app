// https://thebrickyblog.wordpress.com/2011/01/27/ultrastar-txt-files-in-more-depth/

function noteTypeFromLine(line) {
  if (line.startsWith(': ')) return 'regular';
  if (line.startsWith('G ')) return 'golden';
  if (line.startsWith('F ')) return 'freestyle';
  return null;
}

// Parses content of UltraStar TXT song file and returns parsed data as object.
export function parseUltraStarTxt(data) {
  let bpm;
  let beatDuration;

  let gap = 0;
  const notes = [];
  const lines = [];
  let title;
  let artist;
  let openLine = [];

  const linesRaw = data.split('\n');

  function setBPM(value) {
    bpm = value;
    beatDuration = 60000 / value / 4;
  }

  setBPM(180);

  function flushLine() {
    if (!openLine.length) {
      return;
    }
    const start = openLine[0].start;
    const last = openLine[openLine.length - 1];
    const end = last.start + last.duration;
    lines.push({
      start,
      duration: Math.max(0, end - start),
      text: openLine
        .map((s) => s.text)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim(),
      syllables: openLine.slice(),
    });
    openLine = [];
  }

  function parseHeader(line) {
    const parts = line.substr(1).split(':');
    const key = parts[0].toLowerCase();
    const value = parts.slice(1).join(':');
    if (key === 'bpm') {
      const numValue = parseFloat(value.replace(',', '.'), 10);
      setBPM(numValue);
    } else if (key === 'gap') {
      gap = parseFloat(value.replace(',', '.'), 10);
    } else if (key === 'relative') {
      if (value.toLowerCase() === 'yes') {
        throw new Error('Relative notes not supported!');
      }
    } else if (key === 'title') {
      title = value.trim();
    } else if (key === 'artist') {
      artist = value.trim();
    }
  }

  function parseNote(line) {
    const type = noteTypeFromLine(line);
    if (!type) {
      return;
    }
    const parts = line.substr(2).split(' ');
    if (parts.length > 3) {
      const start = gap + parseInt(parts[0], 10) * beatDuration;
      const duration = parseInt(parts[1], 10) * beatDuration;
      const pitch = parseInt(parts[2], 10);
      const text = parts.slice(3).join(' ');

      const floorStart = Math.floor(start);

      // truncate previous note if needed
      if (notes.length > 0) {
        const prevNote = notes[notes.length - 1];
        if (prevNote.start + prevNote.duration >= floorStart) {
          prevNote.duration = floorStart - prevNote.start;
        }
      }

      notes.push({
        start: floorStart,
        duration: Math.floor(duration),
        pitch: pitch,
      });

      const syllable = {
        start: floorStart,
        duration: Math.floor(duration),
        pitch,
        text,
        type,
      };
      openLine.push(syllable);
    }
  }

  let section = 'header';
  for (let i = 0; i < linesRaw.length; i++) {
    const line = linesRaw[i];
    if (section === 'header') {
      if (line.startsWith(': ')) {
        section = 'notes';
        parseNote(line);
      } else if (line.startsWith('#')) {
        parseHeader(line);
      }
    }
    if (section === 'notes') {
      if (
        line.startsWith(': ') ||
        line.startsWith('G ') ||
        line.startsWith('F ')
      ) {
        parseNote(line);
      } else if (line.startsWith('E')) {
        flushLine();
      }
    }
  }
  flushLine();

  return {
    bpm: bpm,
    gap: gap,
    notes,
    lines,
    title,
    artist,
  };
}
