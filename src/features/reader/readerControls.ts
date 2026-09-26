export function readerShortcut(event: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}) {
  if (!(event.metaKey || event.ctrlKey) || event.altKey) return null;
  switch (event.key) {
    case "+":
    case "=":
      return "zoom-in";
    case "-":
      return "zoom-out";
    case "0":
      return "actual-size";
    case "ArrowRight":
      return "next-page";
    case "ArrowLeft":
      return "previous-page";
    case "ArrowUp":
      return "first-page";
    case "ArrowDown":
      return "last-page";
    default:
      return null;
  }
}

/** Keep a passage visible; if it exceeds the viewport, show its beginning. */
export function revealOffset(
  start: number,
  end: number,
  viewStart: number,
  viewEnd: number,
) {
  if (start < viewStart || end - start > viewEnd - viewStart)
    return start - viewStart;
  if (end > viewEnd) return end - viewEnd;
  return 0;
}
