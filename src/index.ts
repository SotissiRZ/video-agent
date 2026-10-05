/**
 * Public library API — use Video Agent programmatically or extend it.
 *
 *   import { VideoAgent, loadConfig, registerTemplate } from 'video-agent';
 *   const agent = new VideoAgent(loadConfig());
 *   const result = await agent.run({ prompt: 'Une vidéo de 20s pour ...' });
 */
export { VideoAgent, type AgentDependencies, type RunOptions, type VideoResult } from './agent/orchestrator';
export { runDoctor, providerStatus } from './agent/doctor';
export { loadConfig, type AppConfig } from './config/config';
export * from './core/types';
export * from './core/errors';
export { FORMAT_PRESETS, OUTPUT_FORMATS, resolveFormat } from './core/formats';
export { parsePrompt } from './prompt/parser';
export { registerTemplate, getTemplate, listTemplates } from './templates/registry';
export { selectTemplate, scoreTemplates } from './templates/selector';
export type { TemplateDefinition, SceneBlueprint, SceneCopy, CopyContext } from './templates/types';
export { registerLLMProvider, resolveLLM } from './llm/registry';
export type { LLMProvider, LLMRequest, LLMResponse } from './llm/types';
export { registerImageProvider } from './providers/image/registry';
export type { ImageProvider, ImageRequest } from './providers/image/types';
export { registerVoiceProvider } from './providers/voice/registry';
export type { VoiceProvider, VoiceRequest, VoiceResult } from './providers/voice/types';
export { registerVideoProvider } from './providers/video/registry';
export type { VideoProvider, VideoClipRequest } from './providers/video/types';
export { renderStoryboard, type RenderOptions, type RenderResult } from './render/renderer';
export { validateStoryboard } from './storyboard/validator';
export { StoryboardSchema, type Storyboard, type Scene } from './remotion/contract/storyboard';
export { STYLES, getStyle } from './remotion/contract/styles';
export { startServer } from './server/server';
