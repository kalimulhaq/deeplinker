// Built as a UMD: window.DeepLinker (script tag), CommonJS and AMD. Does not run by itself; call init(config).
import { DeepLinker } from "../index";

(window as unknown as { DeepLinker: typeof DeepLinker }).DeepLinker = DeepLinker;
