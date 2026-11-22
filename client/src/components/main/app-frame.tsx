import React, { useEffect } from 'react';
import qs from 'qs';

import { useStoreActions } from '../../model';
import { decodeS1 } from '../../services/s1Encoding';

const readMelodyNotes = () => {
  const params = qs.parse(window.location.search.substr(1));
  if (params.s1) {
    try {
      return decodeS1(params.s1);
    } catch (error) {
      alert((error as any).toString());
    }
  }
};

const readMelodyLines = () => {
  const params = qs.parse(window.location.search.substr(1));
  if (params.sl) {
    try {
      const json = decodeURIComponent(escape(atob(String(params.sl))));
      const parsed = JSON.parse(json);
      return Array.isArray(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
};

export function AppFrame({ children }: { children: React.ReactNode }) {
  const { setMelodyNotes, setMelodyLines, setMelodyTitle, probeSidecar } =
    useStoreActions((actions) => actions);
  useEffect(() => {
    const notes = readMelodyNotes();
    if (notes) {
      setMelodyNotes(notes);
    }
    const lines = readMelodyLines();
    if (lines) {
      setMelodyLines(lines);
    }
    const params = qs.parse(window.location.search.substr(1));
    if (params.title) {
      setMelodyTitle(String(params.title));
    }
    probeSidecar();
  }, [setMelodyNotes, setMelodyLines, setMelodyTitle, probeSidecar]);

  return (
    <React.Fragment>
      <div className="main-container">{children}</div>
    </React.Fragment>
  );
}
