import { DEFAULT_ATTACHMENTS_BUCKET } from '@/lib/attachments';
import { IMAGE_GENERATION_MODEL } from '@/lib/constants';
import { type Attachment } from '@/lib/types';
import { assertValidPostOrigin, requireUser, toJsonErrorResponse } from '@/utils/api-security';
import { createClient } from '@/utils/supabase/server';

export const runtime = 'nodejs';

const DEFAULT_IMAGE_WIDTH = 1024;
const DEFAULT_IMAGE_HEIGHT = 1024;
const DEFAULT_NUM_INFERENCE_STEPS = 9;
const DEFAULT_GUIDANCE_SCALE = 0;
const DEFAULT_SHIFT = 3;
const DEFAULT_MAX_SEQUENCE_LENGTH = 512;
const DEFAULT_CHUTES_IMAGES_URL = 'https://llm.chutes.ai/v1/images/generations';
const DEFAULT_Z_IMAGE_GENERATE_URL = 'https://chutes-z-image-turbo.chutes.ai/generate';

function getBucketName() {
    return process.env.SUPABASE_ATTACHMENTS_BUCKET
        || process.env.NEXT_PUBLIC_SUPABASE_ATTACHMENTS_BUCKET
        || DEFAULT_ATTACHMENTS_BUCKET;
}

function uniqueUrls(urls: Array<string | undefined>) {
    const set = new Set<string>();
    for (const url of urls) {
        const normalized = getText(url ?? '');
        if (!normalized) continue;
        set.add(normalized);
    }
    return Array.from(set);
}

function getImagesApiUrlCandidates() {
    return uniqueUrls([
        process.env.CHUTES_IMAGES_API_URL,
        process.env.CHUTES_IMAGE_API_URL,
        DEFAULT_CHUTES_IMAGES_URL,
    ]);
}

function getImageApiUrlCandidates() {
    return uniqueUrls([
        process.env.CHUTES_Z_IMAGE_API_URL,
        process.env.CHUTES_Z_IMAGE_URL,
        DEFAULT_Z_IMAGE_GENERATE_URL,
        ...getImagesApiUrlCandidates(),
    ]);
}

function jsonResponse(payload: Record<string, unknown>, status: number = 200) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

async function assertThreadOwnership(
    supabase: ReturnType<typeof createClient>,
    threadId: string,
    userId: string
) {
    const { data, error } = await supabase
        .from('threads')
        .select('id')
        .eq('id', threadId)
        .eq('user_id', userId)
        .single();

    if (error || !data) {
        throw new Error('Thread not found or access denied');
    }
}

function buildAttachmentUrl(threadId: string, path: string) {
    const query = new URLSearchParams({ threadId, path });
    return `/api/uploads?${query.toString()}`;
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
        const response = await fetch(url, { method: 'GET', signal });
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
        const auth = await requireUser();
        supabase = auth.supabase;
        user = auth.user;
    } catch (error) {
        const response = toJsonErrorResponse(error);
        if (response) {
            return response;
        }
        return jsonResponse({ error: 'Internal server error' }, 500);
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
        return jsonResponse({ error: 'Invalid JSON body' }, 400);
    }

    const record = body as Record<string, unknown>;
    const threadId = getText(record.threadId);
    const requestedModel = getText(record.model);
    const model = IMAGE_GENERATION_MODEL;
    const prompt = getText(record.prompt);
    const width = DEFAULT_IMAGE_WIDTH;
    const height = DEFAULT_IMAGE_HEIGHT;
    const numInferenceSteps = DEFAULT_NUM_INFERENCE_STEPS;
    const guidanceScale = DEFAULT_GUIDANCE_SCALE;
    const shift = DEFAULT_SHIFT;

    if (!threadId) {
        return jsonResponse({ error: 'threadId is required' }, 400);
    }
    if (!prompt) {
        return jsonResponse({ error: 'prompt is required' }, 400);
    }
    if (requestedModel && requestedModel !== IMAGE_GENERATION_MODEL) {
        return jsonResponse({ error: 'Image mode uses an internal model and does not accept model overrides' }, 400);
    }

    const apiKey = process.env.CHUTES_API_KEY || process.env.CHUTES_API_TOKEN;
    if (!apiKey) {
        return jsonResponse({ error: 'Chutes API key missing (set CHUTES_API_KEY or CHUTES_API_TOKEN)' }, 500);
    }

    try {
        await assertThreadOwnership(supabase, threadId, user.id);

        const targetApiUrls = getImageApiUrlCandidates();
        const requestAttempts: Array<{ label: string; body: Record<string, unknown> }> = [];

        requestAttempts.push({
            label: 'prompt-only',
            body: { prompt },
        });
        requestAttempts.push({
            label: 'native-image',
            body: {
                prompt,
                width,
                height,
                num_inference_steps: numInferenceSteps,
                guidance_scale: guidanceScale,
                shift,
                max_sequence_length: DEFAULT_MAX_SEQUENCE_LENGTH,
            },
        });
        requestAttempts.push({
            label: 'input-args-native-image',
            body: {
                input_args: {
                    prompt,
                    width,
                    height,
                    num_inference_steps: numInferenceSteps,
                    guidance_scale: guidanceScale,
                    shift,
                    max_sequence_length: DEFAULT_MAX_SEQUENCE_LENGTH,
                },
            },
        });
        requestAttempts.push({
            label: 'input-args-prompt-only',
            body: {
                input_args: {
                    prompt,
                },
            },
        });

        requestAttempts.push({
            label: 'openai-compatible',
            body: {
                model,
                prompt,
                size: `${width}x${height}`,
                n: 1,
                response_format: 'b64_json',
                num_inference_steps: numInferenceSteps,
                guidance_scale: guidanceScale,
                shift,
            },
        });

        let generated: GeneratedImage | null = null;
        let lastStatus = 0;
        let lastErrorText = '';
        let lastAttemptLabel = '';
        let lastAttemptUrl = '';

        for (const apiUrl of targetApiUrls) {
            for (const attempt of requestAttempts) {
                lastAttemptLabel = attempt.label;
                lastAttemptUrl = apiUrl;
                const chutesResponse = await fetch(apiUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${apiKey}`,
                    },
                    body: JSON.stringify(attempt.body),
                    signal: req.signal,
                });

                const contentType = getText(chutesResponse.headers.get('content-type') || '').toLowerCase();

                if (!chutesResponse.ok) {
                    lastStatus = chutesResponse.status;
                    lastErrorText = await chutesResponse.text().catch(() => '') || chutesResponse.statusText || 'Unknown upstream error';
                    continue;
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
                    } catch {
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
            }

            if (generated) {
                break;
            }
        }

        if (!generated) {
            const missingModelSpecificUrl =
                !getText(process.env.CHUTES_Z_IMAGE_API_URL || '')
                && !getText(process.env.CHUTES_Z_IMAGE_URL || '');
            if (lastStatus === 404 && missingModelSpecificUrl) {
                return jsonResponse({
                    error: 'Image endpoint returned 404. Set CHUTES_Z_IMAGE_API_URL for z-image-turbo.',
                }, 502);
            }
            const mappedStatus = lastStatus >= 400 && lastStatus < 500 ? lastStatus : 502;
            return jsonResponse({
                error: `Chutes image API error (${lastAttemptLabel || 'unknown attempt'} @ ${lastAttemptUrl || 'unknown url'}): ${lastErrorText || 'No error details provided'}`,
            }, mappedStatus);
        }

        const bucket = getBucketName();
        const attachmentId = crypto.randomUUID();
        const mimeType = generated.mimeType;
        const extension = extensionForMimeType(mimeType);
        const fileName = `generated-${Date.now()}-${attachmentId.slice(0, 8)}${extension}`;
        const objectPath = `${user.id}/${threadId}/${fileName}`;

        const { error: uploadError } = await supabase.storage
            .from(bucket)
            .upload(objectPath, generated.bytes, {
                contentType: mimeType,
                upsert: false,
                cacheControl: '3600',
            });

        if (uploadError) {
            return jsonResponse({ error: uploadError.message || 'Failed to store generated image' }, 500);
        }

        const attachment: Attachment = {
            id: attachmentId,
            name: fileName,
            mimeType,
            size: generated.bytes.byteLength,
            path: objectPath,
            url: buildAttachmentUrl(threadId, objectPath),
        };

        return jsonResponse({
            attachment,
            revisedPrompt: generated.revisedPrompt ?? null,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to generate image';
        return jsonResponse({ error: message }, 500);
    }
}
