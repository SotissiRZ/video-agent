import type { PlatformConstraints, PlatformId } from './types';

/** Platform limits used to validate videos and trim captions. */
export const PLATFORM_CONSTRAINTS: Record<PlatformId, PlatformConstraints> = {
  tiktok: { maxCaption: 2200, maxHashtags: 10, minDurationSec: 3, maxDurationSec: 600, vertical: true, nativeScheduling: false },
  instagram: { maxCaption: 2200, maxHashtags: 30, minDurationSec: 3, maxDurationSec: 900, vertical: true, nativeScheduling: false },
  facebook: { maxCaption: 5000, maxTitle: 255, maxHashtags: 10, minDurationSec: 1, maxDurationSec: 14_400, vertical: false, nativeScheduling: true },
  youtube: { maxCaption: 5000, maxTitle: 100, maxHashtags: 15, minDurationSec: 1, maxDurationSec: 43_200, vertical: false, nativeScheduling: true },
  linkedin: { maxCaption: 3000, maxTitle: 200, maxHashtags: 10, minDurationSec: 3, maxDurationSec: 1_800, vertical: false, nativeScheduling: false },
};

/** Problems that prevent (errors) or degrade (warnings) a publication. */
export const checkVideoForPlatform = (platform: PlatformId, video: { width: number; height: number; durationSec: number; sizeBytes: number; container: string }) => {
  const c = PLATFORM_CONSTRAINTS[platform];
  const errors: string[] = [];
  const warnings: string[] = [];
  if (video.container !== 'mp4' && video.container !== 'mov') errors.push(`${platform} needs an MP4 (got ${video.container}); render with --output-format mp4`);
  if (video.durationSec < c.minDurationSec) errors.push(`${platform}: video shorter than ${c.minDurationSec}s`);
  if (video.durationSec > c.maxDurationSec) errors.push(`${platform}: video longer than ${c.maxDurationSec}s`);
  if (c.vertical && video.width >= video.height) warnings.push(`${platform} is designed for vertical 9:16 video (this one is ${video.width}x${video.height})`);
  if (platform === 'instagram' && video.sizeBytes > 1024 ** 3) errors.push('instagram: file larger than 1 GB');
  if (platform === 'tiktok' && video.sizeBytes > 4 * 1024 ** 3) errors.push('tiktok: file larger than 4 GB');
  return { errors, warnings };
};
