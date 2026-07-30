// Vendored from @lobehub/icons 4.4.3 (MIT). See THIRD_PARTY_NOTICES.md.
import type { SVGProps } from 'react';

const ICONS = {
    Gemini: {
        color: '#3186FF',
        paths: ['M20.616 10.835a14.147 14.147 0 01-4.45-3.001 14.111 14.111 0 01-3.678-6.452.503.503 0 00-.975 0 14.134 14.134 0 01-3.679 6.452 14.155 14.155 0 01-4.45 3.001c-.65.28-1.318.505-2.002.678a.502.502 0 000 .975c.684.172 1.35.397 2.002.677a14.147 14.147 0 014.45 3.001 14.112 14.112 0 013.679 6.453.502.502 0 00.975 0c.172-.685.397-1.351.677-2.003a14.145 14.145 0 013.001-4.45 14.113 14.113 0 016.453-3.678.503.503 0 000-.975 13.245 13.245 0 01-2.003-.678z'],
    },
    OpenRouter: {
        color: 'currentColor',
        paths: ['M16.804 1.957l7.22 4.105v.087L16.73 10.21l.017-2.117-.821-.03c-1.059-.028-1.611.002-2.268.11-1.064.175-2.038.577-3.147 1.352L8.345 11.03c-.284.195-.495.336-.68.455l-.515.322-.397.234.385.23.53.338c.476.314 1.17.796 2.701 1.866 1.11.775 2.083 1.177 3.147 1.352l.3.045c.694.091 1.375.094 2.825.033l.022-2.159 7.22 4.105v.087L16.589 22l.014-1.862-.635.022c-1.386.042-2.137.002-3.138-.162-1.694-.28-3.26-.926-4.881-2.059l-2.158-1.5a21.997 21.997 0 00-.755-.498l-.467-.28a55.927 55.927 0 00-.76-.43C2.908 14.73.563 14.116 0 14.116V9.888l.14.004c.564-.007 2.91-.622 3.809-1.124l1.016-.58.438-.274c.428-.28 1.072-.726 2.686-1.853 1.621-1.133 3.186-1.78 4.881-2.059 1.152-.19 1.974-.213 3.814-.138l.02-1.907z'],
    },
} as const;

export type ProviderIconName = keyof typeof ICONS;

interface ProviderIconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
    name: ProviderIconName;
    size?: number | string;
}

export function ProviderIcon({ name, size = 20, ...props }: ProviderIconProps) {
    const icon = ICONS[name];
    return (
        <svg
            aria-hidden="true"
            fill={icon.color}
            height={size}
            viewBox="0 0 24 24"
            width={size}
            xmlns="http://www.w3.org/2000/svg"
            {...props}
        >
            {icon.paths.map((path) => <path d={path} key={path} />)}
        </svg>
    );
}
