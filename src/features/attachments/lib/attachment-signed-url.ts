const SIGNED_ATTACHMENT_URL_TTL_SECONDS = 60 * 60 * 24 * 365 * 10; // 10 years

type StorageCreateSignedUrlResponse = {
    data: { signedUrl?: string } | null;
    error: { message?: string } | null;
};

type StorageClientWithSignedUrl = {
    storage: {
        from: (bucket: string) => {
            createSignedUrl: (path: string, expiresIn: number) => Promise<StorageCreateSignedUrlResponse>;
        };
    };
};

export async function createSignedAttachmentUrl(
    supabase: StorageClientWithSignedUrl,
    bucket: string,
    path: string
) {
    const { data, error } = await supabase.storage
        .from(bucket)
        .createSignedUrl(path, SIGNED_ATTACHMENT_URL_TTL_SECONDS);

    if (error || !data?.signedUrl) {
        return null;
    }

    return data.signedUrl;
}