import { handleChatRequest } from '@/server/chat/chat-controller';
import { withSecureContext } from '@/server/http/route-handler';
import { chatRateLimiter } from '@/server/http/rate-limit';
import { responseWithRequestId } from '@/server/observability/tracing';

export const runtime = 'nodejs';

export async function POST(req: Request) {
    const requestId = crypto.randomUUID();
    const response = await withSecureContext(
        req,
        async (context) => {
            return handleChatRequest(req, context, requestId);
        },
        chatRateLimiter
    );
    return responseWithRequestId(response, requestId);
}
