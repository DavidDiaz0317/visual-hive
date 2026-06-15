import { sanitizeText as sanitizeCoreText } from "@visual-hive/core";

export function sanitizeText(input: string): string {
  return sanitizeCoreText(input);
}

export function sanitizeMarkdown(input: string): string {
  return sanitizeText(input);
}
