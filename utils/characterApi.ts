import type { APIConfig, ActiveMsg2CharacterConfig, CharacterProfile, DialogueApiConfig } from '../types';
import { normalizeLlmBaseUrl, llmApiType } from './llmEndpoint';
import { normalizeApiBaseUrl, normalizeApiCredential, normalizeApiModel } from './apiConfigNormalize';

export function normalizeDialogueMaxTokens(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

export function dialogueMaxTokens(api: Pick<APIConfig, 'maxTokens'>): number {
  return normalizeDialogueMaxTokens(api.maxTokens) ?? 8000;
}

/** Only dialogue calls opt in. Directors, memory, vision and TTS keep their own routes. */
export function resolveDialogueApi(
  globalApi: APIConfig,
  character?: Pick<CharacterProfile, 'dialogueApi'> | null,
  appApi?: DialogueApiConfig | null,
): APIConfig {
  const source = appApi ?? character?.dialogueApi;
  if (!source) return globalApi;
  // Credentials are atomic; never fill a missing key/model from a different provider.
  return { ...globalApi, ...pickDialogueApi(source), apiType: llmApiType(source) };
}

export function pickDialogueApi(api: DialogueApiConfig): DialogueApiConfig {
  return {
    baseUrl: normalizeLlmBaseUrl(normalizeApiBaseUrl(api.baseUrl), api.apiType),
    ...(api.apiType ? {apiType: api.apiType} : {}),
    apiKey: normalizeApiCredential(api.apiKey),
    model: normalizeApiModel(api.model),
    ...(typeof api.stream === 'boolean' ? { stream: api.stream } : {}),
    ...(typeof api.temperature === 'number' ? { temperature: api.temperature } : {}),
    ...(normalizeDialogueMaxTokens(api.maxTokens) !== undefined ? { maxTokens: api.maxTokens } : {}),
  };
}

export function describeDialogueApi(api: DialogueApiConfig): string {
  let host = '';
  try { host = new URL(api.baseUrl).host; } catch { /* Unconfigured/invalid URL. Never display credentials. */ }
  return [host, api.model || '未设置模型'].filter(Boolean).join(' · ');
}

/**
 * 定时主动消息唯一 API 入口：独立配置 > 角色私聊配置 > 全局对话配置。
 * 只用于到点生成；正常聊天及调用预约工具后的后续轮次仍用原对话 API。
 * 用户显式打开独立 API 却没配置完整时直接报错，不悄悄烧主模型的费用。
 */
export function resolveScheduledMessageApi(
  globalApi: APIConfig,
  character: Pick<CharacterProfile, 'dialogueApi'> | null | undefined,
  config?: Pick<ActiveMsg2CharacterConfig, 'useSecondaryApi' | 'secondaryApi'> | null,
): APIConfig {
  if (config?.useSecondaryApi !== true) return resolveDialogueApi(globalApi, character);
  const api = config.secondaryApi;
  if (!api?.baseUrl?.trim() || !api.apiKey?.trim() || !api.model?.trim()) {
    throw new Error('主动消息独立 API 未配置完整：需要 URL / Key / 模型；已阻止回退到主聊天模型。');
  }
  return resolveDialogueApi(globalApi, character, api);
}
