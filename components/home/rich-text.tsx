import { textParts } from "@/lib/home";

/** A content string with its Markdown-style links rendered as links. */
export function RichText({ text }: { text: string }) {
  return (
    <>
      {textParts(text).map((part, index) =>
        part.href ? (
          <a key={index} href={part.href}>
            {part.text}
          </a>
        ) : (
          part.text
        ),
      )}
    </>
  );
}
