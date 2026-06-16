// Hand-written types for the vendored foliate-js mobi.js (it ships none).
// Loose on purpose — only the surface the parser uses.

export interface MobiSection {
  linear?: string;
  createDocument?: () => Promise<Document>;
}

export interface MobiBook {
  sections: MobiSection[];
  metadata?: { title?: string; language?: string; [k: string]: unknown };
  toc?: unknown;
  // Internal handle, used only to read the PalmDOC encryption flag for DRM detection.
  mobi?: { headers?: { palmdoc?: { encryption?: number } } };
}

export class MOBI {
  constructor(opts: { unzlib: (data: Uint8Array) => unknown });
  open(file: Blob): Promise<MobiBook>;
}

export function isMOBI(file: Blob): Promise<boolean>;
