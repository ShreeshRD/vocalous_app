import { scaleLinear, ScaleLinear } from 'd3-scale';

import {
  PITCH_MIN,
  PITCH_MAX,
  noteStringForMidi,
  octaveLabelForMidi,
  isNaturalMidi,
} from '../constants';

import { noteFromPitch, centsOffFromPitch } from '../utils';

interface IFrequency {
  frequency: number;
  clarity: number;
  time: number;
  // pitch is calculated from frequency (MIDI float)
  pitch: number;
  // melodyPitch is the pitch that is nearest to the melody note,
  // it can be same as pitch or in different octave; undefined when no melody
  melodyPitch?: number;
  // optional input level for the bottom ribbon
  rms?: number;
}

interface IMelodyNote {
  start: number;
  duration: number;
  pitch: number;
}

/** Fraction of canvas height reserved for the RMS level ribbon at the bottom. */
const LEVEL_RIBBON_FRACTION = 0.12;

class PitchDisplay {
  scaleX: ScaleLinear<number, number>;
  scaleY: ScaleLinear<number, number>;
  now: number; // Time at the last call to render()
  container: HTMLElement;
  bgCanvas: HTMLCanvasElement;
  melodyCanvas: HTMLCanvasElement;
  noteCanvas: HTMLCanvasElement;
  bgContext: CanvasRenderingContext2D;
  melodyContext: CanvasRenderingContext2D;
  noteContext: CanvasRenderingContext2D;
  timeSpan: number;
  lastSongPos: number;
  playingSpeed: number;
  speedChanged: number;
  frequencies: IFrequency[] = [];
  melodyNotes: IMelodyNote[] = [];
  melodyStart: number;
  inIntro: boolean;
  introStateListeners: Function[] = [];
  background: string = '#efefef';
  highlight: string = '#888888';

  constructor(container: HTMLElement, timeSpan: number = 15000) {
    this.container = container;

    this.container.style.position = 'relative';
    const canvasStyle = 'position: absolute; width: 100%; height: 100%;';
    this.bgCanvas = document.createElement('canvas');
    this.bgCanvas.setAttribute('style', canvasStyle);
    this.bgContext = this.bgCanvas.getContext('2d');

    this.melodyCanvas = document.createElement('canvas');
    this.melodyCanvas.setAttribute('style', canvasStyle);
    this.melodyContext = this.melodyCanvas.getContext('2d');

    this.noteCanvas = document.createElement('canvas');
    this.noteCanvas.setAttribute('style', canvasStyle);
    this.noteContext = this.noteCanvas.getContext('2d');

    this.container.appendChild(this.bgCanvas);
    this.container.appendChild(this.melodyCanvas);
    this.container.appendChild(this.noteCanvas);

    this.timeSpan = timeSpan;

    this.lastSongPos = 0;
    this.speedChanged = undefined;
    this.playingSpeed = 0;
    this.melodyStart = 0;
    this.inIntro = false;

    this.resize();
  }

  subscribeToIntroState(callback: Function) {
    this.introStateListeners.push(callback);
    return () => {
      for (let i = 0; i < this.introStateListeners.length; i++) {
        if (this.introStateListeners[i] === callback) {
          this.introStateListeners.splice(i, 1);
          return;
        }
      }
    };
  }

  private levelRibbonHeight(): number {
    return Math.max(24, this.container.clientHeight * LEVEL_RIBBON_FRACTION);
  }

  private staffBottom(): number {
    return this.container.clientHeight - this.levelRibbonHeight();
  }

  private clampPitch(pitch: number): number {
    return Math.min(PITCH_MAX, Math.max(PITCH_MIN, pitch));
  }

  resize() {
    let w = this.container.clientWidth;
    let h = this.container.clientHeight;

    const dpr = window.devicePixelRatio;
    const scaledW = Math.floor(dpr * w);
    const scaledH = Math.floor(dpr * h);
    this.bgCanvas.width = scaledW;
    this.bgCanvas.height = scaledH;
    this.bgContext.scale(dpr, dpr);
    this.melodyCanvas.width = scaledW;
    this.melodyCanvas.height = scaledH;
    this.melodyContext.scale(dpr, dpr);
    this.noteCanvas.width = scaledW;
    this.noteCanvas.height = scaledH;
    this.noteContext.scale(dpr, dpr);

    this.scaleX = scaleLinear()
      .domain([-(this.timeSpan / 2), this.timeSpan / 2])
      .range([0, w]);

    // Staff sits above the level ribbon; MIDI domain, no octave wrap.
    const topMargin = Math.max(8, h / 40);
    const bottom = this.staffBottom() - 8;
    this.scaleY = scaleLinear()
      .domain([PITCH_MIN, PITCH_MAX])
      .range([bottom, topMargin]);

    this.render();
  }

  // Returns nearest melody note by given time.
  getNearestMelodyNote(time: number) {
    if (!this.melodyNotes.length) {
      return undefined;
    }

    const songPos = this.calculateSongPos(time);
    for (let i = 0; i < this.melodyNotes.length; i++) {
      const note = this.melodyNotes[i];

      let start = 0;
      if (i > 0) {
        const prevNote = this.melodyNotes[i - 1];
        start = (prevNote.start + prevNote.duration + note.start) / 2;
      }

      let end = Infinity;
      if (i < this.melodyNotes.length - 1) {
        const nextNote = this.melodyNotes[i + 1];
        end = (note.start + note.duration + nextNote.start) / 2;
      }

      if (songPos >= start && songPos < end) {
        return note;
      }
    }

    return undefined;
  }

  pushFrequency(frequency: IFrequency) {
    const f: number = frequency.frequency;
    if (!f || f <= 0 || !isFinite(f)) {
      return;
    }
    const note = noteFromPitch(f);
    const centsOff = centsOffFromPitch(f, note);
    const pitch = note + centsOff / 100;

    let melodyPitch;
    const nearestMelodyNote = this.getNearestMelodyNote(frequency.time);
    if (nearestMelodyNote) {
      let diff = (pitch - nearestMelodyNote.pitch) % 12;
      if (diff > 6) {
        diff -= 12;
      } else if (diff < -6) {
        diff += 12;
      }
      melodyPitch = nearestMelodyNote.pitch + diff;
    }

    this.frequencies.push({
      ...frequency,
      pitch,
      melodyPitch,
    });
  }

  cleanupFrequencies() {
    this.frequencies = this.frequencies.filter(
      (val) => this.now - val.time < this.timeSpan / 2
    );
  }

  setMelodyNotes(melodyNotes: IMelodyNote[]) {
    this.melodyNotes = melodyNotes;
    this.melodyStart = melodyNotes.length ? melodyNotes[0].start : 0;
  }

  playSong() {
    this.changePlayingSpeed(1);
  }

  fastForwardSong() {
    this.changePlayingSpeed(3);
  }

  pauseSong() {
    this.changePlayingSpeed(0);
  }

  calculateSongPos(now: number) {
    if (this.speedChanged === undefined) {
      return this.lastSongPos;
    }
    return this.lastSongPos + this.playingSpeed * (now - this.speedChanged);
  }

  getSongPos(now: number = Date.now()): number {
    return this.calculateSongPos(now);
  }

  getMelodyNotes(): IMelodyNote[] {
    return this.melodyNotes.slice();
  }

  changePlayingSpeed(speed: number) {
    const now = new Date().getTime();
    if (this.speedChanged === undefined) {
      this.speedChanged = now;
    }
    this.lastSongPos = this.calculateSongPos(now);
    this.playingSpeed = speed;
    this.speedChanged = now;
  }

  seekToFirstNote() {
    this.changePlayingSpeed(0);
    this.lastSongPos = this.melodyStart;
  }

  render(full: boolean = true) {
    this.now = new Date().getTime();
    const songPos = this.calculateSongPos(this.now);

    this.cleanupFrequencies();
    if (full) {
      this.drawBackground();
    }
    this.drawMelody(songPos);
    this.drawNotes();

    if (this.melodyNotes.length) {
      this.drawTimeMarkers(songPos);
    }

    this.checkIntroState(songPos);
  }

  checkIntroState(songPos: number) {
    const nowInIntro = songPos < this.melodyStart;
    if (nowInIntro !== this.inIntro) {
      this.inIntro = nowInIntro;
      for (let i = 0; i < this.introStateListeners.length; i++) {
        this.introStateListeners[i](nowInIntro);
      }
    }
  }

  setBackgroundColor(color: string) {
    this.background = color;
    this.drawBackground();
  }

  setHighlightColor(color: string) {
    this.highlight = color;
    this.drawBackground();
  }

  drawBackground() {
    let w = this.container.clientWidth;
    let h = this.container.clientHeight;

    this.bgContext.fillStyle = this.background;
    this.bgContext.clearRect(0, 0, w, h);
    this.bgContext.fillRect(0, 0, w, h);

    const ribbonH = this.levelRibbonHeight();
    // Ribbon trough
    this.bgContext.fillStyle = 'rgba(0,0,0,0.06)';
    this.bgContext.fillRect(0, h - ribbonH, w, ribbonH);
    this.bgContext.strokeStyle = this.highlight + '66';
    this.bgContext.lineWidth = 1;
    this.bgContext.beginPath();
    this.bgContext.moveTo(0, h - ribbonH);
    this.bgContext.lineTo(w, h - ribbonH);
    this.bgContext.stroke();
    this.bgContext.fillStyle = this.highlight + '99';
    this.bgContext.font = '11px Fira Sans';
    this.bgContext.fillText('level', 8, h - 8);

    const rowSpacing =
      (this.staffBottom() - this.scaleY(PITCH_MAX)) /
      Math.max(1, PITCH_MAX - PITCH_MIN);

    for (let m = PITCH_MIN; m <= PITCH_MAX; m++) {
      const y = this.scaleY(m);
      const natural = isNaturalMidi(m);
      this.bgContext.fillStyle = natural
        ? this.highlight + '55'
        : this.highlight + '22';
      this.bgContext.fillRect(0, y, w, 1);

      if (natural) {
        this.bgContext.fillStyle = this.highlight;
        this.bgContext.font = '12px Fira Sans';
        this.bgContext.fillText(
          `${noteStringForMidi(m)}${octaveLabelForMidi(m)}`,
          this.scaleX(0) + 12,
          y - 2
        );
      }
    }
    // silence unused var lint if any
    void rowSpacing;

    this.bgContext.fillStyle = this.highlight + '55';
    this.bgContext.fillRect(this.scaleX(0), 0, 1, this.staffBottom());
  }

  drawNotes() {
    let w = this.container.clientWidth;
    let h = this.container.clientHeight;

    this.noteContext.clearRect(0, 0, w, h);

    // Pitch dots
    for (let frequency of this.frequencies) {
      let t: number = frequency.time;
      let c: number = frequency.clarity;
      let x = this.scaleX(t - this.now);
      const pitch =
        frequency.melodyPitch != null ? frequency.melodyPitch : frequency.pitch;
      let y = this.scaleY(this.clampPitch(pitch));
      const color = this.colorForPitch(frequency, pitch);

      this.noteContext.fillStyle = `rgba(${color[0]}, ${color[1]}, ${
        color[2]
      }, ${c * 0.5})`;
      this.noteContext.beginPath();
      this.noteContext.arc(x, y, 5, 0, Math.PI * 2);
      this.noteContext.fill();
    }

    this.drawLevelRibbon();
  }

  /** Bottom RMS strip, time-aligned with pitch dots (scrolls with the graph). */
  private drawLevelRibbon() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    const ribbonH = this.levelRibbonHeight();
    const top = h - ribbonH;

    // Sample spacing from consecutive times when available
    let spacing = 8;
    if (this.frequencies.length >= 2) {
      const dt =
        this.frequencies[this.frequencies.length - 1].time -
        this.frequencies[0].time;
      if (dt > 0) {
        spacing = Math.min(
          10,
          Math.max(4, (this.scaleX(dt / (this.frequencies.length - 1))) || 8)
        );
      }
    }

    for (const frequency of this.frequencies) {
      const rms = frequency.rms ?? 0;
      if (rms < 0.005) {
        continue;
      }
      const x = this.scaleX(frequency.time - this.now);
      if (x < -20 || x > w + 20) {
        continue;
      }
      const level = Math.min(1, rms * 4);
      const barH = Math.max(2, level * (ribbonH - 6));
      let fill = '#4caf50';
      if (rms > 0.35) {
        fill = '#ff9800';
      } else if (rms < 0.01) {
        fill = '#9e9e9e';
      }
      this.noteContext.fillStyle = fill;
      this.noteContext.globalAlpha = 0.85;
      this.noteContext.fillRect(x, top + ribbonH - barH - 2, spacing, barH);
      this.noteContext.globalAlpha = 1;
    }
  }

  colorForPitch(frequency: IFrequency, pitch: number): [number, number, number] {
    if (frequency.melodyPitch == null) {
      return [254, 74, 73];
    }
    const errCents = Math.abs((pitch - frequency.melodyPitch) * 100);
    if (errCents <= 50) {
      return [76, 175, 80];
    }
    if (errCents <= 100) {
      return [255, 152, 0];
    }
    return [254, 74, 73];
  }

  drawTimeMarkers(songPos: number) {
    let h = this.staffBottom();
    const marks = [];
    const interval = 1000;
    for (let i = -this.timeSpan / 2; i <= this.timeSpan / 2; i += interval) {
      marks.push({
        x: this.scaleX(i - (songPos % interval)),
        y: h - 8,
      });
    }
    this.noteContext.fillStyle = this.highlight;
    for (let mark of marks) {
      this.noteContext.beginPath();
      this.noteContext.arc(mark.x, mark.y, 2, 0, Math.PI * 2);
      this.noteContext.fill();
    }
  }

  drawMelody(songPos: number) {
    let w = this.container.clientWidth;
    let h = this.staffBottom();

    const ctx: CanvasRenderingContext2D = this.melodyContext;
    ctx.clearRect(0, 0, this.container.clientWidth, this.container.clientHeight);
    ctx.lineCap = 'round';
    const mainWidth = Math.max(8, h / 48);
    for (let note of this.melodyNotes) {
      const { start, duration, pitch } = note;
      const startX = this.scaleX(start - songPos);
      const endX = this.scaleX(start - songPos + duration);
      const y = this.scaleY(this.clampPitch(pitch));

      ctx.strokeStyle = 'rgba(32, 164, 243, 0.18)';
      ctx.lineWidth = Math.max(8, mainWidth * 0.9);
      ctx.beginPath();
      ctx.moveTo(startX, y);
      ctx.lineTo(endX, y);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(32, 164, 243, 0.8)';
      ctx.lineWidth = mainWidth;
      ctx.beginPath();
      ctx.moveTo(startX + ctx.lineWidth / 2, y);
      ctx.lineTo(endX - ctx.lineWidth / 2, y);
      ctx.stroke();
    }
  }
}

export { PitchDisplay };
