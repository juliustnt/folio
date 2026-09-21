import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";

export type Point = { x: number; y: number };
export type Mark = {
  type: "text" | "highlight" | "pen";
  points: Point[];
  text?: string;
  size: number;
  color: string;
  rotation: number;
};
export const hexColor = (hex: string) =>
  rgb(
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255,
  );
export async function editPdf(
  bytes: Uint8Array,
  action: (pdf: PDFDocument) => Promise<void> | void,
) {
  const pdf = await PDFDocument.load(bytes);
  await action(pdf);
  return pdf.save();
}
export async function addMark(bytes: Uint8Array, index: number, mark: Mark) {
  return editPdf(bytes, async (pdf) => {
    const page = pdf.getPage(index);
    const color = hexColor(mark.color);
    if (mark.type === "text") {
      const font = await pdf.embedFont(StandardFonts.Helvetica);
      page.drawText(mark.text || "", {
        ...mark.points[0],
        size: mark.size,
        color,
        font,
        rotate: degrees(mark.rotation),
      });
    } else if (mark.type === "highlight") {
      const [a, b] = mark.points;
      page.drawRectangle({
        x: Math.min(a.x, b.x),
        y: Math.min(a.y, b.y),
        width: Math.abs(a.x - b.x),
        height: Math.abs(a.y - b.y),
        color,
        opacity: 0.3,
      });
    } else {
      mark.points.slice(1).forEach((point, i) =>
        page.drawLine({
          start: mark.points[i],
          end: point,
          color,
          thickness: mark.size,
          lineCap: 1,
        }),
      );
    }
  });
}
export async function rotatePage(bytes: Uint8Array, index: number) {
  return editPdf(bytes, (pdf) => {
    const page = pdf.getPage(index);
    page.setRotation(degrees((page.getRotation().angle + 90) % 360));
  });
}
export async function deletePage(bytes: Uint8Array, index: number) {
  return editPdf(bytes, (pdf) => {
    if (pdf.getPageCount() < 2)
      throw new Error("Keep at least one page in your document.");
    pdf.removePage(index);
  });
}
export async function movePage(
  bytes: Uint8Array,
  index: number,
  direction: number,
) {
  return editPdf(bytes, (pdf) => {
    const target = index + direction;
    if (target < 0 || target >= pdf.getPageCount())
      throw new Error("Page is already at the edge.");
    const page = pdf.getPage(index);
    pdf.removePage(index);
    pdf.insertPage(target, page);
  });
}
export async function mergePdf(bytes: Uint8Array, other: Uint8Array) {
  return editPdf(bytes, async (pdf) => {
    const source = await PDFDocument.load(other);
    (await pdf.copyPages(source, source.getPageIndices())).forEach((page) =>
      pdf.addPage(page),
    );
  });
}
export function chunkText(text: string, limit = 450): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const chunks: string[] = [];
  let current = "";
  for (const word of words) {
    if (!word) continue;
    if (current.length + word.length + 1 > limit && current) {
      chunks.push(current);
      current = "";
    }
    if (word.length > limit) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      for (let i = 0; i < word.length; i += limit)
        chunks.push(word.slice(i, i + limit));
    } else current += (current ? " " : "") + word;
  }
  if (current) chunks.push(current);
  return chunks;
}
export async function createWelcome() {
  const pdf = await PDFDocument.create();
  const serif = await pdf.embedFont(StandardFonts.TimesRoman);
  const sans = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const green = rgb(0.15, 0.28, 0.23);
  const ink = rgb(0.2, 0.24, 0.22);
  const gray = rgb(0.43, 0.47, 0.44);
  const sections = [
    {
      eyebrow: "A FIELD GUIDE TO FOLIO",
      title: ["A little more space", "for your ideas."],
      intro: [
        "Read closely. Mark what matters. Make it yours.",
        "Your documents deserve a quieter place to work.",
      ],
      heading: "Meet your new paper trail.",
      body: [
        "Folio brings the familiar feeling of working on paper to your",
        "desktop. Open a document, collect your thoughts, and keep",
        "everything right where it belongs: on your Mac.",
      ],
      cards: [
        [
          "01",
          "Read, without the noise.",
          "Find your focus with a clean, considered workspace.",
        ],
        [
          "02",
          "Leave your mark.",
          "Add text, highlight a passage, or sketch an idea.",
        ],
        [
          "03",
          "Give your words a voice.",
          "Listen to your documents with local Qwen speech.",
        ],
      ],
    },
    {
      eyebrow: "MAKE YOURSELF AT HOME",
      title: ["Good tools.", "Clearer thinking."],
      intro: [
        "A few small things that make a big difference.",
        "Start with any PDF, then find your own flow.",
      ],
      heading: "A workspace that works your way.",
      body: [
        "Use the page rail to move through your document. Rotate,",
        "reorder, or remove a page, and bring another PDF into the",
        "same workspace with Merge PDF.",
      ],
      cards: [
        [
          "01",
          "Make a note.",
          "Choose Add text, type your note, then click the page.",
        ],
        [
          "02",
          "Keep the important parts.",
          "Drag the highlighter across anything worth remembering.",
        ],
        [
          "03",
          "Take it with you.",
          "Save a copy with your changes baked into the PDF.",
        ],
      ],
    },
    {
      eyebrow: "A DIFFERENT WAY TO READ",
      title: ["Less screen time.", "More story time."],
      intro: [
        "Give your eyes a break. Keep the ideas coming.",
        "A natural voice, powered by Qwen3-TTS.",
      ],
      heading: "Listen, at your own pace.",
      body: [
        "Open the Listen panel to read this page aloud. Choose a",
        "voice and a playback speed, then settle in. Speech runs",
        "locally on Apple Silicon with the optional Qwen runtime.",
      ],
      cards: [
        [
          "01",
          "Choose your voice.",
          "Pick a preset voice and the language of your document.",
        ],
        [
          "02",
          "Stay in control.",
          "Pause, resume, or stop your reading whenever you like.",
        ],
        [
          "03",
          "Keep things private.",
          "PDFs stay on your device. No document upload needed.",
        ],
      ],
    },
  ];
  for (const [i, s] of sections.entries()) {
    const page = pdf.addPage([612, 792]);
    page.drawRectangle({
      x: 0,
      y: 0,
      width: 612,
      height: 792,
      color: rgb(0.995, 0.99, 0.972),
    });
    page.drawText("folio", {
      x: 52,
      y: 735,
      font: serif,
      size: 23,
      color: green,
    });
    page.drawText("THE EVERYDAY DOCUMENT WORKSPACE", {
      x: 288,
      y: 741,
      size: 8,
      font: sans,
      color: gray,
    });
    page.drawLine({
      start: { x: 52, y: 713 },
      end: { x: 560, y: 713 },
      thickness: 0.6,
      color: rgb(0.8, 0.83, 0.78),
    });
    page.drawText(s.eyebrow, {
      x: 52,
      y: 671,
      font: bold,
      size: 9,
      color: green,
    });
    s.title.forEach((line, n) =>
      page.drawText(line, {
        x: 50,
        y: 610 - n * 49,
        size: 45,
        font: serif,
        color: green,
      }),
    );
    s.intro.forEach((line, n) =>
      page.drawText(line, {
        x: 52,
        y: 516 - n * 20,
        size: 12,
        font: sans,
        color: gray,
      }),
    );
    page.drawText(s.heading, {
      x: 52,
      y: 438,
      font: serif,
      size: 24,
      color: ink,
    });
    s.body.forEach((line, n) =>
      page.drawText(line, {
        x: 52,
        y: 408 - n * 19,
        font: sans,
        size: 12,
        color: gray,
      }),
    );
    s.cards.forEach(([num, title, body], n) => {
      const y = 302 - n * 76;
      page.drawCircle({
        x: 68,
        y: y + 3,
        size: 16,
        color: rgb(0.9, 0.93, 0.87),
      });
      page.drawText(num, { x: 62, y, font: sans, size: 10, color: green });
      page.drawText(title, {
        x: 101,
        y: y + 6,
        font: bold,
        size: 12,
        color: green,
      });
      page.drawText(body, {
        x: 101,
        y: y - 13,
        font: sans,
        size: 10,
        color: gray,
      });
    });
    page.drawLine({
      start: { x: 52, y: 82 },
      end: { x: 560, y: 82 },
      thickness: 0.6,
      color: rgb(0.8, 0.83, 0.78),
    });
    page.drawText("MADE FOR A LITTLE MORE CLARITY", {
      x: 52,
      y: 57,
      font: sans,
      size: 8,
      color: gray,
    });
    page.drawText(`FOLIO  /  0${i + 1}`, {
      x: 498,
      y: 57,
      font: sans,
      size: 8,
      color: gray,
    });
  }
  return pdf.save();
}
