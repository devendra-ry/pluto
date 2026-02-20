import 'server-only';

import { readOptionalServerEnv, serverEnv } from '@/lib/env/server';

export const CHUTES_MISSING_API_KEY_MESSAGE = 'Chutes API key missing (set CHUTES_API_KEY or CHUTES_API_TOKEN)';

const DEFAULT_Z_IMAGE_GENERATE_URL = 'https://chutes-z-image-turbo.chutes.ai/generate';
const DEFAULT_HUNYUAN_IMAGE_GENERATE_URL = 'https://chutes-hunyuan-image-3.chutes.ai/generate';
const DEFAULT_QWEN_IMAGE_GENERATE_URL = 'https://chutes-qwen-image-2512.chutes.ai/generate';
const DEFAULT_HIDREAM_IMAGE_GENERATE_URL = 'https://chutes-hidream.chutes.ai/generate';
const DEFAULT_QWEN_IMAGE_EDIT_URL = 'https://chutes-qwen-image-edit-2511.chutes.ai/generate';
const DEFAULT_VIDEO_API_URL = 'https://chutes-wan-2-2-i2v-14b-fast.chutes.ai/generate';

const Z_IMAGE_MODEL_ID = 'zai-org/z-image-turbo';
const HUNYUAN_IMAGE_MODEL_ID = 'tencent/hunyuan-image-3';
const QWEN_IMAGE_MODEL_ID = 'Qwen/Qwen-Image-2512';
const HIDREAM_IMAGE_MODEL_ID = 'hidream/hidream';

function uniqueUrls(urls: Array<string | undefined>) {
    const set = new Set<string>();
    for (const url of urls) {
        const normalized = url?.trim();
        if (!normalized) continue;
        set.add(normalized);
    }
    return Array.from(set);
}

function modelIdToEnvSuffix(modelId: string) {
    return modelId.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
}

export function getChutesImageApiUrlEnvKey(modelId: string) {
    return `CHUTES_IMAGE_API_URL_${modelIdToEnvSuffix(modelId)}`;
}

export function getChutesApiKey() {
    return serverEnv.CHUTES_API_KEY || serverEnv.CHUTES_API_TOKEN || null;
}

export function getChutesImageApiUrlCandidates(modelId: string) {
    const modelScopedEnvKey = getChutesImageApiUrlEnvKey(modelId);
    const defaultModelUrls = modelId === Z_IMAGE_MODEL_ID
        ? [
            readOptionalServerEnv('CHUTES_Z_IMAGE_API_URL'),
            readOptionalServerEnv('CHUTES_Z_IMAGE_URL'),
            DEFAULT_Z_IMAGE_GENERATE_URL,
        ]
        : modelId === HUNYUAN_IMAGE_MODEL_ID
        ? [
            readOptionalServerEnv('CHUTES_HUNYUAN_IMAGE_API_URL'),
            readOptionalServerEnv('CHUTES_HUNYUAN_IMAGE_URL'),
            DEFAULT_HUNYUAN_IMAGE_GENERATE_URL,
        ]
        : modelId === QWEN_IMAGE_MODEL_ID
        ? [
            readOptionalServerEnv('CHUTES_QWEN_IMAGE_2512_API_URL'),
            readOptionalServerEnv('CHUTES_QWEN_IMAGE_2512_URL'),
            readOptionalServerEnv('CHUTES_QWEN_IMAGE_API_URL'),
            readOptionalServerEnv('CHUTES_QWEN_IMAGE_URL'),
            DEFAULT_QWEN_IMAGE_GENERATE_URL,
        ]
        : modelId === HIDREAM_IMAGE_MODEL_ID
        ? [
            readOptionalServerEnv('CHUTES_HIDREAM_API_URL'),
            readOptionalServerEnv('CHUTES_HIDREAM_URL'),
            DEFAULT_HIDREAM_IMAGE_GENERATE_URL,
        ]
        : [];

    return uniqueUrls([
        readOptionalServerEnv(modelScopedEnvKey),
        ...defaultModelUrls,
    ]);
}

export function getChutesImageEditApiUrlCandidates() {
    return uniqueUrls([
        readOptionalServerEnv('CHUTES_QWEN_IMAGE_EDIT_API_URL'),
        readOptionalServerEnv('CHUTES_QWEN_IMAGE_EDIT_URL'),
        DEFAULT_QWEN_IMAGE_EDIT_URL,
    ]);
}

export function getChutesVideoApiUrlCandidates() {
    return uniqueUrls([
        readOptionalServerEnv('CHUTES_WAN_I2V_API_URL'),
        readOptionalServerEnv('CHUTES_WAN_2_2_I2V_URL'),
        readOptionalServerEnv('CHUTES_VIDEO_API_URL'),
        DEFAULT_VIDEO_API_URL,
    ]);
}

export function getChutesWanI2vNegativePrompt() {
    return serverEnv.CHUTES_WAN_I2V_NEGATIVE_PROMPT;
}
