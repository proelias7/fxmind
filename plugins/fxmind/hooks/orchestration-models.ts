/** Provider-specific presets for the Claude mod's orchestration settings.
 * They are suggestions, not a guarantee that the CLI/account has access.
 * Every provider also supports a full custom model ID.
 */
export type OrchestrationModelOption = { value: string; label: string }

export const MODEL_DEFAULT = '__fxmind_default_model__'
export const MODEL_CUSTOM = '__fxmind_custom_model__'

const PROVIDER_MODELS: Record<string, OrchestrationModelOption[]> = {
  claude: [
    { value: 'sonnet', label: 'Sonnet' },
    { value: 'opus', label: 'Opus' },
    { value: 'haiku', label: 'Haiku' },
    { value: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
    { value: 'claude-opus-4-6', label: 'Opus 4.6' },
  ],
  codex: [
    { value: 'gpt-5.4', label: 'GPT-5.4' },
    { value: 'gpt-5.4-fast', label: 'GPT-5.4 Fast' },
    { value: 'gpt-5.4-codex', label: 'GPT-5.4 Codex' },
    { value: 'gpt-5.3-codex', label: 'GPT-5.3 Codex' },
    { value: 'gpt-5.3-codex-spark', label: 'Codex Spark' },
  ],
  opencode: [
    { value: 'cloudflare-ai-gateway/anthropic/claude-fable-5.2', label: 'Fable 5.2' },
    { value: 'cloudflare-ai-gateway/anthropic/claude-opus-5.5', label: 'Opus 5.5' },
    { value: 'cloudflare-ai-gateway/anthropic/claude-haiku-5.5', label: 'Haiku 5.5' },
    { value: 'anthropic/claude-sonnet-4-6', label: 'Sonnet 4.6' },
    { value: 'openai/gpt-5.4', label: 'GPT-5.4' },
  ],
  'cursor-agent': [
    { value: 'composer-2.5', label: 'Composer 2.5' },
    { value: 'composer-2.5-fast', label: 'Composer Fast' },
    { value: 'gpt-5.6', label: 'GPT-5.6' },
    { value: 'gpt-5.6-fast', label: 'GPT-5.6 Fast' },
    { value: 'claude-opus-4-6', label: 'Opus 4.6' },
  ],
}

export function orchestrationModelOptions(provider: string | null): OrchestrationModelOption[] {
  return [
    { value: MODEL_DEFAULT, label: 'Padrão' },
    ...(PROVIDER_MODELS[provider || ''] || []),
    { value: MODEL_CUSTOM, label: 'Outro…' },
  ]
}

export function orchestrationModelChoice(
  provider: string | null,
  model: string | null | undefined,
  editingCustom = false,
): string {
  if (editingCustom) return MODEL_CUSTOM
  if (!model) return MODEL_DEFAULT
  return orchestrationModelOptions(provider).some(option => option.value === model)
    ? model
    : MODEL_CUSTOM
}

/** Preserve a free-form provider/model ID without allowing control characters. */
export function sanitizeOrchestrationModel(raw: string): string | null {
  const id = String(raw || '').trim()
  if (!id) return null
  // These are model identifiers passed as one CLI argument, never shell text.
  if (id.length > 160 || !/^[A-Za-z0-9][A-Za-z0-9._/@:+-]*$/.test(id)) return null
  return id
}
