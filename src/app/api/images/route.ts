import { buildAttachmentUrl, getAttachmentsBucketName, jsonResponse } from '@/features/attachments/server';
import { createSignedAttachmentUrl } from '@/features/attachments/server';
import { IMAGE_GENERATION_MODEL, IMAGE_GENERATION_MODELS, isImageGenerationModel } from '@/shared/core/constants';
import { ImageGenerateRequestSchema } from '@/shared/validation/request-validation';
import { type Attachment } from '@/shared/core/types';
import {
    CHUTES_MISSING_API_KEY_MESSAGE,
    getChutesApiKey,
    getChutesImageApiUrlCandidates,
    getChutesImageApiUrlEnvKey,
    getChutesImageEditApiUrlCandidates,
} from '@/server/providers/chutes';
import { assertThreadOwnership } from '@/features/threads/server';
import { executeIdempotentRequest } from '@/server/redis/idempotency';
import { acquireScopedSlotsLock } from '@/server/redis/locks';
import { fetchWithSsrfGuard } from '@/server/security/ssrf-guard';
import { assertNotTemporarilyBlocked, recordAbuseSignal } from '@/server/security/abuse-protection';
import { assertJsonRequest, assertValidPostOrigin, parseJsonObjectRequest, requireUser, toJsonErrorResponse } from '@/utils/api-security';
import { assertRateLimit, imageRateLimiter } from '@/utils/rate-limit';
import { createClient } from '@/utils/supabase/server';

export const runtime = 'nodejs';

const DEFAULT_IMAGE_WIDTH = 1024;
const DEFAULT_IMAGE_HEIGHT = 1024;
const DEFAULT_NUM_INFERENCE_STEPS = 9;
const DEFAULT_GUIDANCE_SCALE = 0;
const DEFAULT_SHIFT = 3;
const DEFAULT_MAX_SEQUENCE_LENGTH = 512;
const HUNYUAN_IMAGE_MODEL = 'tencent/hunyuan-image-3';
const QWEN_IMAGE_MODEL = 'Qwen/Qwen-Image-2512';
const HIDREAM_IMAGE_MODEL = 'hidream/hidream';
const DEFAULT_HUNYUAN_STEPS = 50;
const DEFAULT_HUNYUAN_CFG = 7.5;
const DEFAULT_QWEN_GENERATE_WIDTH = 1328;
const DEFAULT_QWEN_GENERATE_HEIGHT = 1328;
const DEFAULT_QWEN_GENERATE_STEPS = 50;
const DEFAULT_QWEN_GENERATE_TRUE_CFG_SCALE = 4;
const DEFAULT_QWEN_GENERATE_NEGATIVE_PROMPT = '';
const DEFAULT_HIDREAM_GUIDANCE_SCALE = 5;
const DEFAULT_HIDREAM_STEPS = 50;
const DEFAULT_EDIT_IMAGE_WIDTH = 1328;
const DEFAULT_EDIT_IMAGE_HEIGHT = 1328;
const DEFAULT_EDIT_TRUE_CFG_SCALE = 4;
const DEFAULT_EDIT_NUM_INFERENCE_STEPS = 40;
const DEFAULT_EDIT_NEGATIVE_PROMPT = '';
const IMAGE_RETRYABLE_STATUSES = new Set([502, 503]);
const IMAGE_RETRY_ATTEMPTS = 2;
const IMAGE_RETRY_BACKOFF_MS = 350;
const IS_DEV = process.env.NODE_ENV !== 'production';

function getImageModelName(modelId: string) {
    return IMAGE_GENERATION_MODELS.find((model) => model.id === modelId)?.name ?? modelId;
}

function getImageRequestAttempts(modelId: string, prompt: string, width: number, height: number) {
    if (modelId === HUNYUAN_IMAGE_MODEL) {
        return [
            {
                label: 'hunyuan-generate',
                body: {
                    prompt,
                    size: `${width}x${height}`,
                    steps: DEFAULT_HUNYUAN_STEPS,
                    guidance_scale: DEFAULT_HUNYUAN_CFG,
                    seed: null,
                },
            },
            {
                label: 'hunyuan-prompt-only-fallback',
                body: { prompt },
            },
        ] as const;
    }

    if (modelId === QWEN_IMAGE_MODEL) {
        return [
            {
                label: 'qwen-image-generate',
                body: {
                    prompt,
                    negative_prompt: DEFAULT_QWEN_GENERATE_NEGATIVE_PROMPT,
                    height: DEFAULT_QWEN_GENERATE_HEIGHT,
                    width: DEFAULT_QWEN_GENERATE_WIDTH,
                    num_inference_steps: DEFAULT_QWEN_GENERATE_STEPS,
                    true_cfg_scale: DEFAULT_QWEN_GENERATE_TRUE_CFG_SCALE,
                },
            },
            {
                label: 'qwen-prompt-only-fallback',
                body: { prompt },
            },
        ] as const;
    }

    if (modelId === HIDREAM_IMAGE_MODEL) {
        return [
            {
                label: 'hidream-generate',
                body: {
                    seed: null,
                    prompt,
                    resolution: `${width}x${height}`,
                    guidance_scale: DEFAULT_HIDREAM_GUIDANCE_SCALE,
                    num_inference_steps: DEFAULT_HIDREAM_STEPS,
                },
            },
            {
                label: 'hidream-prompt-only-fallback',
                body: { prompt },
            },
        ] as const;
    }

    return [
        {
            label: 'image-generate',
            body: {
                prompt,
                width,
                height,
                num_inference_steps: DEFAULT_NUM_INFERENCE_STEPS,
                guidance_scale: DEFAULT_GUIDANCE_SCALE,
                shift: DEFAULT_SHIFT,
                max_sequence_length: DEFAULT_MAX_SEQUENCE_LENGTH,
            },
        },
        {
            label: 'prompt-only-fallback',
            body: { prompt },
        },
        {
            label: 'input-args-fallback',
            body: {
                input_args: {
                    prompt,
                },
            },
        },
    ] as const;
}

function wait(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function getText(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
}

function inferImageMimeType(bytes: Uint8Array, fallback: string = 'image/png') {
    if (bytes.length >= 8) {
        const isPng =
            bytes[0] === 0x89 &&
            bytes[1] === 0x50 &&
            bytes[2] === 0x4e &&
            bytes[3] === 0x47 &&
            bytes[4] === 0x0d &&
            bytes[5] === 0x0a &&
            bytes[6] === 0x1a &&
            bytes[7] === 0x0a;
        if (isPng) return 'image/png';
    }

    if (bytes.length >= 3) {
        const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
        if (isJpeg) return 'image/jpeg';
    }

    if (bytes.length >= 12) {
        const riff = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
        const webp = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
        if (riff === 'RIFF' && webp === 'WEBP') return 'image/webp';
    }

    if (bytes.length >= 6) {
        const gif = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5]);
        if (gif === 'GIF87a' || gif === 'GIF89a') return 'image/gif';
    }

    return fallback;
}

function extensionForMimeType(mimeType: string) {
    switch (mimeType) {
        case 'image/jpeg':
            return '.jpg';
        case 'image/webp':
            return '.webp';
        case 'image/gif':
            return '.gif';
        case 'image/png':
        default:
            return '.png';
    }
}

function normalizePotentialBase64(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return '';
    const dataUrlMatch = trimmed.match(/^data:[^;]+;base64,(.+)$/i);
    return dataUrlMatch?.[1]?.trim() || trimmed;
}

function readStringOrFirst(value: unknown) {
    if (typeof value === 'string') return value;
    if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
    return '';
}

function tryExtractImageField(payload: Record<string, unknown>) {
    const directData = Array.isArray(payload.data) ? payload.data[0] : null;
    const sources: Array<Record<string, unknown>> = [payload];
    if (directData && typeof directData === 'object') {
        sources.push(directData as Record<string, unknown>);
    }

    for (const source of sources) {
        const b64Keys = ['image', 'image_b64', 'output', 'result', 'b64_json', 'base64'];
        for (const key of b64Keys) {
            const raw = source[key];
            const value = readStringOrFirst(raw);
            if (!value) continue;
            if (/^https?:\/\//i.test(value)) {
                return { url: value, declaredMimeType: getText(source.mime_type) || getText(source.content_type) };
            }
            return { b64: normalizePotentialBase64(value), declaredMimeType: getText(source.mime_type) || getText(source.content_type) };
        }

        const nested = source.output;
        if (nested && typeof nested === 'object') {
            const nestedRecord = nested as Record<string, unknown>;
            const nestedB64 =
                readStringOrFirst(nestedRecord.image)
                || readStringOrFirst(nestedRecord.image_b64)
                || readStringOrFirst(nestedRecord.b64_json)
                || readStringOrFirst(nestedRecord.base64);
            if (nestedB64) {
                return {
                    b64: normalizePotentialBase64(nestedB64),
                    declaredMimeType: getText(nestedRecord.mime_type) || getText(nestedRecord.content_type),
                };
            }
            const nestedUrl = readStringOrFirst(nestedRecord.url) || readStringOrFirst(nestedRecord.image_url);
            if (nestedUrl) {
                return {
                    url: nestedUrl,
                    declaredMimeType: getText(nestedRecord.mime_type) || getText(nestedRecord.content_type),
                };
            }
        }

        const url =
            readStringOrFirst(source.url)
            || readStringOrFirst(source.image_url)
            || readStringOrFirst(source.output_url)
            || readStringOrFirst(source.result_url);
        if (url) {
            return { url, declaredMimeType: getText(source.mime_type) || getText(source.content_type) };
        }
    }

    return null;
}

async function resolveImageData(
    payload: Record<string, unknown>,
    signal?: AbortSignal
): Promise<{ bytes: Uint8Array; mimeType: string; revisedPrompt?: string }> {
    const data = Array.isArray(payload.data) ? payload.data : [];
    const first = data[0];
    if (!first || typeof first !== 'object') {
        throw new Error('Image API returned no data');
    }

    const entry = first as Record<string, unknown>;
    const revisedPrompt = getText(entry.revised_prompt) || undefined;
    const declaredMimeType =
        getText(entry.mime_type) ||
        getText(entry.content_type) ||
        getText(payload.mime_type) ||
        getText(payload.content_type) ||
        'image/png';

    const b64Json = getText(entry.b64_json) || getText(entry.base64);
    if (b64Json) {
        const bytes = Uint8Array.from(Buffer.from(b64Json, 'base64'));
        if (bytes.length === 0) {
            throw new Error('Image API returned empty base64 payload');
        }
        return {
            bytes,
            mimeType: inferImageMimeType(bytes, declaredMimeType),
            revisedPrompt,
        };
    }

    const url = getText(entry.url);
    if (url) {
        const response = await fetchWithSsrfGuard(url, { signal });
        if (!response.ok) {
            throw new Error(`Image download failed (${response.status})`);
        }
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.length === 0) {
            throw new Error('Image API returned empty image');
        }
        const headerMimeType = getText(response.headers.get('content-type') || '').split(';')[0] || declaredMimeType;
        return {
            bytes,
            mimeType: inferImageMimeType(bytes, headerMimeType || declaredMimeType),
            revisedPrompt,
        };
    }

    throw new Error('Image API response missing both b64_json and url');
}

async function resolveImageEditData(
    payload: Record<string, unknown>,
    signal?: AbortSignal
): Promise<{ bytes: Uint8Array; mimeType: string; revisedPrompt?: string }> {
    const extracted = tryExtractImageField(payload);
    if (extracted?.b64) {
        const bytes = Uint8Array.from(Buffer.from(extracted.b64, 'base64'));
        if (bytes.length === 0) {
            throw new Error('Image edit API returned empty base64 payload');
        }
        return {
            bytes,
            mimeType: inferImageMimeType(bytes, extracted.declaredMimeType || 'image/png'),
        };
    }

    if (extracted?.url) {
        const response = await fetchWithSsrfGuard(extracted.url, { signal });
        if (!response.ok) {
            throw new Error(`Image edit download failed (${response.status})`);
        }
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.length === 0) {
            throw new Error('Image edit API returned empty image');
        }
        const headerMimeType = getText(response.headers.get('content-type') || '').split(';')[0] || extracted.declaredMimeType || 'image/png';
        return {
            bytes,
            mimeType: inferImageMimeType(bytes, headerMimeType),
        };
    }

    // Fallback for providers that return OpenAI-like { data: [{ b64_json|url }] }.
    return resolveImageData(payload, signal);
}

interface GeneratedImage {
    bytes: Uint8Array;
    mimeType: string;
    revisedPrompt?: string;
}

export async function POST(req: Request) {
    let supabase: ReturnType<typeof createClient>;
    let user: Awaited<ReturnType<typeof requireUser>>['user'];
    try {
        assertValidPostOrigin(req);
        assertJsonRequest(req);
        const auth = await requireUser();
        supabase = auth.supabase;
        user = auth.user;
        await assertNotTemporarilyBlocked(user.id, 'image');
        try {
            await assertRateLimit(user.id, imageRateLimiter);
        } catch (rateLimitError) {
            await recordAbuseSignal(user.id, 'image', 'rate-limit');
            throw rateLimitError;
        }
    } catch (error) {
        const response = toJsonErrorResponse(error);
        if (response) {
            return response;
        }
        return jsonResponse({ error: 'Internal server error' }, 500);
    }

    let record: Record<string, unknown>;
    try {
        record = await parseJsonObjectRequest(req);
    } catch (error) {
        const response = toJsonErrorResponse(error);
        if (response) return response;
        return jsonResponse({ error: 'Invalid JSON body' }, 400);
    }

    const parsed = ImageGenerateRequestSchema.safeParse(record);
    if (!parsed.success) {
        return jsonResponse({ error: parsed.error.issues[0]?.message || 'Invalid request body' }, 400);
    }

    const { threadId, prompt, attachments: inputAttachments } = parsed.data;
    const requestedModel = parsed.data.model?.trim() ?? '';
    const selectedModel = requestedModel || IMAGE_GENERATION_MODEL;
    const width = DEFAULT_IMAGE_WIDTH;
    const height = DEFAULT_IMAGE_HEIGHT;
    if (!isImageGenerationModel(selectedModel)) {
        const supportedModelIds = IMAGE_GENERATION_MODELS.map((model) => model.id).join(', ');
        return jsonResponse({
            error: `Unsupported image model "${selectedModel}". Supported models: ${supportedModelIds}`,
        }, 400);
    }

    return executeIdempotentRequest(
        {
            req,
            scope: 'images-post',
            userId: user.id,
            inProgressMessage: 'An equivalent image request is already being processed.',
        },
        async () => {
            try {
        await assertThreadOwnership(supabase, threadId, user.id);
        const attachmentPrefix = `${user.id}/${threadId}/`;
        for (const attachment of inputAttachments) {
            if (!attachment.path.startsWith(attachmentPrefix)) {
                return jsonResponse({ error: 'Invalid attachment path' }, 400);
            }
        }
        const generationLock = await acquireScopedSlotsLock('generation-image', user.id, 2);
        if (!generationLock) {
            await recordAbuseSignal(user.id, 'image', 'concurrency-limit');
            return jsonResponse({ error: 'Too many concurrent image generations. Please wait and retry.' }, 429);
        }
        try {

        const imageEditAttachments = inputAttachments.filter((attachment) => attachment.mimeType.startsWith('image/'));
        if (inputAttachments.length > 0 && imageEditAttachments.length === 0) {
            return jsonResponse({ error: 'Image edit requires at least one image attachment' }, 400);
        }
        const isImageEditRequest = imageEditAttachments.length > 0;
        const chutesApiKey = getChutesApiKey();
        if (!chutesApiKey) {
            return jsonResponse({ error: CHUTES_MISSING_API_KEY_MESSAGE }, 500);
        }
        const bucket = getAttachmentsBucketName();

        let generated: GeneratedImage | null = null;
        let lastStatus = 0;
        let lastErrorText = '';
        let lastAttemptLabel = '';
        let lastAttemptUrl = '';

        if (isImageEditRequest) {
            let imageB64s: string[];
            try {
                imageB64s = await Promise.all(
                    imageEditAttachments.map(async (attachment) => {
                        const { data, error } = await supabase.storage.from(bucket).download(attachment.path);
                        if (error || !data) {
                            throw new Error(error?.message || `Failed to read attachment ${attachment.name}`);
                        }
                        const bytes = new Uint8Array(await data.arrayBuffer());
                        if (bytes.length === 0) {
                            throw new Error(`Attachment ${attachment.name} is empty`);
                        }
                        return Buffer.from(bytes).toString('base64');
                    }),
                );
            } catch (error) {
                return jsonResponse({ error: error instanceof Error ? error.message : 'Failed to read attachment' }, 400);
            }

            const targetApiUrls = getChutesImageEditApiUrlCandidates();
            for (const apiUrl of targetApiUrls) {
                lastAttemptLabel = 'qwen-image-edit';
                lastAttemptUrl = apiUrl;
                for (let retry = 0; retry <= IMAGE_RETRY_ATTEMPTS; retry++) {
                    const chutesResponse = await fetch(apiUrl, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${chutesApiKey}`,
                        },
                        body: JSON.stringify({
                            prompt,
                            image_b64s: imageB64s,
                            width: DEFAULT_EDIT_IMAGE_WIDTH,
                            height: DEFAULT_EDIT_IMAGE_HEIGHT,
                            true_cfg_scale: DEFAULT_EDIT_TRUE_CFG_SCALE,
                            num_inference_steps: DEFAULT_EDIT_NUM_INFERENCE_STEPS,
                            negative_prompt: DEFAULT_EDIT_NEGATIVE_PROMPT,
                            seed: null,
                        }),
                        signal: req.signal,
                    });

                    const contentType = getText(chutesResponse.headers.get('content-type') || '').toLowerCase();
                    if (!chutesResponse.ok) {
                        lastStatus = chutesResponse.status;
                        lastErrorText = await chutesResponse.text().catch(() => '') || chutesResponse.statusText || 'Unknown upstream error';
                        const shouldRetry = IMAGE_RETRYABLE_STATUSES.has(chutesResponse.status)
                            && retry < IMAGE_RETRY_ATTEMPTS;
                        if (shouldRetry) {
                            await wait(IMAGE_RETRY_BACKOFF_MS * (retry + 1));
                            continue;
                        }
                        break;
                    }

                    try {
                        if (contentType.startsWith('image/')) {
                            generated = {
                                bytes: new Uint8Array(await chutesResponse.arrayBuffer()),
                                mimeType: contentType.split(';')[0] || 'image/png',
                            };
                            break;
                        }

                        const rawText = await chutesResponse.text();
                        let parsedPayload: Record<string, unknown> | null = null;
                        try {
                            const parsed = JSON.parse(rawText) as unknown;
                            if (parsed && typeof parsed === 'object') {
                                parsedPayload = parsed as Record<string, unknown>;
                            }
                        } catch (error) {
                            if (IS_DEV) {
                                console.warn('[images] Failed to parse edit API JSON response', { apiUrl, error });
                            }
                            parsedPayload = null;
                        }

                        if (!parsedPayload) {
                            throw new Error(rawText || 'Unsupported image edit API response format');
                        }

                        generated = await resolveImageEditData(parsedPayload, req.signal);
                        break;
                    } catch (error) {
                        lastStatus = chutesResponse.status || 500;
                        lastErrorText = error instanceof Error ? error.message : 'Failed to parse image edit API response';
                    }

                    break;
                }

                if (generated) break;
            }
        } else {
            const targetApiUrls = getChutesImageApiUrlCandidates(selectedModel);
            if (targetApiUrls.length === 0) {
                const envKey = getChutesImageApiUrlEnvKey(selectedModel);
                return jsonResponse({
                    error: `No API URL configured for image model "${getImageModelName(selectedModel)}". Set ${envKey}.`,
                }, 500);
            }
            const requestAttempts = getImageRequestAttempts(selectedModel, prompt, width, height);

            for (const apiUrl of targetApiUrls) {
                for (const attempt of requestAttempts) {
                    lastAttemptLabel = attempt.label;
                    lastAttemptUrl = apiUrl;
                    for (let retry = 0; retry <= IMAGE_RETRY_ATTEMPTS; retry++) {
                        const chutesResponse = await fetch(apiUrl, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${chutesApiKey}`,
                            },
                            body: JSON.stringify(attempt.body),
                            signal: req.signal,
                        });

                        const contentType = getText(chutesResponse.headers.get('content-type') || '').toLowerCase();
                        if (!chutesResponse.ok) {
                            lastStatus = chutesResponse.status;
                            lastErrorText = await chutesResponse.text().catch(() => '') || chutesResponse.statusText || 'Unknown upstream error';
                            const shouldRetry = IMAGE_RETRYABLE_STATUSES.has(chutesResponse.status)
                                && retry < IMAGE_RETRY_ATTEMPTS;
                            if (shouldRetry) {
                                await wait(IMAGE_RETRY_BACKOFF_MS * (retry + 1));
                                continue;
                            }
                            break;
                        }

                        try {
                            if (contentType.startsWith('image/')) {
                                generated = {
                                    bytes: new Uint8Array(await chutesResponse.arrayBuffer()),
                                    mimeType: contentType.split(';')[0] || 'image/png',
                                };
                                break;
                            }

                            const rawText = await chutesResponse.text();
                            let parsedPayload: Record<string, unknown> | null = null;
                            try {
                                const parsed = JSON.parse(rawText) as unknown;
                                if (parsed && typeof parsed === 'object') {
                                    parsedPayload = parsed as Record<string, unknown>;
                                }
                            } catch (error) {
                                if (IS_DEV) {
                                    console.warn('[images] Failed to parse upstream JSON response', {
                                        attempt: attempt.label,
                                        apiUrl,
                                        error,
                                    });
                                }
                                parsedPayload = null;
                            }

                            if (!parsedPayload) {
                                throw new Error(rawText || 'Unsupported image API response format');
                            }

                            generated = await resolveImageData(parsedPayload, req.signal);
                            break;
                        } catch (error) {
                            lastStatus = chutesResponse.status || 500;
                            lastErrorText = error instanceof Error ? error.message : 'Failed to parse image API response';
                        }

                        break;
                    }

                    if (generated) break;
                }

                if (generated) {
                    break;
                }
            }
        }

        if (!generated) {
            const mappedStatus = lastStatus >= 400 && lastStatus < 500 ? lastStatus : 502;
            return jsonResponse({
                error: `Chutes ${isImageEditRequest ? 'image edit' : 'image'} API error for "${getImageModelName(selectedModel)}" (${lastAttemptLabel || 'unknown attempt'} @ ${lastAttemptUrl || 'unknown url'}): ${lastErrorText || 'No error details provided'}`,
            }, mappedStatus);
        }

        const attachmentId = crypto.randomUUID();
        const mimeType = generated.mimeType;
        const extension = extensionForMimeType(mimeType);
        const fileName = `${isImageEditRequest ? 'edited' : 'generated'}-${Date.now()}-${attachmentId.slice(0, 8)}${extension}`;
        const objectPath = `${user.id}/${threadId}/${fileName}`;

        const { error: uploadError } = await supabase.storage
            .from(bucket)
            .upload(objectPath, generated.bytes, {
                contentType: mimeType,
                upsert: false,
                cacheControl: '3600',
            });

        if (uploadError) {
            return jsonResponse({ error: uploadError.message || 'Failed to store processed image' }, 500);
        }
        const signedUrl = await createSignedAttachmentUrl(supabase, bucket, objectPath);

        const attachment: Attachment = {
            id: attachmentId,
            name: fileName,
            mimeType,
            size: generated.bytes.byteLength,
            path: objectPath,
            url: signedUrl || buildAttachmentUrl(threadId, objectPath),
        };

        return jsonResponse({
            attachment,
            revisedPrompt: generated.revisedPrompt ?? null,
            operation: isImageEditRequest ? 'edit' : 'generate',
        });
        } finally {
            await generationLock.release();
        }
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Failed to process image request';
                await recordAbuseSignal(user.id, 'image', 'processing-error');
                return jsonResponse({ error: message }, 500);
            }
        }
    );
}
