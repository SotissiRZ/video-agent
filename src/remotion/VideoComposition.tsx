import React, { useMemo } from 'react';
import { AbsoluteFill, Audio, interpolate, Sequence, useVideoConfig } from 'remotion';
import { linearTiming, TransitionSeries } from '@remotion/transitions';
import type { TransitionPresentation } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { flip } from '@remotion/transitions/flip';
import { slide } from '@remotion/transitions/slide';
import { wipe } from '@remotion/transitions/wipe';
import { StoryboardSchema, type CompositionProps, type Transition } from './contract/storyboard';
import { computeTimeline, transitionLength, voiceStartFrame } from './contract/timeline';
import { SubtitlesOverlay } from './components/SubtitlesOverlay';
import { PlanBadge, Watermark } from './components/Watermark';
import { ensureFonts } from './fonts';
import { isRtl } from './contract/languages';
import { SceneRenderer } from './scenes';
import { resolveSrc } from './utils';

ensureFonts();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const presentationFor = (t: Transition): TransitionPresentation<any> => {
  switch (t.type) {
    case 'slide':
      return slide({ direction: t.direction });
    case 'wipe':
      return wipe({ direction: t.direction });
    case 'flip':
      return flip({ direction: t.direction });
    case 'fade':
    default:
      return fade();
  }
};

/** Root composition: renders any storyboard produced by the agent. */
export const VideoComposition: React.FC<CompositionProps> = (props) => {
  // Parsing fills defaults so hand-written storyboards (Studio, JSON edits) also work.
  const storyboard = useMemo(() => StoryboardSchema.parse(props.storyboard), [props.storyboard]);
  const { durationInFrames } = useVideoConfig();
  const timeline = useMemo(() => computeTimeline(storyboard.scenes), [storyboard.scenes]);

  const voiceWindows = useMemo(
    () =>
      storyboard.scenes.flatMap((scene, i) =>
        scene.voiceover
          ? [{ start: voiceStartFrame(timeline[i]!), end: voiceStartFrame(timeline[i]!) + scene.voiceover.durationInFrames }]
          : [],
      ),
    [storyboard.scenes, timeline],
  );

  const music = storyboard.audio.music;
  const musicVolume = (frame: number): number => {
    if (!music) return 0;
    const fadeIn = interpolate(frame, [0, 20], [0, 1], { extrapolateRight: 'clamp' });
    const fadeOut = interpolate(frame, [durationInFrames - 45, durationInFrames - 1], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
    // Duck smoothly (8 frames ramps) under the voice-over.
    let duck = 0;
    for (const w of voiceWindows) {
      const d = Math.min(
        interpolate(frame, [w.start - 8, w.start], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
        interpolate(frame, [w.end, w.end + 8], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
      );
      duck = Math.max(duck, d);
    }
    const level = music.volume + (music.duckedVolume - music.volume) * duck;
    return level * fadeIn * fadeOut;
  };

  const children: React.ReactNode[] = [];
  storyboard.scenes.forEach((scene, i) => {
    children.push(
      <TransitionSeries.Sequence key={`s-${scene.id}`} durationInFrames={scene.durationInFrames} name={`${i + 1}. ${scene.role}`}>
        <SceneRenderer scene={scene} storyboard={storyboard} index={i} />
      </TransitionSeries.Sequence>,
    );
    const length = transitionLength(storyboard.scenes, i);
    if (length > 0) {
      children.push(
        <TransitionSeries.Transition
          key={`t-${scene.id}`}
          presentation={presentationFor(scene.transitionOut)}
          timing={linearTiming({ durationInFrames: length })}
        />,
      );
    }
  });

  return (
    <AbsoluteFill style={{ backgroundColor: storyboard.theme.palette.background, direction: isRtl(storyboard.meta.language) ? 'rtl' : 'ltr' }}>
      <TransitionSeries>{children}</TransitionSeries>
      <Watermark storyboard={storyboard} />
      <PlanBadge storyboard={storyboard} />
      <SubtitlesOverlay subtitles={storyboard.subtitles} theme={storyboard.theme} />
      {music ? <Audio src={resolveSrc(music.src)} volume={musicVolume} loop /> : null}
      {storyboard.scenes.map((scene, i) =>
        scene.voiceover ? (
          <Sequence
            key={`vo-${scene.id}`}
            from={voiceStartFrame(timeline[i]!)}
            durationInFrames={scene.voiceover.durationInFrames}
            name={`voice ${i + 1}`}
          >
            <Audio src={resolveSrc(scene.voiceover.src)} volume={scene.voiceover.volume} />
          </Sequence>
        ) : null,
      )}
    </AbsoluteFill>
  );
};
