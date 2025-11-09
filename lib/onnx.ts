import * as ort from "onnxruntime-web";

let _session: ort.InferenceSession | null = null;

export async function LoadOnnx() {
  try {
    if (_session) return _session;

    // Create session using wasm EP to avoid pulling the WebGPU bundle (which can
    // cause invalid URL resolution inside some bundlers / Next.js setups).
    const session = await ort.InferenceSession.create("/model.onnx", {
      executionProviders: ["wasm"],
    });

    if (!session) {
      console.log("FAILED_TO_LOAD_ONNX");
    }

    _session = session;
    return session;
  } catch (err) {
    console.error(err);
    throw new Error("SOMETHING_WENT_WRONG");
  }
}

