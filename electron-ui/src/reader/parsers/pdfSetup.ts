// Central pdfjs configuration. The worker is created via Vite's ?worker import
// (which bundles + wires the module worker correctly for both dev and packaged
// Electron) and installed as the global workerPort. pdfjs reuses a single
// PDFWorker per port across all documents, so parse + thumbnail rendering share
// one worker safely.
import * as pdfjsLib from "pdfjs-dist";
import PdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?worker";

pdfjsLib.GlobalWorkerOptions.workerPort = new PdfWorker();

export { pdfjsLib };
