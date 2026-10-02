import { DELETE as deleteUpload, GET as getUpload, POST as postUpload } from '@/server/uploads/upload-handler';
import { responseWithRequestId, withSpan } from '@/server/observability/tracing';

function tracedHandler(method: string, handler: (req: Request) => Promise<Response>) {
    return async (req: Request) => {
        const requestId = crypto.randomUUID();
        const response = await withSpan(`uploads.${method}`, { 'pluto.request_id': requestId }, () => handler(req));
        return responseWithRequestId(response, requestId);
    };
}

export const GET = tracedHandler('download', getUpload);
export const POST = tracedHandler('upload', postUpload);
export const DELETE = tracedHandler('delete', deleteUpload);

export const runtime = 'nodejs';
