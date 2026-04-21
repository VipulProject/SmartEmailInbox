import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatGmailDate(dateStr: string) {
    const date = new Date(dateStr);
    const now = new Date();
    
    if (date.toDateString() === now.toDateString()) {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function parseEncodedEmail(raw: string): string {
    // Basic address extraction: "Name <email@example.com>" -> "email@example.com"
    const match = raw.match(/<(.+?)>/);
    return match ? match[1] : raw;
}
