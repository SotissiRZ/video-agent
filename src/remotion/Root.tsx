import React from 'react';
import { Composition, type CalculateMetadataFunction } from 'remotion';
import { COMPOSITION_ID, StoryboardSchema, type CompositionProps } from './contract/storyboard';
import { computeTotalDuration } from './contract/timeline';
import { SAMPLE_STORYBOARD } from './sample';
import { VideoComposition } from './VideoComposition';

/** Dimensions, fps and duration all come from the storyboard given as input props. */
const calculateMetadata: CalculateMetadataFunction<CompositionProps> = ({ props }) => {
  const storyboard = StoryboardSchema.parse(props.storyboard);
  return {
    width: storyboard.format.width,
    height: storyboard.format.height,
    fps: storyboard.format.fps,
    durationInFrames: computeTotalDuration(storyboard.scenes),
    props: { storyboard },
  };
};

export const RemotionRoot: React.FC = () => (
  <Composition
    id={COMPOSITION_ID}
    component={VideoComposition}
    defaultProps={{ storyboard: SAMPLE_STORYBOARD }}
    calculateMetadata={calculateMetadata}
    width={SAMPLE_STORYBOARD.format.width}
    height={SAMPLE_STORYBOARD.format.height}
    fps={SAMPLE_STORYBOARD.format.fps}
    durationInFrames={SAMPLE_STORYBOARD.format.durationInFrames}
  />
);
