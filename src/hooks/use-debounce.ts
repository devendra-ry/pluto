import { useState, useEffect } from 'react';

/**
 * Hook that debounces a value by the specified delay.
 * Returns the debounced value that only updates after the delay has passed
 * since the last change to the input value.
 */
export function useDebouncedValue<T>(value: T, delay: number = 300): T {
    const [debouncedValue, setDebouncedValue] = useState<T>(value);

    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedValue(value);
        }, delay);

        return () => {
            clearTimeout(timer);
        };
    }, [value, delay]);

    return debouncedValue;
}
