import React from 'react';

import PitchComponent from './components/pitch';
import { PitchMonitor } from './components/pitch/pitch-monitor';
import { AppFrame } from './components/main/app-frame';
import { useStoreActions, useStoreState } from './model';
import Main from './components/main';

function App() {
  // Higher power floor rejects low-level ambient noise before McLeod runs
  const POWER_THRESHOLD = 0.28;

  const detectorName = useStoreState((state) => state.detectorName);
  const windowSize = useStoreState((state) => state.windowSize);
  const clarityThreshold = useStoreState((state) => state.clarityThreshold);
  const micPreset = useStoreState((state) => state.micPreset);
  const enabled = useStoreState((state) => state.enabled);

  const { loaded, stream, workerConnection } = useStoreState((state) => ({
    loaded: state.loaded,
    loading: state.loading,
    stream: state.stream,
    workerConnection: state.workerConnection,
  }));

  const { checkAudioContextSupport, initializeWorker } = useStoreActions(
    (actions) => actions
  );

  React.useEffect(() => {
    (async () => {
      await initializeWorker();
      console.log('Worker initialized');
      await checkAudioContextSupport();
    })();
  }, [checkAudioContextSupport, initializeWorker]);

  // Digital RMS gate on top of browser noiseSuppression (stricter for studio
  // where AGC is off and levels can sit lower).
  const noiseGateRms = micPreset === 'studio' ? 0.018 : 0.01;

  let mainDisplay = <Main />;
  if (loaded && stream && workerConnection) {
    const pitchRenderer = PitchComponent;
    mainDisplay = (
      <PitchMonitor
        stream={stream}
        detectorName={detectorName}
        workerConnection={workerConnection}
        windowSize={windowSize}
        powerThreshold={POWER_THRESHOLD}
        clarityThreshold={clarityThreshold}
        noiseGateRms={noiseGateRms}
        enabled={enabled}
        pitchRenderer={pitchRenderer}
      />
    );
  }

  return <AppFrame>{mainDisplay}</AppFrame>;
}

export default App;
