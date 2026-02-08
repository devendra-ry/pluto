'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createThread } from '@/hooks/use-threads';
import { DEFAULT_MODEL } from '@/lib/constants';
import { ChatLayout } from '@/components/chat-layout';
import { Loader2 } from 'lucide-react';

export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    const initChat = async () => {
      const thread = await createThread(DEFAULT_MODEL);
      router.replace(`/c/${thread.id}`);
    };
    initChat();
  }, [router]);

  return (
    <ChatLayout>
      <div className="flex flex-col items-center justify-center h-full bg-[#12081a]">
        <Loader2 className="h-8 w-8 text-pink-400 animate-spin mb-4" />
        <span className="text-zinc-400">Starting new chat...</span>
      </div>
    </ChatLayout>
  );
}
