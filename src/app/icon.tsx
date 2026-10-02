import { ImageResponse } from 'next/og';

// Image metadata
export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

export default function Icon() {
    return new ImageResponse(
        (
            <div
                style={{
                    width: '100%',
                    height: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'linear-gradient(135deg, #d81b60 0%, #c2185b 100%)',
                    color: '#ffffff',
                    borderRadius: '20%',
                    border: '1px solid #f06292',
                    fontSize: 22,
                    fontWeight: 700,
                    fontFamily: 'system-ui, sans-serif',
                }}
            >
                P
            </div>
        ),
        { ...size }
    );
}
