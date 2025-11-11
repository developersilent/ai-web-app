import * as ort from "onnxruntime-web";

let _session: ort.InferenceSession | null = null;

export async function LoadOnnx() {
  try {
    console.log("Fir", _session);
    if (_session) return _session;
    // Create session using wasm EP to avoid pulling the WebGPU bundle (which can
    // cause invalid URL resolution inside some bundlers / Next.js setups).
    // onnxruntime-web may emit a runtime warning like:
    //  "Unknown CPU vendor. cpuinfo_vendor value: 0"
    // This is harmless in browser contexts; to avoid noisy logs we temporarily
    // filter console warnings/errors that match the known message during session
    // creation and then restore the original console methods.
    const origWarn = console.warn;
    const origError = console.error;
    const filterRegex = /Unknown CPU vendor|cpuinfo_vendor/;
    console.warn = (...args: any[]) => {
      try {
        if (args && args[0] && String(args[0]).match(filterRegex)) return;
      } catch (e) { }
      return origWarn.apply(console, args as any);
    };
    console.error = (...args: any[]) => {
      try {
        if (args && args[0] && String(args[0]).match(filterRegex)) return;
      } catch (e) { }
      return origError.apply(console, args as any);
    };

    let session: ort.InferenceSession | null = null;
    try {
      session = await ort.InferenceSession.create("/best.onnx", {
        executionProviders: ["wasm"],
      });
    } finally {
      // restore console methods even if creation throws
      console.warn = origWarn;
      console.error = origError;
    }
    console.log("sec", session);

    if (!session) {
      console.log("FAILED_TO_LOAD_ONNX");
    }

    _session = session;
    console.log("thi", _session);
    return session;
  } catch (err) {
    console.error(err);
    throw new Error("SOMETHING_WENT_WRONG");
  }
}

