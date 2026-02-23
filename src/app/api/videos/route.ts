import { buildAttachmentUrl, getAttachmentsBucketName, jsonResponse } from '@/features/attachments/lib/attachment-route-utils';
import { createSignedAttachmentUrl } from '@/features/attachments/lib/attachment-signed-url';
import { VIDEO_GENERATION_MODEL } from '@/shared/core/constants';
import { VideoGenerateRequestSchema } from '@/shared/validation/request-validation';
import { type Attachment } from '@/shared/core/types';
import {
    CHUTES_MISSING_API_KEY_MESSAGE,
    getChutesApiKey,
    getChutesVideoApiUrlCandidates,
    getChutesWanI2vNegativePrompt,
} from '@/server/providers/chutes';
import { assertThreadOwnership } from '@/features/threads/server/thread-ownership';
import { fetchWithSsrfGuard } from '@/server/security/ssrf-guard';
import { assertJsonRequest, assertValidPostOrigin, parseJsonObjectRequest, requireUser, toJsonErrorResponse } from '@/utils/api-security';
import { assertRateLimit, videoRateLimiter } from '@/utils/rate-limit';
import { createClient } from '@/utils/supabase/server';

export const runtime = 'nodejs';

const DEFAULT_RESOLUTION = '720p';
const DEFAULT_FRAMES = 81;
const DEFAULT_FPS = 16;
const DEFAULT_GUIDANCE_SCALE = 1.0;
const DEFAULT_NEGATIVE_PROMPT = '';
const VIDEO_RETRYABLE_STATUSES = new Set([502, 503]);
const VIDEO_RETRY_ATTEMPTS = 2;
const VIDEO_RETRY_BACKOFF_MS = 500;
const IS_DEV = process.env.NODE_ENV !== 'production';

function getText(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
}

function wait(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function toInteger(value: unknown, fallback: number, min: number, max: number) {
    const candidate = typeof value === 'number' ? value : Number.NaN;
    if (!Number.isFinite(candidate)) return fallback;
    const rounded = Math.round(candidate);
    if (rounded < min) return min;
    if (rounded > max) return max;
    return rounded;
}

function toNumber(value: unknown, fallback: number, min: number, max: number) {
    const candidate = typeof value === 'number' ? value : Number.NaN;
    if (!Number.isFinite(candidate)) return fallback;
    if (candidate < min) return min;
    if (candidate > max) return max;
    return candidate;
}

function extensionForVideoMimeType(mimeType: string) {
    switch (mimeType) {
        case 'video/webm':
            return '.webm';
        case 'video/quicktime':
            return '.mov';
        case 'video/mp4':
        default:
            return '.mp4';
    }
}

function inferVideoMimeType(bytes: Uint8Array, fallback: string = 'video/mp4') {
    if (bytes.length >= 12) {
        const boxType = String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]);
        if (boxType === 'ftyp') return 'video/mp4';
    }
    if (bytes.length >= 4) {
        const ebml = bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
        if (ebml) return 'video/webm';
    }
    return fallback;
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

async function extractVideoData(
    payload: Record<string, unknown>,
    signal?: AbortSignal
): Promise<{ bytes: Uint8Array; mimeType: string }> {
    const directData = Array.isArray(payload.data) ? payload.data[0] : null;
    const sources: Array<Record<string, unknown>> = [payload];
    if (directData && typeof directData === 'object') {
        sources.push(directData as Record<string, unknown>);
    }

    for (const source of sources) {
        const declaredMimeType =
            getText(source.mime_type)
            || getText(source.content_type)
            || 'video/mp4';
        const b64Keys = ['video', 'video_b64', 'output', 'result', 'base64'];
        for (const key of b64Keys) {
            const value = readStringOrFirst(source[key]);
            if (!value) continue;
            if (/^https?:\/\//i.test(value)) {
                const urlResponse = await fetchWithSsrfGuard(value, { signal });
                if (!urlResponse.ok) {
                    throw new Error(`Video download failed (${urlResponse.status})`);
                }
                const bytes = new Uint8Array(await urlResponse.arrayBuffer());
                if (bytes.length === 0) {
                    throw new Error('Video API returned empty video');
                }
                const headerMimeType = getText(urlResponse.headers.get('content-type') || '').split(';')[0] || declaredMimeType;
                return { bytes, mimeType: inferVideoMimeType(bytes, headerMimeType) };
            }
            const bytes = Uint8Array.from(Buffer.from(normalizePotentialBase64(value), 'base64'));
            if (bytes.length === 0) {
                throw new Error('Video API returned empty base64 payload');
            }
            return {
                bytes,
                mimeType: inferVideoMimeType(bytes, declaredMimeType),
            };
        }

        const url =
            readStringOrFirst(source.video_url)
            || readStringOrFirst(source.output_url)
            || readStringOrFirst(source.result_url)
            || readStringOrFirst(source.url);
        if (url) {
            const urlResponse = await fetchWithSsrfGuard(url, { signal });
            if (!urlResponse.ok) {
                throw new Error(`Video download failed (${urlResponse.status})`);
            }
            const bytes = new Uint8Array(await urlResponse.arrayBuffer());
            if (bytes.length === 0) {
                throw new Error('Video API returned empty video');
            }
            const headerMimeType = getText(urlResponse.headers.get('content-type') || '').split(';')[0] || declaredMimeType;
            return { bytes, mimeType: inferVideoMimeType(bytes, headerMimeType) };
        }
    }

    throw new Error('Video API response missing video data');
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
        assertRateLimit(user.id, videoRateLimiter);
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

    const parsed = VideoGenerateRequestSchema.safeParse(record);
    if (!parsed.success) {
        return jsonResponse({ error: parsed.error.issues[0]?.message || 'Invalid request body' }, 400);
    }

    const {
        threadId,
        model: requestedModelRaw,
        prompt,
        attachments: inputAttachments,
    } = parsed.data;
    const requestedModel = requestedModelRaw?.trim() ?? '';

    if (requestedModel && requestedModel !== VIDEO_GENERATION_MODEL) {
        return jsonResponse({ error: 'Image to Video mode uses an internal model and does not accept model overrides' }, 400);
    }
    if (inputAttachments.length === 0) {
        return jsonResponse({ error: 'Image to Video requires one image attachment' }, 400);
    }

    const apiKey = getChutesApiKey();
    if (!apiKey) {
        return jsonResponse({ error: CHUTES_MISSING_API_KEY_MESSAGE }, 500);
    }

    try {
        await assertThreadOwnership(supabase, threadId, user.id);
        const attachmentPrefix = `${user.id}/${threadId}/`;
        const imageAttachments = inputAttachments.filter((attachment) => attachment.mimeType.startsWith('image/'));
        if (imageAttachments.length === 0) {
            return jsonResponse({ error: 'Image to Video requires an image attachment' }, 400);
        }

        const firstImage = imageAttachments[0];
        if (!firstImage.path.startsWith(attachmentPrefix)) {
            return jsonResponse({ error: 'Invalid attachment path' }, 400);
        }

        const bucket = getAttachmentsBucketName();
        const { data: sourceImageData, error: sourceImageError } = await supabase.storage
            .from(bucket)
            .download(firstImage.path);
        if (sourceImageError || !sourceImageData) {
            return jsonResponse({ error: sourceImageError?.message || 'Failed to read source image attachment' }, 400);
        }

        const sourceImageBytes = new Uint8Array(await sourceImageData.arrayBuffer());
        if (sourceImageBytes.length === 0) {
            return jsonResponse({ error: 'Source image attachment is empty' }, 400);
        }
        const sourceImageBase64 = Buffer.from(sourceImageBytes).toString('base64');

        const payload = {
            image: sourceImageBase64,
            prompt,
            negative_prompt: getText(parsed.data.negative_prompt) || getChutesWanI2vNegativePrompt() || DEFAULT_NEGATIVE_PROMPT,
            resolution: getText(parsed.data.resolution) || DEFAULT_RESOLUTION,
            frames: toInteger(parsed.data.frames, DEFAULT_FRAMES, 21, 140),
            fps: toInteger(parsed.data.fps, DEFAULT_FPS, 1, 60),
            fast: typeof parsed.data.fast === 'boolean' ? parsed.data.fast : false,
            guidance_scale: toNumber(parsed.data.guidance_scale, DEFAULT_GUIDANCE_SCALE, 0, 20),
            seed: (typeof parsed.data.seed === 'number' && Number.isInteger(parsed.data.seed)) ? parsed.data.seed : null,
        };

        let bytes: Uint8Array | null = null;
        let mimeType = 'video/mp4';
        let lastStatus = 0;
        let lastErrorText = '';
        let lastAttemptUrl = '';

        const targetApiUrls = getChutesVideoApiUrlCandidates();
        for (const apiUrl of targetApiUrls) {
            lastAttemptUrl = apiUrl;
            for (let retry = 0; retry <= VIDEO_RETRY_ATTEMPTS; retry++) {
                const chutesResponse = await fetch(apiUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${apiKey}`,
                    },
                    body: JSON.stringify(payload),
                    signal: req.signal,
                });

                const contentType = getText(chutesResponse.headers.get('content-type') || '').toLowerCase();
                if (!chutesResponse.ok) {
                    lastStatus = chutesResponse.status;
                    lastErrorText = await chutesResponse.text().catch(() => '') || chutesResponse.statusText || 'Unknown upstream error';
                    const shouldRetry = VIDEO_RETRYABLE_STATUSES.has(chutesResponse.status)
                        && retry < VIDEO_RETRY_ATTEMPTS;
                    if (shouldRetry) {
                        await wait(VIDEO_RETRY_BACKOFF_MS * (retry + 1));
                        continue;
                    }
                    break;
                }

                try {
                    if (contentType.startsWith('video/')) {
                        bytes = new Uint8Array(await chutesResponse.arrayBuffer());
                        mimeType = contentType.split(';')[0] || 'video/mp4';
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
                            console.warn('[videos] Failed to parse upstream JSON response', { apiUrl, error });
                        }
                        parsedPayload = null;
                    }

                    if (!parsedPayload) {
                        throw new Error(rawText || 'Unsupported video API response format');
                    }

                    const resolved = await extractVideoData(parsedPayload, req.signal);
                    bytes = resolved.bytes;
                    mimeType = resolved.mimeType;
                    break;
                } catch (error) {
                    lastStatus = chutesResponse.status || 500;
                    lastErrorText = error instanceof Error ? error.message : 'Failed to parse video API response';
                }

                break;
            }

            if (bytes) break;
        }

        if (!bytes || bytes.length === 0) {
            const mappedStatus = lastStatus >= 400 && lastStatus < 500 ? lastStatus : 502;
            return jsonResponse({
                error: `Chutes video API error (@ ${lastAttemptUrl || 'unknown url'}): ${lastErrorText || 'No error details provided'}`,
            }, mappedStatus);
        }

        const attachmentId = crypto.randomUUID();
        const extension = extensionForVideoMimeType(mimeType);
        const fileName = `generated-video-${Date.now()}-${attachmentId.slice(0, 8)}${extension}`;
        const objectPath = `${user.id}/${threadId}/${fileName}`;

        const { error: uploadError } = await supabase.storage
            .from(bucket)
            .upload(objectPath, bytes, {
                contentType: mimeType,
                upsert: false,
                cacheControl: '3600',
            });
        if (uploadError) {
            return jsonResponse({ error: uploadError.message || 'Failed to store generated video' }, 500);
        }
        const signedUrl = await createSignedAttachmentUrl(supabase, bucket, objectPath);

        const attachment: Attachment = {
            id: attachmentId,
            name: fileName,
            mimeType,
            size: bytes.byteLength,
            path: objectPath,
            url: signedUrl || buildAttachmentUrl(threadId, objectPath),
        };

        return jsonResponse({
            attachment,
            operation: 'video',
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to generate video';
        return jsonResponse({ error: message }, 500);
    }
}


