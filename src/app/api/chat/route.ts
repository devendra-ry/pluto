import { handleChatRequest } from '@/server/chat/chat-controller';
import { withSecureContext } from '@/server/http/route-handler';
import { chatRateLimiter } from '@/server/http/rate-limit';

export const runtime = 'nodejs';

export async function POST(req: Request) {
    return withSecureContext(
        req,
        async (context) => {
            return handleChatRequest(req, context);
        },
        chatRateLimiter
    );
}
