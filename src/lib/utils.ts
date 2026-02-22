import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function getOption<T>(options: readonly T[], predicate: (item: T) => boolean) {
  return options.find(predicate) ?? options[0];
}
