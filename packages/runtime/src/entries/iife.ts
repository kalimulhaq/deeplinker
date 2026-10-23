// The file `deeplinker build` emits. The string below is replaced with the site's config, then init() runs.
import { DeepLinker, init } from "../index";

const page = window as unknown as { DeepLinker?: typeof DeepLinker; __deeplinker?: boolean };
page.DeepLinker = DeepLinker;
if (!page.__deeplinker) {
  page.__deeplinker = true;
  init("__DEEPLINKER_CONFIG__" as never);
}
