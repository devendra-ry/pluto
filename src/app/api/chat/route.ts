import { handleChatRequest } from '@/features/chat/server';
import { withSecureContext } from '@/utils/route-handler';
import { chatRateLimiter } from '@/utils/rate-limit';

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

