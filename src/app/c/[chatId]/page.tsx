import { ChatPageClient } from './chat-page-client';

interface PageProps {
    params: Promise<{ chatId: string }>;
}

export default async function ChatPage({ params }: PageProps) {
    const { chatId } = await params;
    return <ChatPageClient chatId={chatId} />;
}