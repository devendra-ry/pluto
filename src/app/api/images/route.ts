import { cookies } from 'next/headers';

import { DEFAULT_ATTACHMENTS_BUCKET } from '@/lib/attachments';
import { AVAILABLE_MODELS, IMAGE_GENERATION_MODEL } from '@/lib/constants';
import { type Attachment } from '@/lib/types';
import { createClient } from '@/utils/supabase/server';

export const runtime = 'nodejs';

const DEFAULT_IMAGE_WIDTH = 1024;
const DEFAULT_IMAGE_HEIGHT = 1024;
const DEFAULT_NUM_INFERENCE_STEPS = 9;
const DEFAULT_GUIDANCE_SCALE = 0;
const DEFAULT_SHIFT = 3;
const DEFAULT_CHUTES_IMAGES_URL = 'https://llm.chutes.ai/v1/images/generations';

function getBucketName() {
    return process.env.SUPABASE_ATTACHMENTS_BUCKET
        || process.env.NEXT_PUBLIC_SUPABASE_ATTACHMENTS_BUCKET
        || DEFAULT_ATTACHMENTS_BUCKET;
}

function getImagesApiUrl() {
    return process.env.CHUTES_IMAGES_API_URL
        || process.env.CHUTES_IMAGE_API_URL
        || DEFAULT_CHUTES_IMAGES_URL;
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

export async function POST(req: Request) {
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
        return jsonResponse({ error: 'Invalid JSON body' }, 400);
    }

    const record = body as Record<string, unknown>;
    const threadId = getText(record.threadId);
    const model = getText(record.model);
    const prompt = getText(record.prompt);
    const width = DEFAULT_IMAGE_WIDTH;
    const height = DEFAULT_IMAGE_HEIGHT;
    const numInferenceSteps = DEFAULT_NUM_INFERENCE_STEPS;
    const guidanceScale = DEFAULT_GUIDANCE_SCALE;
    const shift = DEFAULT_SHIFT;

    if (!threadId) {
        return jsonResponse({ error: 'threadId is required' }, 400);
    }
    if (!model) {
        return jsonResponse({ error: 'model is required' }, 400);
    }
    if (!prompt) {
        return jsonResponse({ error: 'prompt is required' }, 400);
    }

    const modelConfig = AVAILABLE_MODELS.find((item) => item.id === model);
    if (!modelConfig) {
        return jsonResponse({ error: 'Invalid model selection' }, 400);
    }
    if (!modelConfig.capabilities.includes('imageGen')) {
        return jsonResponse({ error: 'Selected model does not support image generation' }, 400);
    }
    if (modelConfig.provider === 'openrouter' || modelConfig.provider === 'google') {
        return jsonResponse({ error: 'Image generation is only enabled for chutes-backed models' }, 400);
    }

    const apiKey = process.env.CHUTES_API_KEY;
    if (!apiKey) {
        return jsonResponse({ error: 'Chutes API key missing' }, 500);
    }

    try {
        await assertThreadOwnership(supabase, threadId, user.id);

        const requestBody: Record<string, unknown> = {
            model,
            prompt,
            size: `${width}x${height}`,
            n: 1,
            response_format: 'b64_json',
        };

        if (model === IMAGE_GENERATION_MODEL) {
            requestBody.width = width;
            requestBody.height = height;
            requestBody.num_inference_steps = numInferenceSteps;
            requestBody.guidance_scale = guidanceScale;
            requestBody.shift = shift;
        }

        const chutesResponse = await fetch(getImagesApiUrl(), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify(requestBody),
            signal: req.signal,
        });

        if (!chutesResponse.ok) {
            const responseText = await chutesResponse.text().catch(() => '');
            return jsonResponse({
                error: `Chutes image API error ${chutesResponse.status}: ${responseText || chutesResponse.statusText}`,
            }, 502);
        }

        const contentType = getText(chutesResponse.headers.get('content-type') || '').toLowerCase();
        const generated = contentType.startsWith('image/')
            ? {
                bytes: new Uint8Array(await chutesResponse.arrayBuffer()),
                mimeType: contentType.split(';')[0] || 'image/png',
                revisedPrompt: undefined,
            }
            : await resolveImageData(await chutesResponse.json() as Record<string, unknown>, req.signal);

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
