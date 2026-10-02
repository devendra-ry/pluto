import { createRoot } from 'react-dom/client';
import { AttachmentPreview } from '../../../src/features/chat/components/attachment-preview';

const image = {
    id: 'image-1',
    name: 'sample.png',
    mimeType: 'image/png',
    size: 1024,
    url: 'https://files.example.test/sample.png',
};
const fileAttachment = {
    id: 'document-1',
    name: 'notes.pdf',
    mimeType: 'application/pdf',
    size: 2048,
    url: 'https://files.example.test/notes.pdf',
};

function Harness() {
    return <main className="space-y-4 p-6">
        <AttachmentPreview attachment={image} />
        <AttachmentPreview attachment={fileAttachment} />
    </main>;
}

createRoot(document.getElementById('root')!).render(<Harness />);
