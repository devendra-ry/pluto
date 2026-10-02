import { createRoot } from 'react-dom/client';
import { useLayoutEffect, useState } from 'react';
import { WorkerMarkdown } from '../../../src/features/chat/components/worker-markdown';
import { ChatCodeBlock } from '../../../src/features/chat/components/chat-code-block';
import { ToastProvider } from '../../../src/components/ui/toast';
import type { Components } from 'react-markdown';

declare global {
    interface Window {
        markdownWorkerTest: {
            setContent: (content: string) => void;
            setStreaming: (isStreaming: boolean) => void;
            setVisible: (visible: boolean) => void;
            setMutateNodes: (mutate: boolean) => void;
        };
        markdownWorkerPosts: Array<{ content: string; isStreaming: boolean }>;
    }
}

function Harness() {
    const [content, setContent] = useState('Initial worker content');
    const [isStreaming, setStreaming] = useState(false);
    const [visible, setVisible] = useState(true);
    const [mutateNodes, setMutateNodes] = useState(false);

    useLayoutEffect(() => {
        window.markdownWorkerTest = { setContent, setStreaming, setVisible, setMutateNodes };
    }, [setContent, setStreaming, setVisible, setMutateNodes]);

    const components: Components = mutateNodes
        ? {
            pre: ChatCodeBlock,
            h1: ({ node, children }) => {
                // Custom markdown components receive the source HAST node. A
                // consumer may mutate it, so this must not poison cached trees.
                if (node) node.children = [{ type: 'text', value: 'POISONED' }];
                return <h1>{children}</h1>;
            },
        }
        : { pre: ChatCodeBlock };

    return visible
        ? <WorkerMarkdown content={content} isStreaming={isStreaming} components={components} />
        : null;
}

createRoot(document.getElementById('root')!).render(<ToastProvider><Harness /></ToastProvider>);
