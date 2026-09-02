import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merges Tailwind classes, letting a later class win over an earlier
 *  conflicting one (e.g. a caller's `px-2` overriding a component's
 *  default `px-4`) instead of both landing in the DOM. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
